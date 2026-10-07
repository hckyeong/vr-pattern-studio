import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Minus, Plus, RotateCw, ScanLine } from 'lucide-react';
import type { FillMask, PatternResult, Polygon, SvgArtwork } from '../core/types';
import { maskPaths } from '../core/fillMask';
import { createSheetRegions } from '../core/sheets';
import { artworkContour, artworkShapes, constrainArtwork, getArtworks, normalizeArtworkRotation, transformArtworkPaths } from '../core/artwork';
import { resolveColors } from '../core/colors';

/** 여러 벡터 윤곽선을 하나의 캔버스 경로로 변환한다. */
function trace(ctx: CanvasRenderingContext2D, paths: Polygon[]) {
  ctx.beginPath();
  for (const points of paths) {
    if (!points.length) continue;
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.closePath();
  }
}

interface Props {
  result: PatternResult | null;
  small?: boolean;
  artworks?: SvgArtwork[];
  selectedArtwork?: number;
  fillMask?: FillMask | null;
  onArtworkSelect?(index: number): void;
  onArtworkChange?(artwork: SvgArtwork, index: number): void;
  onArtworkCommit?(artwork: SvgArtwork, index: number): void;
}
interface Drag { mode: 'pan' | 'move' | 'resize' | 'rotate'; x: number; y: number; index: number; centerX: number; centerY: number; original?: SvgArtwork; last?: SvgArtwork }

/** 흰 채움 영역과 선택한 SVG 윤곽을 표시하며 SVG 이동·크기·회전을 지원한다. */
export function Preview({ result, small = false, artworks, selectedArtwork = -1, fillMask, onArtworkSelect, onArtworkChange, onArtworkCommit }: Props) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1), [pan, setPan] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 }), [boundaries, setBoundaries] = useState(false);
  const [maskBoundary, setMaskBoundary] = useState(true);
  const currentMask = fillMask === undefined ? result?.settings.fillMask : fillMask;
  const maskOutline = useMemo(() => currentMask && result ? maskPaths(currentMask, result.canvas) : [], [currentMask, result?.canvas]);
  const drag = useRef<Drag | null>(null);
  const interactive = !small && !!onArtworkChange;
  const drafts = useMemo(() => interactive ? artworks ?? [] : result ? getArtworks(result.settings) : [], [interactive, artworks, result?.settings]);
  const placements = useMemo(() => result ? drafts.map(draft => constrainArtwork(draft, result.canvas)) : [], [drafts, result?.canvas]);
  const draft = drafts[selectedArtwork], placed = placements[selectedArtwork];
  const drawing = useMemo(() => interactive && result ? placements.flatMap(item => artworkShapes(item, result.canvas)) : [], [placements, result?.canvas, interactive]);
  const contour = useMemo(() => draft ? artworkContour(draft) : [], [draft?.parts, draft?.avoidance]);
  const padding = small ? 10 : 58;
  const scale = result ? Math.max(0.00000001, Math.min((size.width - padding * 2) / result.canvas.width, (size.height - padding * 2) / result.canvas.height) * zoom) : 1;
  const x = (size.width - (result?.canvas.width ?? 0) * scale) / 2 + pan.x, y = (size.height - (result?.canvas.height ?? 0) * scale) / 2 + pan.y;
  // 같은 크기의 재배치에서는 사용자가 보고 있던 확대 위치를 유지한다.
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [result?.canvas.width, result?.canvas.height]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    /** 실제 화면 크기 변경을 벡터와 조작 손잡이에 함께 반영한다. */
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = host.current;
    if (!element || small) return;
    /** 캔버스 확대 중 페이지 스크롤이 함께 움직이지 않도록 처리한다. */
    const wheel = (event: WheelEvent) => { event.preventDefault(); if (!drag.current) setZoom(value => Math.max(.25, Math.min(8, value * (event.deltaY < 0 ? 1.1 : .9)))); };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [small]);
  useEffect(() => {
    const target = canvas.current;
    if (!target || !size.width || !size.height) return;
    const dpr = window.devicePixelRatio || 1;
    target.width = size.width * dpr; target.height = size.height * dpr;
    const ctx = target.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, size.width, size.height);
    if (!result) return;
    ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.shadowColor = '#15202918'; ctx.shadowBlur = small ? 3 : 20;
    ctx.fillStyle = resolveColors(result.settings).background; ctx.fillRect(0, 0, result.canvas.width, result.canvas.height); ctx.shadowBlur = 0;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, result.canvas.width, result.canvas.height); ctx.clip();
    const visible = { minX: -x / scale, minY: -y / scale, maxX: (size.width - x) / scale, maxY: (size.height - y) / scale };
    const shapes = interactive ? [...result.shapes.filter(shape => shape.kind !== 'artwork'), ...drawing] : result.shapes;
    for (const shape of shapes) {
      if (!small && (shape.bounds.maxX < visible.minX || shape.bounds.minX > visible.maxX || shape.bounds.maxY < visible.minY || shape.bounds.minY > visible.maxY)) continue;
      if (shape.footprint && shape.kind === 'marker') { trace(ctx, shape.footprint); ctx.fillStyle = '#fff'; ctx.fill('nonzero'); }
      trace(ctx, shape.paths); ctx.fillStyle = shape.color; ctx.fill(shape.fillRule);
    }
    if (maskBoundary && !small && maskOutline.length) {
      ctx.save(); trace(ctx, maskOutline); ctx.strokeStyle = '#168b9d'; ctx.lineWidth = 1 / scale;
      ctx.setLineDash([4 / scale, 4 / scale]); ctx.stroke(); ctx.restore();
    }
    if (interactive && placed && placed.avoidance !== 'bounds') {
      ctx.save(); trace(ctx, transformArtworkPaths(contour, placed, result.canvas)); ctx.strokeStyle = '#729425'; ctx.lineWidth = 1.5 / scale;
      ctx.setLineDash([6 / scale, 4 / scale]); ctx.stroke(); ctx.restore();
    }
    if (boundaries && !small) {
      ctx.strokeStyle = '#7e9e16'; ctx.lineWidth = 1 / scale; ctx.setLineDash([6 / scale, 5 / scale]);
      for (const sheet of createSheetRegions(result.canvas, result.settings)) ctx.strokeRect(sheet.trimX, 0, sheet.trimWidth, result.canvas.height);
    }
    ctx.restore();
  }, [result, scale, x, y, boundaries, small, size, interactive, drawing, placed, contour, maskBoundary, maskOutline]);

  /** 회전한 축으로 크기를 조절하고 중심에 대한 포인터 각도로 SVG를 회전한다. */
  function pointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (current.mode === 'pan') { setPan(value => ({ x: value.x + dx, y: value.y + dy })); current.x = event.clientX; current.y = event.clientY; return; }
    if (!current.original || !result) return;
    const original = current.original;
    let next: SvgArtwork;
    if (current.mode === 'move') next = { ...original, x: original.x + dx / (scale * result.canvas.width), y: original.y + dy / (scale * result.canvas.height) };
    else if (current.mode === 'rotate') {
      if (Math.hypot(event.clientX - current.centerX, event.clientY - current.centerY) < 2) return;
      const initial = Math.atan2(current.y - current.centerY, current.x - current.centerX);
      const currentAngle = Math.atan2(event.clientY - current.centerY, event.clientX - current.centerX);
      const angle = (original.rotation ?? 0) + (currentAngle - initial) * 180 / Math.PI;
      next = { ...original, rotation: normalizeArtworkRotation(event.shiftKey ? Math.round(angle / 15) * 15 : angle) };
    } else {
      const angle = (original.rotation ?? 0) * Math.PI / 180;
      const localX = dx * Math.cos(angle) + dy * Math.sin(angle), localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
      const growth = 2 * (localX + localY * original.aspect) / (scale * result.canvas.width * (1 + original.aspect ** 2));
      next = { ...original, widthRatio: original.widthRatio + growth };
    }
    current.last = constrainArtwork(next, result.canvas); onArtworkChange?.(current.last, current.index);
  }
  /** 포인터 조작 완료 시 최종 배치 한 번만 생성기에 전달한다. */
  function finishDrag(cancelled = false) {
    const current = drag.current; drag.current = null;
    if (cancelled && current?.original) onArtworkChange?.(current.original, current.index);
    else if (current?.last) onArtworkCommit?.(current.last, current.index);
  }
  /** SVG를 선택하거나 빈 공간에서 선택을 해제하고 드래그 기준 좌표를 고정한다. */
  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || drag.current) return;
    const target = event.target as Element;
    if (target.closest('.canvas-controls')) return;
    const handle = target.closest<HTMLElement>('[data-artwork-handle]');
    const index = handle ? Number(handle.dataset.artworkHandle) : -1, original = placements[index];
    const rect = event.currentTarget.getBoundingClientRect();
    onArtworkSelect?.(original ? index : -1);
    drag.current = { mode: original ? (target.closest('[data-rotate]') ? 'rotate' : target.closest('[data-resize]') ? 'resize' : 'move') : 'pan', x: event.clientX, y: event.clientY, index, original, centerX: rect.left + x + (original?.x ?? 0) * (result?.canvas.width ?? 0) * scale, centerY: rect.top + y + (original?.y ?? 0) * (result?.canvas.height ?? 0) * scale };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  /** 방향키로 선택한 그림을 이동하거나 회전 손잡이에 초점을 둔 채 각도를 조절한다. */
  function adjustWithKeyboard(event: React.KeyboardEvent<HTMLDivElement>, item: SvgArtwork, index: number) {
    if (!result || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); onArtworkSelect?.(index);
    const rotating = !!(event.target as Element).closest('[data-rotate]'), step = event.shiftKey ? .05 : .01;
    const next = constrainArtwork(rotating ? { ...item, rotation: (item.rotation ?? 0) + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1) * (event.shiftKey ? 15 : 1) } : { ...item, x: item.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), y: item.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) }, result.canvas);
    onArtworkChange?.(next, index); onArtworkCommit?.(next, index);
  }
  return <div className={small ? 'preview thumbnail-preview' : 'preview'} ref={host}
    onPointerDown={small ? undefined : startDrag}
    onPointerMove={small ? undefined : pointerMove} onPointerUp={() => finishDrag()} onPointerCancel={() => finishDrag(true)}>
    <canvas ref={canvas} aria-label="생성된 패턴 미리보기" />
    {interactive && result && placements.map((item, index) => <div key={index} data-artwork-handle={index} className={`artwork-handle ${index === selectedArtwork ? 'selected' : 'inactive'} ${item.avoidance !== 'bounds' ? 'contour-mode' : ''}`} role="button" tabIndex={0} aria-label={`${index + 1}번 SVG ${item.name} 선택 및 이동`} aria-pressed={index === selectedArtwork} style={{ left: x + (item.x - item.widthRatio / 2) * result.canvas.width * scale, top: y + (item.y * result.canvas.height - item.widthRatio * result.canvas.width * item.aspect / 2) * scale, width: item.widthRatio * result.canvas.width * scale, height: item.widthRatio * result.canvas.width * item.aspect * scale, transform: `rotate(${item.rotation ?? 0}deg)` }}
      onFocus={() => onArtworkSelect?.(index)} onClick={() => onArtworkSelect?.(index)} onKeyDown={event => adjustWithKeyboard(event, item, index)}>
      {index === selectedArtwork && <><span className="artwork-handle-label">{index + 1} · {item.name}</span><span data-resize className="artwork-resize" title="드래그로 SVG 크기 조절" /><span className="artwork-rotate-stem" /><span data-rotate role="slider" tabIndex={0} aria-label={`${index + 1}번 SVG 회전 손잡이`} aria-valuemin={0} aria-valuemax={360} aria-valuenow={Number((item.rotation ?? 0).toFixed(1))} className="artwork-rotate" title="드래그로 회전 · Shift는 15도 단위"><RotateCw size={15} /></span></>}
    </div>)}
    {!result && !small && <div className="canvas-empty"><ScanLine size={40} /><p>첫 번째 패턴을 준비하고 있어요</p><span>서로 다른 형태로 채우는 새로운 공간</span></div>}
    {!small && <div className="canvas-controls" onPointerDown={event => event.stopPropagation()}>
      <button title="축소" onClick={() => setZoom(value => Math.max(.25, value / 1.2))}><Minus size={16} /></button><span>{Math.round(zoom * 100)}%</span>
      <button title="확대" onClick={() => setZoom(value => Math.min(8, value * 1.2))}><Plus size={16} /></button><i />
      <button title="화면에 맞춤" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}><Maximize size={16} /></button>
      <button title="출력 시트 경계" className={boundaries ? 'active' : ''} onClick={() => setBoundaries(value => !value)}><ScanLine size={16} /></button>
      {currentMask && <button title="흰색 채움 영역 경계" aria-label="흰색 채움 영역 경계" aria-pressed={maskBoundary} className={maskBoundary ? 'active' : ''} onClick={() => setMaskBoundary(value => !value)}><ScanLine size={16} /></button>}
    </div>}
  </div>;
}

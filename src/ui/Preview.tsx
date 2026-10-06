import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Minus, Plus, ScanLine } from 'lucide-react';
import type { PatternResult, Polygon, SvgArtwork } from '../core/types';
import { createSheetRegions } from '../core/sheets';
import { artworkContour, artworkShapes, constrainArtwork } from '../core/artwork';
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
  artwork?: SvgArtwork;
  onArtworkChange?(artwork: SvgArtwork): void;
  onArtworkCommit?(artwork: SvgArtwork): void;
}
interface Drag { mode: 'pan' | 'move' | 'resize'; x: number; y: number; original?: SvgArtwork; last?: SvgArtwork }

/** 벡터 원고를 표시하고 확대·이동 및 삽입 SVG의 직접 조작을 지원한다. */
export function Preview({ result, small = false, artwork, onArtworkChange, onArtworkCommit }: Props) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1), [pan, setPan] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 }), [boundaries, setBoundaries] = useState(false);
  const drag = useRef<Drag | null>(null);
  const interactive = !small && !!onArtworkChange;
  const draft = interactive ? artwork : result?.settings.artwork;
  const placed = useMemo(() => draft && result ? constrainArtwork(draft, result.canvas) : undefined, [draft, result?.canvas]);
  const drawing = useMemo(() => interactive && placed && result ? artworkShapes(placed, result.canvas) : [], [placed, result?.canvas, interactive]);
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
    if (interactive && placed && placed.avoidance !== 'bounds') {
      const width = placed.widthRatio * result.canvas.width;
      ctx.save(); ctx.translate(placed.x * result.canvas.width - width / 2, placed.y * result.canvas.height - width * placed.aspect / 2); ctx.scale(width, width);
      trace(ctx, contour); ctx.strokeStyle = '#729425'; ctx.lineWidth = 1.5 / (scale * width);
      ctx.setLineDash([6 / (scale * width), 4 / (scale * width)]); ctx.stroke(); ctx.restore();
    }
    if (boundaries && !small) {
      ctx.strokeStyle = '#7e9e16'; ctx.lineWidth = 1 / scale; ctx.setLineDash([6 / scale, 5 / scale]);
      for (const sheet of createSheetRegions(result.canvas, result.settings)) ctx.strokeRect(sheet.trimX, 0, sheet.trimWidth, result.canvas.height);
    }
    ctx.restore();
  }, [result, scale, x, y, boundaries, small, size, interactive, drawing, placed, contour]);

  /** 화면 좌표의 이동을 작업 좌표로 환산해 SVG를 캔버스 안에서 조작한다. */
  function pointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (current.mode === 'pan') { setPan(value => ({ x: value.x + dx, y: value.y + dy })); current.x = event.clientX; current.y = event.clientY; return; }
    if (!current.original || !result) return;
    const original = current.original;
    const horizontal = dx / (scale * result.canvas.width), vertical = dy / (scale * result.canvas.width * original.aspect);
    const next = current.mode === 'move' ? { ...original, x: original.x + horizontal, y: original.y + dy / (scale * result.canvas.height) } : { ...original, widthRatio: original.widthRatio + 2 * (Math.abs(horizontal) > Math.abs(vertical) ? horizontal : vertical) };
    current.last = constrainArtwork(next, result.canvas); onArtworkChange?.(current.last);
  }
  /** 포인터 조작 완료 시 최종 배치 한 번만 생성기에 전달한다. */
  function finishDrag(cancelled = false) {
    const current = drag.current; drag.current = null;
    if (cancelled && current?.original) onArtworkChange?.(current.original);
    else if (current?.last) onArtworkCommit?.(current.last);
  }
  return <div className={small ? 'preview thumbnail-preview' : 'preview'} ref={host}
    onPointerDown={small ? undefined : event => {
      if ((event.target as HTMLElement).closest('.canvas-controls')) return;
      const handle = (event.target as HTMLElement).closest('[data-artwork-handle]');
      drag.current = { mode: handle && placed ? ((event.target as HTMLElement).closest('[data-resize]') ? 'resize' : 'move') : 'pan', x: event.clientX, y: event.clientY, original: placed };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={small ? undefined : pointerMove} onPointerUp={() => finishDrag()} onPointerCancel={() => finishDrag(true)}>
    <canvas ref={canvas} aria-label="생성된 패턴 미리보기" />
    {interactive && placed && result && <div data-artwork-handle className={`artwork-handle ${placed.avoidance !== 'bounds' ? 'contour-mode' : ''}`} role="button" tabIndex={0} aria-label="삽입 SVG 이동" style={{ left: x + (placed.x - placed.widthRatio / 2) * result.canvas.width * scale, top: y + (placed.y * result.canvas.height - placed.widthRatio * result.canvas.width * placed.aspect / 2) * scale, width: placed.widthRatio * result.canvas.width * scale, height: placed.widthRatio * result.canvas.width * placed.aspect * scale }}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); const step = event.shiftKey ? .05 : .01;
        const next = constrainArtwork({ ...placed, x: placed.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), y: placed.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) }, result.canvas);
        onArtworkChange?.(next); onArtworkCommit?.(next);
      }}>
      <span className="artwork-handle-label">SVG · 드래그로 이동</span><span data-resize className="artwork-resize" title="드래그로 SVG 크기 조절" />
    </div>}
    {!result && !small && <div className="canvas-empty"><ScanLine size={40} /><p>첫 번째 패턴을 준비하고 있어요</p><span>서로 다른 형태로 채우는 새로운 공간</span></div>}
    {!small && <div className="canvas-controls" onPointerDown={event => event.stopPropagation()}>
      <button title="축소" onClick={() => setZoom(value => Math.max(.25, value / 1.2))}><Minus size={16} /></button><span>{Math.round(zoom * 100)}%</span>
      <button title="확대" onClick={() => setZoom(value => Math.min(8, value * 1.2))}><Plus size={16} /></button><i />
      <button title="화면에 맞춤" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}><Maximize size={16} /></button>
      <button title="출력 시트 경계" className={boundaries ? 'active' : ''} onClick={() => setBoundaries(value => !value)}><ScanLine size={16} /></button>
    </div>}
  </div>;
}

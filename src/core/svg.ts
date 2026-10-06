import type { PatternResult, Polygon, SheetRegion } from './types';
import { createSheetRegions } from './sheets';
import { resolveColors } from './colors';

/** XML 본문과 속성에서 예약 문자를 안전하게 보존한다. */
function escapeXml(value: unknown): string { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!); }
/** 좌표의 정밀도를 유지하면서 음의 영 표기를 제거한다. */
function n(value: number): string { return String(Number(value.toFixed(8))); }
/** 다각형을 닫힌 벡터 경로로 변환한다. */
function pathData(paths: Polygon[]): string { return paths.map(path => path.length ? `M${path.map(p => `${n(p.x)},${n(p.y)}`).join('L')}Z` : '').join(''); }
/** 전역 좌표를 유지하는 순수 벡터 인쇄 원고를 생성한다. */
export function exportSvg(result: PatternResult, options: { sheet?: SheetRegion; outline?: boolean } = {}): string {
  const { canvas, settings } = result;
  const region = options.sheet ?? { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const scale = settings.sheets.scale;
  const mm = canvas.physicalWidthMm === null ? null : canvas.physicalWidthMm / canvas.width;
  const unit = mm === null ? 'px' : 'mm';
  const factor = (mm ?? 1) * scale;
  const metadata = { version: result.version, seed: settings.seed, settings, canvas, scale, sheet: options.sheet ?? null, markers: result.shapes.flatMap(s => s.marker ? [s.marker] : []), whiteRatio: result.whiteRatio };
  const shapes = result.shapes.map(shape => {
    const marker = shape.marker;
    const attributes = marker ? ` data-dictionary="${escapeXml(marker.dictionary)}" data-aruco-id="${marker.id}" data-sheet-index="${marker.sheetIndex}"` : '';
    const protection = marker && shape.footprint ? `<path d="${pathData(shape.footprint)}" fill="#ffffff"/>` : '';
    const outline = options.outline && !marker;
    const inkPaths = options.sheet ? shape.bleedPaths ?? shape.paths : shape.paths;
    return `<g id="${escapeXml(shape.id)}"${attributes}>${protection}<path d="${pathData(inkPaths)}" fill="${outline ? 'none' : escapeXml(shape.color)}" fill-rule="${shape.fillRule}"${outline ? ' stroke="#000000" stroke-width="0.25"' : ''}/></g>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${n(region.width * factor)}${unit}" height="${n(region.height * factor)}${unit}" viewBox="${n(region.x)} ${n(region.y)} ${n(region.width)} ${n(region.height)}"><title>추적 패턴 인쇄 원고</title><metadata>${escapeXml(JSON.stringify(metadata))}</metadata><defs><clipPath id="canvas-clip"><rect width="${n(canvas.width)}" height="${n(canvas.height)}"/></clipPath><clipPath id="sheet-clip"><rect x="${n(region.x)}" y="${n(region.y)}" width="${n(region.width)}" height="${n(region.height)}"/></clipPath></defs><rect x="${n(region.x)}" y="${n(region.y)}" width="${n(region.width)}" height="${n(region.height)}" fill="${escapeXml(resolveColors(settings).background)}"/><g clip-path="url(#sheet-clip)"><g${options.sheet ? '' : ' clip-path="url(#canvas-clip)"'}>${shapes}</g></g></svg>`;
}
/** 파일 시스템에서 안전한 시드와 시트 번호로 원고명을 만든다. */
export function getSvgFilename(result: PatternResult, sheet?: SheetRegion): string {
  const seed = result.settings.seed.replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 64) || '패턴';
  return `추적패턴-${seed}${sheet ? `-시트${String(sheet.index + 1).padStart(2, '0')}` : '-전체'}.svg`;
}
/** 인쇄 원고와 구분되는 번호·시공 방향·유효폭 배치도를 생성한다. */
export function exportSheetMapSvg(result: PatternResult): string {
  const sheets = createSheetRegions(result.canvas, result.settings);
  const width = 1000, padding = 40;
  const factor = Math.min((width - 2 * padding) / result.canvas.width, 300 / result.canvas.height);
  const mm = result.canvas.physicalWidthMm === null ? null : result.canvas.physicalWidthMm / result.canvas.width;
  const unit = mm === null ? 'px' : 'mm';
  /** 작업 길이를 실측 단위로 변환하여 간결하게 표시한다. */
  const length = (value: number): string => `${Number((value * (mm ?? 1)).toFixed(3))} ${unit}`;
  const markers = result.shapes.flatMap(shape => shape.marker ? [shape.marker] : []);
  const overviewY = 145, overviewHeight = result.canvas.height * factor;
  const boundaries = sheets.map(s => `<rect x="${n(padding + s.trimX * factor)}" y="${overviewY}" width="${n(s.trimWidth * factor)}" height="${n(overviewHeight)}" fill="none" stroke="#718096" stroke-width="0.5"/>`).join('');
  const dots = markers.map(marker => `<circle cx="${n(padding + marker.x * factor)}" cy="${n(overviewY + marker.y * factor)}" r="2.5" fill="#b42318"><title>마커 ${marker.id} · 시트 ${marker.sheetIndex + 1}</title></circle>`).join('');
  const cardWidth = 450, columnGap = 20, cardGap = 16;
  let rowY = overviewY + overviewHeight + 45;
  let cards = '';
  for (let index = 0; index < sheets.length; index += 2) {
    const row = sheets.slice(index, index + 2).map(sheet => {
      const ids = markers.filter(marker => marker.sheetIndex === sheet.index).map(marker => marker.id);
      const lines: string[] = [];
      for (let offset = 0; offset < ids.length; offset += 10) lines.push(ids.slice(offset, offset + 10).join(', '));
      if (!lines.length) lines.push('없음');
      return { sheet, lines, height: 155 + lines.length * 20 };
    });
    const rowHeight = Math.max(...row.map(card => card.height));
    cards += row.map(({ sheet, lines }, column) => {
      const x = padding + column * (cardWidth + columnGap);
      const overlap = sheet.index > 0 && result.settings.sheets.enabled ? result.settings.sheets.overlap : 0;
      const bleed = result.settings.sheets.enabled ? result.settings.sheets.bleed : 0;
      const scale = result.settings.sheets.scale;
      return `<g data-sheet-card="${sheet.index + 1}" transform="translate(${x} ${n(rowY)})"><rect width="${cardWidth}" height="${rowHeight}" rx="8" fill="#eef3f8" stroke="#cbd5e0"/><text x="16" y="28" font-size="18" font-weight="bold">시트 ${sheet.index + 1}</text><text x="16" y="54">실제 출력: ${length(sheet.width * scale)} × ${length(sheet.height * scale)}</text><text x="16" y="77">유효 시공폭: ${length(sheet.trimWidth)} · 시작: ${length(sheet.trimX)}</text><text x="16" y="100">왼쪽 겹침: ${length(overlap)} · 사방 도련: ${length(bleed)}</text><text x="16" y="123">출력 축척: 1:${scale === 1 ? '1' : '10'} · 마커 번호:</text>${lines.map((line, lineIndex) => `<text x="16" y="${147 + lineIndex * 20}">${line}</text>`).join('')}</g>`;
    }).join('');
    rowY += rowHeight + cardGap;
  }
  const height = Math.ceil(rowY + 24);
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${width}px" height="${height}px" viewBox="0 0 ${width} ${height}" font-family="sans-serif" font-size="14"><title>시트 배치도 — 인쇄 원고와 별도</title><rect width="${width}" height="${height}" fill="white"/><text x="40" y="35" font-size="22">시트 배치도 · 시공 방향 →</text><text x="40" y="64">전체 실측: ${length(result.canvas.width)} × ${length(result.canvas.height)}${mm === null ? ' · 실측 미지정' : ''} · 총 ${sheets.length}장</text><text x="40" y="90">개요는 원고 비율 유지 · 얇은 선: 유효 시공 경계 · 붉은 점: 마커 위치</text><text x="40" y="116">아래 겹침·도련·유효폭은 축척 적용 전 치수 · 실제 출력 크기는 축척 적용</text>${boundaries}${dots}${cards}</svg>`;
}

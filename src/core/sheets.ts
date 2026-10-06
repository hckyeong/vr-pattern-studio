import type { PatternSettings, ResolvedCanvas, SheetRegion } from './types';

/** 유효 시공폭으로 나누고 후속 시트의 왼쪽 겹침과 사방 도련을 확장한다. */
export function createSheetRegions(canvas: ResolvedCanvas, settings: PatternSettings): SheetRegion[] {
  const { enabled, width, overlap, bleed } = settings.sheets;
  if (!enabled) return [{ index: 0, trimX: 0, trimWidth: canvas.width, x: 0, y: 0, width: canvas.width, height: canvas.height }];
  if (![width, overlap, bleed].every(Number.isFinite) || width <= 0 || overlap < 0 || overlap >= width || bleed < 0) throw new Error('시트 폭, 겹침 또는 도련이 올바르지 않습니다.');
  return Array.from({ length: Math.ceil(canvas.width / width) }, (_, index) => {
    const trimX = index * width;
    const trimWidth = Math.min(width, canvas.width - trimX);
    const leftOverlap = index > 0 ? overlap : 0;
    return { index, trimX, trimWidth, x: trimX - leftOverlap - bleed, y: -bleed, width: trimWidth + leftOverlap + 2 * bleed, height: canvas.height + 2 * bleed };
  });
}

import { boundsOf, normalizePaths, outerContours, pathsArea, rectangle, subtractPaths } from './geometry';
import type { PatternShape, Polygon, ResolvedCanvas, SvgArtwork } from './types';

/** 삽입 그림의 크기와 중심을 캔버스 안으로 제한한다. */
export function constrainArtwork(artwork: SvgArtwork, canvas: ResolvedCanvas): SvgArtwork {
  const widthRatio = Math.max(0.001, Math.min(artwork.widthRatio, 1, canvas.height / (canvas.width * artwork.aspect)));
  const halfY = widthRatio * canvas.width * artwork.aspect / canvas.height / 2;
  return { ...artwork, widthRatio, x: Math.max(widthRatio / 2, Math.min(1 - widthRatio / 2, artwork.x)), y: Math.max(halfY, Math.min(1 - halfY, artwork.y)) };
}

/** 정규화한 삽입 그림을 현재 캔버스의 벡터 도형으로 변환한다. */
export function artworkShapes(artwork: SvgArtwork, canvas: ResolvedCanvas): PatternShape[] {
  const placed = constrainArtwork(artwork, canvas);
  const width = placed.widthRatio * canvas.width;
  const left = placed.x * canvas.width - width / 2, top = placed.y * canvas.height - width * placed.aspect / 2;
  return placed.parts.map((part, index) => {
    const paths = part.paths.map(path => path.map(point => ({ x: left + point.x * width, y: top + point.y * width })));
    return { id: `imported-artwork-${index}`, kind: 'artwork', color: part.color, paths, fillRule: 'nonzero', area: pathsArea(paths), bounds: boundsOf(paths) };
  });
}

/** 정규화된 그림에서 선택한 회피 방식의 실제 보호 윤곽을 구한다. */
export function artworkContour(artwork: SvgArtwork): Polygon[] {
  const paths = artwork.parts.flatMap(part => part.paths);
  if (artwork.avoidance === 'bounds') {
    const bounds = boundsOf(paths);
    return rectangle(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  }
  if (artwork.avoidance === 'silhouette') return outerContours(artwork.parts.flatMap(part => outerContours(part.paths)));
  // 이전 윤곽 모드의 도형별 합성 순서를 보존한다.
  let footprint: Polygon[] = [];
  for (const part of artwork.parts) footprint = normalizePaths([...footprint, ...part.paths]);
  return footprint;
}

/** 보호 윤곽을 배치 좌표로 옮기고 흰 덧칠을 반영한 잉크 합집합을 계산한다. */
export function placeArtwork(artwork: SvgArtwork, canvas: ResolvedCanvas): { shapes: PatternShape[]; footprint: Polygon[]; inkArea: number } {
  const shapes = artworkShapes(artwork, canvas);
  let painted: Polygon[] = [];
  for (const shape of shapes) {
    painted = shape.color.toLowerCase() === '#ffffff' ? subtractPaths(painted, shape.paths) : normalizePaths([...painted, ...shape.paths]);
  }
  const placed = constrainArtwork(artwork, canvas), width = placed.widthRatio * canvas.width;
  const left = placed.x * canvas.width - width / 2, top = placed.y * canvas.height - width * placed.aspect / 2;
  const footprint = artworkContour(placed).map(path => path.map(point => ({ x: left + point.x * width, y: top + point.y * width })));
  return { shapes, footprint, inkArea: pathsArea(painted) };
}

/** 저장소와 작업자 입력에서 안전한 벡터 데이터와 배치 범위만 허용한다. */
export function validArtwork(value: SvgArtwork): boolean {
  if (!value || typeof value.name !== 'string' || value.name.length > 200 || !Number.isFinite(value.aspect) || value.aspect < 0.005 || value.aspect > 200) return false;
  if (![value.x, value.y, value.widthRatio].every(v => Number.isFinite(v) && v >= 0 && v <= 1) || value.widthRatio < 0.001 || !['silhouette', 'outline', 'bounds'].includes(value.avoidance)) return false;
  if (!Array.isArray(value.parts) || !value.parts.length || value.parts.length > 500) return false;
  let points = 0;
  return value.parts.every(part => /^#[0-9a-f]{6}$/i.test(part.color) && Array.isArray(part.paths) && part.paths.length > 0 && part.paths.every(path => Array.isArray(path) && path.length >= 3 && (points += path.length) <= 40000 && path.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= -0.00001 && p.x <= 1.00001 && p.y >= -0.00001 && p.y <= value.aspect + 0.00001)));
}

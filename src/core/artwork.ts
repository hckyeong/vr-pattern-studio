import { boundsOf, intersectPaths, normalizePaths, outerContours, pathsArea, rectangle, subtractPaths } from './geometry';
import type { PatternSettings, PatternShape, Polygon, ResolvedCanvas, SvgArtwork } from './types';

export const MAX_ARTWORKS = 16;
export const MAX_ARTWORK_POINTS = 80000;

/** 기존 단일 SVG 설정과 새 복수 SVG 설정을 같은 순서 있는 목록으로 읽는다. */
export function getArtworks(settings: Pick<PatternSettings, 'artwork' | 'artworks'>): SvgArtwork[] {
  return settings.artworks ?? (settings.artwork ? [settings.artwork] : []);
}

/** 편집한 SVG 목록을 저장하고 이전 단일 필드의 중복 삽입을 막는다. */
export function withArtworks(settings: PatternSettings, artworks: SvgArtwork[]): PatternSettings {
  const next = { ...settings, artworks }; delete next.artwork; return next;
}

/** 한 바퀴 안의 각도로 정규화해 회전 입력과 손잡이의 연속 조작에 사용한다. */
export function normalizeArtworkRotation(rotation: number): number {
  return ((rotation % 360) + 360) % 360;
}

/** 직각의 미세 삼각함수 오차를 제거한 회전 계수를 만든다. */
function rotationComponents(artwork: SvgArtwork): { cosine: number; sine: number } {
  const radians = normalizeArtworkRotation(artwork.rotation ?? 0) * Math.PI / 180;
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  return { cosine: Math.abs(cosine) < 1e-12 ? 0 : cosine, sine: Math.abs(sine) < 1e-12 ? 0 : sine };
}

/** 회전한 사각 외곽까지 캔버스 안에 들어오도록 SVG 크기와 중심을 제한한다. */
export function constrainArtwork(artwork: SvgArtwork, canvas: ResolvedCanvas): SvgArtwork {
  const { cosine, sine } = rotationComponents(artwork);
  const spanX = Math.abs(cosine) + artwork.aspect * Math.abs(sine), spanY = Math.abs(sine) + artwork.aspect * Math.abs(cosine);
  const widthRatio = Math.min(Math.max(.001, artwork.widthRatio), 1, 1 / spanX, canvas.height / (canvas.width * spanY));
  const halfX = widthRatio * spanX / 2, halfY = widthRatio * canvas.width * spanY / canvas.height / 2;
  return { ...artwork, ...(artwork.rotation === undefined ? {} : { rotation: normalizeArtworkRotation(artwork.rotation) }), widthRatio, x: Math.max(halfX, Math.min(1 - halfX, artwork.x)), y: Math.max(halfY, Math.min(1 - halfY, artwork.y)) };
}

/** 원본 좌표에 균등 배율과 중심 회전을 적용해 표시·충돌·출력 좌표를 일치시킨다. */
export function transformArtworkPaths(paths: Polygon[], artwork: SvgArtwork, canvas: ResolvedCanvas): Polygon[] {
  const placed = constrainArtwork(artwork, canvas), width = placed.widthRatio * canvas.width;
  const cx = placed.x * canvas.width, cy = placed.y * canvas.height;
  const left = cx - width / 2, top = cy - width * placed.aspect / 2;
  const { cosine, sine } = rotationComponents(placed);
  const rotated = normalizeArtworkRotation(placed.rotation ?? 0) !== 0;
  return paths.map(path => path.map(point => {
    const x = left + point.x * width, y = top + point.y * width;
    if (!rotated) return { x, y };
    return { x: cx + (x - cx) * cosine - (y - cy) * sine, y: cy + (x - cx) * sine + (y - cy) * cosine };
  }));
}

/** 삽입 그림의 경로를 중심 회전까지 반영한 캔버스 도형으로 변환한다. */
export function artworkShapes(artwork: SvgArtwork, canvas: ResolvedCanvas): PatternShape[] {
  return artwork.parts.map((part, index) => {
    const paths = transformArtworkPaths(part.paths, artwork, canvas);
    return { id: `imported-artwork-${index}`, kind: 'artwork', color: part.color, paths, fillRule: 'nonzero', area: pathsArea(paths), bounds: boundsOf(paths) };
  });
}

/** SVG의 겹침과 흰 덧칠을 합성하고 지정한 채움 영역 안의 잉크 면적을 계산한다. */
export function artworkInkArea(shapes: PatternShape[], region?: Polygon[]): number {
  let painted: Polygon[] = [];
  for (const shape of shapes) {
    painted = shape.color.toLowerCase() === '#ffffff' ? subtractPaths(painted, shape.paths) : normalizePaths([...painted, ...shape.paths]);
  }
  return pathsArea(region ? intersectPaths(painted, region) : painted);
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

/** 원본 윤곽을 재사용해 회전한 보호 영역과 흰 덧칠을 반영한 잉크 면적을 준비한다. */
export function placeArtwork(artwork: SvgArtwork, canvas: ResolvedCanvas, preparedContour?: Polygon[]): { shapes: PatternShape[]; footprint: Polygon[]; inkArea: number } {
  const shapes = artworkShapes(artwork, canvas);
  const footprint = transformArtworkPaths(preparedContour ?? artworkContour(artwork), artwork, canvas);
  return { shapes, footprint, inkArea: artworkInkArea(shapes) };
}

/** 저장소와 워커 입력에서 벡터·배치·회전·간략화 범위를 검증한다. */
export function validArtwork(value: SvgArtwork): boolean {
  if (!value || typeof value.name !== 'string' || value.name.length > 200 || !Number.isFinite(value.aspect) || value.aspect < 0.005 || value.aspect > 200) return false;
  if (![value.x, value.y, value.widthRatio].every(v => Number.isFinite(v) && v >= 0 && v <= 1) || value.widthRatio < .00000001 || !['silhouette', 'outline', 'bounds'].includes(value.avoidance)) return false;
  if (value.rotation !== undefined && (!Number.isFinite(value.rotation) || Math.abs(value.rotation) > 360)) return false;
  if (value.contourTolerance !== undefined && (!Number.isFinite(value.contourTolerance) || value.contourTolerance < 0 || value.contourTolerance > 0.005)) return false;
  if (value.contourMode !== undefined && !['simplify', 'grouped-hull'].includes(value.contourMode)) return false;
  if (value.hullMergeRatio !== undefined && (!Number.isFinite(value.hullMergeRatio) || value.hullMergeRatio < 0 || value.hullMergeRatio > .1)) return false;
  if (!Array.isArray(value.parts) || !value.parts.length || value.parts.length > 500) return false;
  let points = 0;
  return value.parts.every(part => /^#[0-9a-f]{6}$/i.test(part.color) && Array.isArray(part.paths) && part.paths.length > 0 && part.paths.every(path => Array.isArray(path) && path.length >= 3 && (points += path.length) <= 40000 && path.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= -0.00001 && p.x <= 1.00001 && p.y >= -0.00001 && p.y <= value.aspect + 0.00001)));
}

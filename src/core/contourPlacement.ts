import { boundsOf, pathsConflict } from './geometry';
import type { PatternShape, Point, Polygon } from './types';

interface ContourEdge { start: Point; end: Point; length: number; cumulative: number }
export interface ContourGuide { paths: Polygon[]; edges: ContourEdge[]; length: number }

/** 최외곽의 길이에 비례해 고르게 후보를 뽑을 수 있는 변 목록을 만든다. */
export function createContourGuide(paths: Polygon[]): ContourGuide {
  const edges: ContourEdge[] = [];
  let length = 0;
  for (const path of paths) for (let index = 0; index < path.length; index++) {
    const start = path[index], end = path[(index + 1) % path.length];
    const edgeLength = Math.hypot(end.x - start.x, end.y - start.y);
    if (edgeLength <= 1e-8) continue;
    length += edgeLength; edges.push({ start, end, length: edgeLength, cumulative: length });
  }
  return { paths, edges, length };
}

/** 도형의 형태·회전·크기를 유지하고 최외곽에서 간격을 만족하는 가까운 위치로 옮긴다. */
export function placeNearContour(shape: PatternShape, guide: ContourGuide, sample: number, gap: number): PatternShape | null {
  if (!guide.edges.length) return null;
  const target = Math.min(1 - Number.EPSILON, Math.max(0, sample)) * guide.length;
  let low = 0, high = guide.edges.length - 1;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (guide.edges[middle].cumulative > target) high = middle; else low = middle + 1; }
  const edge = guide.edges[low], along = (target - edge.cumulative + edge.length) / edge.length;
  const x = edge.start.x + (edge.end.x - edge.start.x) * along, y = edge.start.y + (edge.end.y - edge.start.y) * along;
  // 정규화된 양의 외곽 경로에서 오른쪽 법선은 항상 그림의 바깥쪽이다.
  const nx = (edge.end.y - edge.start.y) / edge.length, ny = (edge.start.x - edge.end.x) / edge.length;
  const cx = (shape.bounds.minX + shape.bounds.maxX) / 2, cy = (shape.bounds.minY + shape.bounds.maxY) / 2;
  const extent = Math.hypot(shape.bounds.maxX - shape.bounds.minX, shape.bounds.maxY - shape.bounds.minY) + gap * 2 + 0.00001;
  /** 선택한 외곽선의 법선 방향으로 평행 이동한 실제 도형을 만든다. */
  function moved(distance: number): PatternShape {
    const dx = x + nx * distance - cx, dy = y + ny * distance - cy;
    const paths = shape.paths.map(path => path.map(point => ({ x: point.x + dx, y: point.y + dy })));
    return { ...shape, paths, bounds: boundsOf(paths) };
  }
  let lastCollision = 0;
  for (let step = 0; step <= 12; step++) {
    const distance = extent * step / 12, candidate = moved(distance);
    if (pathsConflict(candidate.paths, guide.paths, gap)) { lastCollision = distance; continue; }
    if (!step) return candidate;
    let inside = lastCollision, outside = distance, best = candidate;
    // 충돌하지 않는 쪽을 유지하면서 첫 안전 위치를 외곽 가까이 좁힌다.
    for (let iteration = 0; iteration < 12; iteration++) {
      const middle = (inside + outside) / 2, trial = moved(middle);
      if (pathsConflict(trial.paths, guide.paths, gap)) inside = middle;
      else { outside = middle; best = trial; }
    }
    return best;
  }
  return null;
}

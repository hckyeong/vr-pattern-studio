import { areaD, areaPathsD, differenceD, EndType, FillRule, inflatePathsD, intersectD, JoinType, unionD } from 'clipper2-ts';
import type { Bounds, Point, Polygon } from './types';

/** 사각형 외곽선을 양의 방향으로 만든다. */
export function rectangle(x: number, y: number, width: number, height: number): Polygon[] {
  return [[{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]];
}
/** 채움 규칙을 적용해 중복 외곽선과 구멍을 정규화한다. */
export function normalizePaths(paths: Polygon[], rule: 'evenodd' | 'nonzero' = 'nonzero'): Polygon[] {
  return unionD(paths, [], rule === 'evenodd' ? FillRule.EvenOdd : FillRule.NonZero, 6);
}
/** 오목한 외곽과 떨어진 조각은 유지하고 닫힌 내부 구멍만 보호 면으로 채운다. */
export function outerContours(paths: Polygon[]): Polygon[] {
  return normalizePaths(normalizePaths(paths).filter(path => areaD(path) > 0));
}
/** 정규화한 외곽선에서 구멍을 뺀 실제 잉크 면적을 계산한다. */
export function pathsArea(paths: Polygon[]): number { return Math.abs(areaPathsD(paths)); }
/** 실제 벡터 교집합을 계산한다. */
export function intersectPaths(a: Polygon[], b: Polygon[]): Polygon[] { return intersectD(a, b, FillRule.NonZero, 6); }
/** 실제 벡터 차집합을 계산한다. */
export function subtractPaths(a: Polygon[], b: Polygon[]): Polygon[] { return differenceD(a, b, FillRule.NonZero, 6); }
/** 간격만큼 벡터 외곽선을 확장한다. */
export function offsetPaths(paths: Polygon[], gap: number): Polygon[] { return inflatePathsD(paths, gap, JoinType.Round, EndType.Polygon, 2, 6, Math.max(0.000001, gap / 1000)); }
/** 열린 중심선을 둥근 끝을 가진 실제 잉크 외곽선으로 확장한다. */
export function strokePaths(paths: Polygon[], width: number): Polygon[] { return inflatePathsD(paths, width / 2, JoinType.Round, EndType.Round, 2, 6, Math.max(0.000001, width / 1000)); }
/** 각진 모서리와 평평한 끝을 유지해 특징점용 선을 실제 잉크 외곽선으로 만든다. */
export function angularStrokePaths(paths: Polygon[], width: number): Polygon[] { return inflatePathsD(paths, width / 2, JoinType.Miter, EndType.Butt, 2, 6); }
/** 후보 검색용 축 정렬 경계 상자를 계산한다. */
export function boundsOf(paths: Polygon[]): Bounds {
  const result = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const path of paths) for (const point of path) {
    result.minX = Math.min(result.minX, point.x); result.maxX = Math.max(result.maxX, point.x);
    result.minY = Math.min(result.minY, point.y); result.maxY = Math.max(result.maxY, point.y);
  }
  return result;
}
/** 점에서 닫힌 선분까지의 제곱 거리를 계산한다. */
function pointDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return (point.x - a.x - t * dx) ** 2 + (point.y - a.y - t * dy) ** 2;
}
/** 실제 잉크 교차와 모든 경계 선분의 거리를 검사한다. */
export function pathsConflict(a: Polygon[], b: Polygon[], gap: number): boolean {
  if (pathsArea(intersectPaths(a, b)) > 1e-12) return true;
  const threshold = Math.max(0.000001, gap - 0.000001) ** 2;
  for (const pa of a) for (const pb of b) for (let i = 0; i < pa.length; i++) for (let j = 0; j < pb.length; j++) {
    const p = pa[i], q = pa[(i + 1) % pa.length], r = pb[j], s = pb[(j + 1) % pb.length];
    if (Math.min(pointDistance(p, r, s), pointDistance(q, r, s), pointDistance(r, p, q), pointDistance(s, p, q)) < threshold) return true;
  }
  return false;
}
/** 도형의 모든 벡터 점을 회전하고 이동한다. */
export function transformPaths(paths: Polygon[], x: number, y: number, angle: number): Polygon[] {
  const c = Math.cos(angle), s = Math.sin(angle);
  return paths.map(path => path.map(p => ({ x: x + p.x * c - p.y * s, y: y + p.x * s + p.y * c })));
}

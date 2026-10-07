import RBush from 'rbush';
import { EndType, inflatePathsD, JoinType } from 'clipper2-ts';
import { boundsOf, normalizePaths, outerContours, pathsConflictPrepared, prepareCollision, subtractPaths } from './geometry';
import type { Bounds, Point, Polygon } from './types';

export const DEFAULT_HULL_MERGE_RATIO = .02;
const CLIPPING_SAFETY_MARGIN = .000002;

export interface GroupedHullContour {
  paths: Polygon[];
  originalSegments: number;
  simplifiedSegments: number;
  applied: boolean;
  groups: number;
  mergeDistance: number;
}

interface Component extends Bounds { index: number; path: Polygon }

/** 세 점의 회전 방향을 계산해 볼록 껍질 안쪽의 중간 점을 구분한다. */
function turn(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** 정렬한 점들의 위·아래 사슬을 연결해 원본 점들을 감싸는 볼록 다각형을 만든다. */
function convexHull(points: Point[]): Polygon {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const unique = sorted.filter((point, index) => !index || point.x !== sorted[index - 1].x || point.y !== sorted[index - 1].y);
  if (unique.length < 3) return unique.map(point => ({ ...point }));
  const lower: Point[] = [], upper: Point[] = [];
  for (const point of unique) {
    while (lower.length > 1 && turn(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  for (let index = unique.length - 1; index >= 0; index--) {
    const point = unique[index];
    while (upper.length > 1 && turn(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1)).map(point => ({ ...point }));
}

/** 실제 윤곽 사이 거리가 묶음 기준 이하인 연결 조각들을 각각 모은다. */
function connectedGroups(paths: Polygon[], mergeDistance: number): Polygon[][] {
  const components = paths.map((path, index) => ({ ...boundsOf([path]), index, path }));
  const remaining = new RBush<Component>().load(components);
  const visited = new Set<number>(), groups: Polygon[][] = [];
  // 기존 거리 판정의 열린 임계값과 소수 여섯 자리 경계를 포함하도록 검색에 미세 여유를 둔다.
  const radius = mergeDistance + CLIPPING_SAFETY_MARGIN;
  for (const seed of components) {
    if (visited.has(seed.index)) continue;
    const queue = [seed]; visited.add(seed.index); remaining.remove(seed);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor];
      const candidates = remaining.search({ minX: current.minX - radius, minY: current.minY - radius, maxX: current.maxX + radius, maxY: current.maxY + radius });
      if (!candidates.length) continue;
      const collision = prepareCollision([current.path]);
      for (const candidate of candidates) {
        if (!pathsConflictPrepared([candidate.path], collision, radius)) continue;
        visited.add(candidate.index); remaining.remove(candidate); queue.push(candidate);
      }
    }
    groups.push(queue.sort((a, b) => a.index - b.index).map(component => component.path));
  }
  return groups;
}

/** 덩어리별 껍질의 반올림 오차를 보수적으로 처리하고 원본을 포함한 계산 보호 면을 반환한다. */
export function groupedHullContour(paths: Polygon[], mergeDistance: number): GroupedHullContour {
  if (!Number.isFinite(mergeDistance) || mergeDistance < 0) throw new RangeError('덩어리 묶음 거리는 0 이상의 유한한 값이어야 합니다.');
  const originalSegments = paths.reduce((count, path) => count + path.length, 0);
  const original = { paths, originalSegments, simplifiedSegments: originalSegments, applied: false, groups: 0, mergeDistance };
  if (!originalSegments) return original;
  const groups = connectedGroups(outerContours(paths), mergeDistance);
  if (!groups.length) return original;
  const hulls = groups.map(group => convexHull(group.flat()));
  if (hulls.some(path => path.length < 3)) return { ...original, groups: groups.length };
  // 겹치는 볼록 껍질은 합쳐 내부 경계가 근접 배치 후보로 선택되지 않도록 한다.
  let candidate = normalizePaths(hulls);
  // 겹친 껍질을 합칠 때 생기는 소수 여섯 자리 교점 오차만 두 눈금의 외측 여유로 보정한다.
  // 보정 후에도 원본 포함 검사를 다시 수행하며 누락이 남으면 원본 경계를 유지한다.
  if (candidate.length && subtractPaths(paths, candidate).length) {
    candidate = inflatePathsD(candidate, CLIPPING_SAFETY_MARGIN, JoinType.Miter, EndType.Polygon, 2, 6);
  }
  if (!candidate.length || subtractPaths(paths, candidate).length) return { ...original, groups: groups.length };
  const simplifiedSegments = candidate.reduce((count, path) => count + path.length, 0);
  if (simplifiedSegments === originalSegments && !subtractPaths(candidate, paths).length) return { ...original, groups: groups.length };
  return { paths: candidate, originalSegments, simplifiedSegments, applied: true, groups: groups.length, mergeDistance };
}

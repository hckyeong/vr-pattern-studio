import { areaD, EndType, inflatePathsD, JoinType, simplifyPathsD } from 'clipper2-ts';
import { normalizePaths, offsetPaths, subtractPaths } from './geometry';
import type { Polygon } from './types';

export interface SimplifiedContour {
  paths: Polygon[];
  originalSegments: number;
  simplifiedSegments: number;
  applied: boolean;
  tolerance: number;
}

/** 닫힌 경로의 꼭짓점 수를 합산해 충돌 계산용 선분 수를 구한다. */
function segmentCount(paths: Polygon[]): number {
  return paths.reduce((count, path) => count + path.length, 0);
}

/** 면적 있는 폐곡선의 방향을 구하고 붕괴한 경로는 0으로 구분한다. */
function contourDirection(path: Polygon): number {
  if (path.length < 3) return 0;
  const area = areaD(path);
  return Number.isFinite(area) ? Math.sign(area) : 0;
}

/** 정규화한 모든 결과가 면적 있는 폐곡선인지 검사한다. */
function hasClosedContours(paths: Polygon[]): boolean {
  return paths.length > 0 && paths.every(path => contourDirection(path) !== 0);
}

/** 원본 전체 포함과 제한된 외측 확장을 검증한 계산용 보호 면만 간략화한다. */
export function simplifyCollisionContour(paths: Polygon[], tolerance: number): SimplifiedContour {
  if (!Number.isFinite(tolerance) || tolerance < 0 || !Number.isFinite(tolerance * 3)) {
    throw new RangeError('윤곽 간략화 허용 오차는 0 이상의 유한한 작업 단위 값이어야 합니다.');
  }
  const originalSegments = segmentCount(paths);
  const original = { paths, originalSegments, simplifiedSegments: originalSegments, applied: false, tolerance };
  if (!tolerance || originalSegments < 128) return original;
  // 국소 점 제거의 누적 오차에 여유를 두고 붕괴한 작은 조각은 해당 경로의 원본을 유지한다.
  const reduced = simplifyPathsD(paths, tolerance / 2, true).map((path, index) => {
    const direction = contourDirection(path);
    return direction && direction === contourDirection(paths[index]) ? path : paths[index];
  });
  if (segmentCount(reduced) >= originalSegments) return original;
  const normalized = normalizePaths(reduced);
  if (!hasClosedContours(normalized)) return original;
  // 모서리 연결 길이를 두 배로 제한하고 각진 연결의 불필요한 추가 선분을 줄인다.
  const candidate = inflatePathsD(normalized, tolerance, JoinType.Miter, EndType.Polygon, 2, 6);
  const simplifiedSegments = segmentCount(candidate);
  if (simplifiedSegments >= originalSegments || !hasClosedContours(candidate)) return original;
  if (subtractPaths(paths, candidate).length !== 0) return original;
  // 좁은 틈의 합침은 허용하되 오차의 세 배 밖에 있는 구멍·오목한 공간은 반드시 남긴다.
  const expansionLimit = offsetPaths(paths, tolerance * 3);
  if (subtractPaths(candidate, expansionLimit).length !== 0) return original;
  return { paths: candidate, originalSegments, simplifiedSegments, applied: true, tolerance };
}

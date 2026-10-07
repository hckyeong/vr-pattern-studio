import { describe, expect, it } from 'vitest';
import { areaD } from 'clipper2-ts';
import { normalizePaths, offsetPaths, pathsConflict, rectangle, subtractPaths } from '../src/core/geometry';
import { simplifyCollisionContour } from '../src/core/simplifyContour';
import type { SimplifiedContour } from '../src/core/simplifyContour';
import type { Polygon } from '../src/core/types';

/** 선분이 많은 곡선과 작은 분리 조각을 재현할 원형 폐곡선을 만든다. */
function circle(x: number, y: number, radius: number, count: number): Polygon {
  const path: Polygon = [];
  for (let index = 0; index < count; index++) {
    const angle = index * Math.PI * 2 / count;
    path.push({ x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius });
  }
  return path;
}

/** 직선 근처의 세밀한 굴곡을 추가해 정규화 후에도 복잡한 오목한 윤곽을 만든다. */
function detailedConcave(): Polygon[] {
  const corners = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 70 }, { x: 100, y: 70 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const path: Polygon = [];
  for (let edge = 0; edge < corners.length; edge++) {
    const start = corners[edge], end = corners[(edge + 1) % corners.length];
    const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
    for (let index = 0; index < 40; index++) {
      const along = index / 40, wiggle = .05 * Math.sin(Math.PI * along);
      path.push({ x: start.x + dx * along + dy * wiggle / length, y: start.y + dy * along - dx * wiggle / length });
    }
  }
  return normalizePaths([path]);
}

/** 채택 결과가 원본 전체를 포함하면서 오차의 세 배 확장 범위 안에 있는지 확인한다. */
function expectConservative(original: Polygon[], result: SimplifiedContour): void {
  expect(subtractPaths(original, result.paths)).toHaveLength(0);
  if (result.tolerance) expect(subtractPaths(result.paths, offsetPaths(original, result.tolerance * 3))).toHaveLength(0);
  expect(result.originalSegments).toBe(original.reduce((count, path) => count + path.length, 0));
  expect(result.simplifiedSegments).toBe(result.paths.reduce((count, path) => count + path.length, 0));
}

describe('보수적인 계산용 SVG 보호 윤곽 간략화', () => {
  it('고밀도 폐곡선의 선분을 줄이면서 모든 원본 면과 제한된 외측 확장을 검증한다', () => {
    const original = normalizePaths([circle(0, 0, 100, 512)]), result = simplifyCollisionContour(original, .25);
    expect(result.applied).toBe(true);
    expect(result.simplifiedSegments).toBeLessThan(result.originalSegments / 2);
    expect(result.tolerance).toBe(.25);
    expectConservative(original, result);
  });

  it('128선분 경계에서도 실제 작업 좌표의 허용 오차를 사용한다', () => {
    const original = normalizePaths([circle(.5, .5, .45, 128)]), result = simplifyCollisionContour(original, .005);
    expect(result.originalSegments).toBe(128);
    expect(result.applied).toBe(true);
    expect(result.simplifiedSegments).toBeLessThan(128);
    expectConservative(original, result);
  });

  it('닫힌 구멍을 유지하고 구멍 중앙을 보호 면으로 채우지 않는다', () => {
    const original = normalizePaths([circle(0, 0, 100, 512), circle(0, 0, 40, 256).reverse()]);
    const result = simplifyCollisionContour(original, .25);
    expect(result.applied).toBe(true);
    expect(result.paths.filter(path => areaD(path) < 0)).toHaveLength(1);
    expect(pathsConflict(result.paths, rectangle(-2, -2, 4, 4), 0)).toBe(false);
    expectConservative(original, result);
  });

  it('오목한 윤곽을 유지하고 오차보다 넓은 바깥 공간을 열어 둔다', () => {
    const original = detailedConcave(), result = simplifyCollisionContour(original, .2);
    expect(result.originalSegments).toBeGreaterThanOrEqual(128);
    expect(result.applied).toBe(true);
    expect(pathsConflict(result.paths, rectangle(50, 20, 5, 5), 0)).toBe(false);
    expectConservative(original, result);
  });

  it('분리된 큰 조각과 붕괴하기 쉬운 작은 조각을 모두 포함한다', () => {
    const small = circle(250, 0, .02, 32), original = normalizePaths([circle(0, 0, 100, 512), small]);
    const result = simplifyCollisionContour(original, .25);
    expect(result.applied).toBe(true);
    expect(result.paths.filter(path => areaD(path) > 0)).toHaveLength(2);
    expect(subtractPaths([small], result.paths)).toHaveLength(0);
    expect(pathsConflict(result.paths, rectangle(150, -2, 4, 4), 0)).toBe(false);
    expectConservative(original, result);
  });

  it('확장 범위 안의 좁은 간극과 작은 구멍만 합칠 수 있고 모든 원본 면을 포함한다', () => {
    const narrowGap = normalizePaths([circle(0, 0, 100, 256), circle(200.1, 0, 100, 256)]);
    const tinyHole = normalizePaths([circle(0, 0, 100, 512), circle(0, 0, .1, 128).reverse()]);
    for (const original of [narrowGap, tinyHole]) {
      const result = simplifyCollisionContour(original, .25);
      expect(result.applied).toBe(true);
      expect(result.simplifiedSegments).toBeLessThan(result.originalSegments);
      expectConservative(original, result);
    }
  });

  it('폐곡선이 붕괴하거나 최종 선분 감소가 없으면 원본을 사용한다', () => {
    const original = normalizePaths([circle(0, 0, 100, 512)]);
    for (const tolerance of [1000, 1e-12]) {
      const result = simplifyCollisionContour(original, tolerance);
      expect(result.applied).toBe(false);
      expect(result.paths).toBe(original);
      expect(result.simplifiedSegments).toBe(result.originalSegments);
    }
  });

  it('오차 0과 128선분 미만 및 빈 경로는 원본과 원래 통계를 유지한다', () => {
    const detailed = normalizePaths([circle(0, 0, 100, 512)]), simple = normalizePaths([circle(0, 0, 100, 96)]);
    for (const [paths, tolerance] of [[detailed, 0], [simple, .25], [[], .25]] as [Polygon[], number][]) {
      const result = simplifyCollisionContour(paths, tolerance);
      expect(result.paths).toBe(paths);
      expect(result.applied).toBe(false);
      expect(result.tolerance).toBe(tolerance);
      expect(result.simplifiedSegments).toBe(result.originalSegments);
    }
  });

  it('음수와 유한하지 않거나 계산 범위를 넘는 허용 오차를 거부한다', () => {
    const original = normalizePaths([circle(0, 0, 100, 512)]), before = structuredClone(original);
    for (const tolerance of [-1, NaN, Infinity, -Infinity, Number.MAX_VALUE]) {
      expect(() => simplifyCollisionContour(original, tolerance)).toThrow(RangeError);
      expect(() => simplifyCollisionContour([], tolerance)).toThrow(RangeError);
    }
    expect(original).toEqual(before);
  });

  it('동결한 원본을 변경하지 않고 반복 실행 결과와 통계를 재현한다', () => {
    const original = normalizePaths([circle(0, 0, 100, 512)]), before = structuredClone(original);
    for (const path of original) {
      for (const point of path) Object.freeze(point);
      Object.freeze(path);
    }
    Object.freeze(original);
    const first = simplifyCollisionContour(original, .25);
    expect(first.applied).toBe(true);
    expect(first.paths).not.toBe(original);
    for (let repeat = 0; repeat < 3; repeat++) expect(simplifyCollisionContour(original, .25)).toEqual(first);
    expect(original).toEqual(before);
    expectConservative(original, first);
  });
});

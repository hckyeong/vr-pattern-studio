import { describe, expect, it } from 'vitest';
import { createContourGuide, placeNearContour } from '../src/core/contourPlacement';
import { boundsOf, normalizePaths, outerContours, pathsArea, pathsConflict, pathsConflictPrepared, prepareCollision, rectangle } from '../src/core/geometry';
import type { PatternShape, Polygon } from '../src/core/types';

/** 경로 순서를 바꿔도 준비 판정이 기준 판정과 같은지 확인한다. */
function expectEquivalent(a: Polygon[], b: Polygon[], gap: number, expected?: boolean): void {
  const forward = pathsConflict(a, b, gap), reverse = pathsConflict(b, a, gap);
  expect(pathsConflictPrepared(a, prepareCollision(b), gap)).toBe(forward);
  expect(pathsConflictPrepared(b, prepareCollision(a), gap)).toBe(reverse);
  if (expected !== undefined) {
    expect(forward).toBe(expected);
    expect(reverse).toBe(expected);
  }
}

/** 다각형 비교 사례를 재현할 수 있도록 결정적인 난수를 만든다. */
function seededRandom(seed: number): () => number {
  /** 고정된 정수 상태를 다음 난수 값으로 진행한다. */
  return function next(): number {
    seed = Math.imul(seed, 1664525) + 1013904223;
    return (seed >>> 0) / 4294967296;
  };
}

/** 크기와 오목함을 달리한 단순 다각형 및 떨어진 조각을 만든다. */
function randomPaths(random: () => number, x: number, y: number): Polygon[] {
  const count = 3 + Math.floor(random() * 10), radius = 1 + random() * 12, phase = random() * Math.PI * 2;
  const path: Polygon = [];
  for (let index = 0; index < count; index++) {
    const angle = phase + index * Math.PI * 2 / count, extent = radius * (.15 + random() * .85);
    path.push({ x: x + Math.cos(angle) * extent, y: y + Math.sin(angle) * extent });
  }
  return random() < .25 ? [path, ...rectangle(x + radius * 2, y - radius, radius / 3, radius / 2)] : [path];
}

/** 평행 이동 위치를 기존 배치와 정확히 비교할 비대칭 도형을 만든다. */
function placementShape(): PatternShape {
  const paths = [[{ x: -13, y: -6 }, { x: 18, y: 2 }, { x: -4, y: 15 }]];
  return { id: '준비-충돌-비교', kind: 'triangle', color: '#177f80', paths, bounds: boundsOf(paths), area: pathsArea(paths), fillRule: 'nonzero' };
}

describe('선분 공간 인덱스를 준비한 실제 벡터 충돌', () => {
  it('경계끼리 멀리 떨어진 완전 포함도 교집합으로 판정한다', () => {
    expectEquivalent(rectangle(0, 0, 100, 100), rectangle(40, 40, 2, 2), 0, true);
    expectEquivalent(rectangle(-100, -100, 200, 200), rectangle(-4, -4, 8, 8), .1, true);
  });

  it('구멍과 최외곽 보호면, 오목한 공간과 분리 조각을 유지한다', () => {
    const ring = normalizePaths([...rectangle(0, 0, 20, 20), ...rectangle(3, 3, 14, 14)], 'evenodd');
    expectEquivalent(rectangle(7, 7, 3, 3), ring, 2, false);
    expectEquivalent(rectangle(3.5, 7, 3, 3), ring, 2, true);
    expectEquivalent(rectangle(7, 7, 3, 3), outerContours(ring), 2, true);
    const concave = [[{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 7 }, { x: 10, y: 7 }, { x: 10, y: 10 }, { x: 0, y: 10 }]];
    expectEquivalent(rectangle(5, 2, 2, 2), concave, .3, false);
    expectEquivalent(rectangle(2.9, 2, 2, 2), concave, .3, true);
    const split = [...rectangle(0, 0, 2, 10), ...rectangle(8, 0, 2, 10)];
    expectEquivalent(rectangle(3, 3, 4, 4), split, .2, false);
    expectEquivalent(rectangle(1.9, 3, 4, 4), split, .2, true);
  });

  it('간격 0부터 일반 간격까지 엄격한 임계값 안팎을 기준과 동일하게 판정한다', () => {
    const a = rectangle(-1, -1, 1, 1);
    for (const gap of [0, 1e-8, 1e-6, 2e-6, .25, 8]) {
      const threshold = Math.max(1e-6, gap - 1e-6);
      for (const factor of [1 - 1e-7, 1, 1 + 1e-7]) {
        // 사각형 끝점의 뺄셈 반올림은 기준 결과를 따르고, 평행 선분은 엄격한 등호 경계를 확인한다.
        expectEquivalent(a, rectangle(threshold * factor, -1, 1, 1), gap, factor === 1 ? undefined : factor < 1);
        expectEquivalent([[{ x: 0, y: 0 }, { x: 0, y: 1 }]], [[{ x: threshold * factor, y: 0 }, { x: threshold * factor, y: 1 }]], gap, factor < 1);
      }
    }
  });

  it('맞닿은 경계와 공선, 짧거나 길이가 0인 선분도 같은 계산으로 검사한다', () => {
    expectEquivalent(rectangle(0, 0, 2, 2), rectangle(2, 0, 2, 2), 0, true);
    expectEquivalent([[{ x: 0, y: 0 }, { x: 10, y: 0 }]], [[{ x: 2, y: 0 }, { x: 4, y: 0 }]], 0, true);
    expectEquivalent([[{ x: 0, y: 0 }, { x: 10, y: 0 }]], [[{ x: 2, y: 2e-6 }, { x: 4, y: 2e-6 }]], 0, false);
    expectEquivalent([[{ x: 1, y: 0 }]], [[{ x: 0, y: 0 }, { x: 2, y: 0 }]], 0, true);
    const tiny = [[{ x: 0, y: 0 }, { x: 1e-12, y: 0 }, { x: 0, y: 1e-12 }]];
    expectEquivalent(tiny, [[{ x: 2.5e-7, y: 0 }, { x: 2.5e-7 + 1e-12, y: 0 }, { x: 2.5e-7, y: 1e-12 }]], 0, true);
    expectEquivalent(tiny, [[{ x: 2e-6, y: 0 }, { x: 2e-6 + 1e-12, y: 0 }, { x: 2e-6, y: 1e-12 }]], 0, false);
    // 면적 없는 두 선의 내부 교차도 기존의 네 끝점 거리 판정 결과를 보존한다.
    expectEquivalent([[{ x: -2, y: 0 }, { x: 2, y: 0 }]], [[{ x: 0, y: -2 }, { x: 0, y: 2 }]], 0, false);
  });

  it('큰 양수·음수 좌표에서도 검색 여유가 최종 거리 조건을 바꾸지 않는다', () => {
    const gap = 1, threshold = gap - 1e-6;
    for (const origin of [1e8, -1e8]) {
      const a = rectangle(origin, origin, 10, 10), roundingMargin = Number.EPSILON * Math.abs(origin) * 16;
      expectEquivalent(a, rectangle(origin + 10 + threshold - roundingMargin, origin, 10, 10), gap, true);
      expectEquivalent(a, rectangle(origin + 10 + threshold + roundingMargin, origin, 10, 10), gap, false);
      expectEquivalent(a, rectangle(origin + 10 + threshold, origin, 10, 10), gap);
      expectEquivalent(a, rectangle(origin + 10, origin + 10, 10, 10), 0, true);
    }
  });

  it('재현 가능한 무작위 다각형과 복수 경로에서 기존 알고리즘과 일치한다', () => {
    const random = seededRandom(0x735a6f13);
    for (let iteration = 0; iteration < 160; iteration++) {
      const scale = iteration % 4 === 0 ? .001 : iteration % 4 === 1 ? 1000 : 1;
      const a = randomPaths(random, 0, 0).map(path => path.map(point => ({ x: point.x * scale, y: point.y * scale })));
      const b = randomPaths(random, random() * 40 - 20, random() * 40 - 20).map(path => path.map(point => ({ x: point.x * scale, y: point.y * scale })));
      const preparedA = prepareCollision(a), preparedB = prepareCollision(b);
      for (const gap of [0, .01 * scale, 2 * scale]) {
        expect(pathsConflictPrepared(a, preparedB, gap)).toBe(pathsConflict(a, b, gap));
        expect(pathsConflictPrepared(b, preparedA, gap)).toBe(pathsConflict(b, a, gap));
      }
    }
  });

  it('준비와 반복 판정이 입력을 변경하지 않고 원본 변경과 공개 자료 변조를 차단한다', () => {
    const source = [...rectangle(0, 0, 5, 5), ...rectangle(10, 10, 2, 2)], original = structuredClone(source);
    const prepared = prepareCollision(source), candidate = rectangle(5.5, 0, 2, 2), candidateBefore = structuredClone(candidate);
    expect(prepared.paths).toEqual(source);
    expect(prepared.paths).not.toBe(source);
    expect(prepared.segmentCount).toBe(8);
    expect(prepared.bounds).toEqual(boundsOf(source));
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.bounds)).toBe(true);
    expect(Object.isFrozen(prepared.paths)).toBe(true);
    for (const path of prepared.paths) {
      expect(Object.isFrozen(path)).toBe(true);
      for (const point of path) expect(Object.isFrozen(point)).toBe(true);
    }
    for (let repeat = 0; repeat < 3; repeat++) expect(pathsConflictPrepared(candidate, prepared, 1)).toBe(true);
    expect(source).toEqual(original);
    expect(candidate).toEqual(candidateBefore);
    expect(Reflect.set(prepared.paths[0][0], 'x', -1000)).toBe(false);
    expect(Reflect.set(prepared.bounds, 'minX', -1000)).toBe(false);
    expect(() => prepared.paths.push([])).toThrow(TypeError);
    source[0][0].x = 1000;
    source.push(...rectangle(100, 100, 20, 20));
    expect(prepared.paths).toEqual(original);
    expect(prepared.segmentCount).toBe(8);
    expect(pathsConflictPrepared(candidate, prepared, 1)).toBe(pathsConflict(candidate, original, 1));
  });

  it('빈 경로와 빈 준비 자료를 기존 판정과 동일하게 처리한다', () => {
    expectEquivalent([], rectangle(0, 0, 1, 1), 0, false);
    expectEquivalent([[]], rectangle(0, 0, 1, 1), 2, false);
    expectEquivalent([], [[]], 2, false);
    expect(prepareCollision([[]]).segmentCount).toBe(0);
  });

  it('준비 자료 유무에 따라 윤곽 탐색 결과와 모든 좌표가 바뀌지 않는다', () => {
    const contours = [rectangle(100, 100, 200, 180), [[{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 70 }, { x: 100, y: 70 }, { x: 100, y: 100 }, { x: 0, y: 100 }]], [...rectangle(0, 0, 20, 100), ...rectangle(80, 0, 20, 100)]];
    const shape = placementShape(), shapeBefore = structuredClone(shape);
    for (const paths of contours) {
      const original = createContourGuide(paths), prepared = createContourGuide(paths, prepareCollision(paths));
      expect(prepared.edges).toEqual(original.edges);
      expect(prepared.length).toBe(original.length);
      for (const gap of [0, .01, 8]) for (let sample = 0; sample < 20; sample++) {
        expect(placeNearContour(shape, prepared, (sample + .3) / 20, gap)).toEqual(placeNearContour(shape, original, (sample + .3) / 20, gap));
      }
    }
    expect(shape).toEqual(shapeBefore);
  });
});

import { describe, expect, it } from 'vitest';
import { groupedHullContour } from '../src/core/groupedHull';
import { normalizePaths, pathsArea, rectangle, subtractPaths } from '../src/core/geometry';
import type { Polygon } from '../src/core/types';

/** 안쪽으로 크게 꺾인 ㄴ자 윤곽을 지정한 위치에 만든다. */
function corner(x = 0): Polygon {
  return [{ x, y: 0 }, { x: x + 10, y: 0 }, { x: x + 10, y: 2 }, { x: x + 2, y: 2 }, { x: x + 2, y: 10 }, { x, y: 10 }];
}

describe('큰 덩어리별 볼록 껍질', () => {
  it('선분이 적은 오목 도형도 원본을 포함하는 볼록 경계로 바꾼다', () => {
    const original = [corner()], before = structuredClone(original);
    const result = groupedHullContour(original, 0);
    expect(result).toMatchObject({ applied: true, groups: 1, originalSegments: 6, simplifiedSegments: 5 });
    expect(subtractPaths(original, result.paths)).toEqual([]);
    expect(pathsArea(result.paths)).toBeGreaterThan(pathsArea(original));
    expect(original).toEqual(before);
    expect(groupedHullContour(original, 0)).toEqual(result);
  });

  it('떨어진 큰 덩어리와 작은 독립 조각을 버리지 않는다', () => {
    const paths = [corner(), corner(100), ...rectangle(200, 0, .1, .1)];
    const result = groupedHullContour(paths, 2);
    expect(result.groups).toBe(3);
    expect(result.paths).toHaveLength(3);
    expect(subtractPaths(paths, result.paths)).toEqual([]);
  });

  it('정확히 기준 거리인 조각과 연쇄로 가까운 조각들을 묶는다', () => {
    const paths = [...rectangle(0, 0, 10, 10), ...rectangle(12, 0, 10, 10), ...rectangle(24, 0, 10, 10)];
    expect(groupedHullContour(paths, 1.99).groups).toBe(3);
    const result = groupedHullContour(paths, 2);
    expect(result).toMatchObject({ groups: 1, simplifiedSegments: 4 });
    expect(pathsArea(result.paths)).toBe(340);
  });

  it('경계 상자가 겹쳐도 실제 윤곽이 멀면 묶지 않는다', () => {
    const paths = [corner(), ...rectangle(7, 7, 2, 2)];
    const result = groupedHullContour(paths, 1);
    expect(result.groups).toBe(2);
    expect(result.paths).toHaveLength(2);
    expect(subtractPaths(paths, result.paths)).toEqual([]);
  });

  it('내부 구멍은 보호 면으로 채우고 원본 채움 방향을 처리한다', () => {
    const paths = normalizePaths([...rectangle(0, 0, 10, 10), rectangle(2, 2, 6, 6)[0].reverse()]);
    const result = groupedHullContour(paths, 0);
    expect(result).toMatchObject({ applied: true, groups: 1, simplifiedSegments: 4 });
    expect(pathsArea(result.paths)).toBe(100);
    expect(subtractPaths(paths, result.paths)).toEqual([]);
    expect(groupedHullContour(paths.map(path => [...path].reverse()), 0).paths).toEqual(result.paths);
  });

  it('볼록 껍질끼리 겹치면 합쳐 내부 경계를 제거한다', () => {
    const paths = [corner(), ...rectangle(4, 4, 1, 1)];
    const result = groupedHullContour(paths, 0);
    expect(result.groups).toBe(2);
    expect(result.paths).toHaveLength(1);
    expect(subtractPaths(paths, result.paths)).toEqual([]);
  });

  it('접한 조각과 중복점은 처리하고 이미 볼록한 경계는 유지한다', () => {
    const paths = [...rectangle(0, 0, 10, 10), ...rectangle(10, 0, 10, 10)];
    expect(groupedHullContour(paths, 0)).toMatchObject({ groups: 1, simplifiedSegments: 4 });
    const original = rectangle(0, 0, 10, 10);
    expect(groupedHullContour(original, 0)).toMatchObject({ applied: false, paths: original });
    const repeated = [...original[0], original[0][0]];
    expect(groupedHullContour([repeated], 0).simplifiedSegments).toBe(4);
  });

  it('빈 입력과 유효하지 않은 묶음 거리를 처리한다', () => {
    expect(groupedHullContour([], 0)).toMatchObject({ paths: [], applied: false, groups: 0 });
    for (const distance of [-1, NaN, Infinity]) expect(() => groupedHullContour([corner()], distance)).toThrow(RangeError);
  });

  it('껍질 합성 교점의 반올림으로 원본의 미세한 조각이 빠지지 않는다', () => {
    // 실제 꽃나무 원고에서 포함 검사가 실패한 좌표를 두 경로로 줄인 회귀 입력이다.
    const paths = [
      [{ x: 5427.8824, y: 2041.7260294706728 }, { x: 5380.4812, y: 2053.498229470673 }, { x: 5438.8405999999995, y: 1959.5186294706727 }],
      [{ x: 5410.6542, y: 2060.3468294706727 }, { x: 5442.087799999999, y: 2029.474229470673 }, { x: 5448.755999999999, y: 2014.0302294706728 }, { x: 5469.9662, y: 2009.2056294706729 }],
    ];
    const result = groupedHullContour(paths, 0);
    expect(result.applied).toBe(true);
    expect(subtractPaths(paths, result.paths)).toEqual([]);
  });
});

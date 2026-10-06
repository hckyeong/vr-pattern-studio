import { describe, expect, it } from 'vitest';
import { generatePattern } from '../src/core/generator';
import { pathsConflict } from '../src/core/geometry';
import { createRandom } from '../src/core/random';
import { DEFAULT_SETTINGS, validateSettings } from '../src/core/settings';
import { createShape } from '../src/core/shapes';

describe('계단 도형', () => {
  // 직각 계단이 단수와 굵기를 바꾸어 생성되는지 실제 경계선으로 검사한다.
  it('계단만 선택하면 다양한 직각 형태가 생성된다', () => {
    const input = structuredClone(DEFAULT_SETTINGS), random = createRandom('계단-형태');
    input.weights = { triangle: 0, polygon: 0, frame: 0, arc: 0, symbol: 0, cylinder: 0, stair: 100 };
    input.rotationStep = 90;
    const shapes = Array.from({ length: 100 }, (_, index) => createShape(input, random, 100, 0, 0, index));
    expect(shapes.every(shape => shape.kind === 'stair' && shape.area > 50)).toBe(true);
    expect(new Set(shapes.map(shape => shape.paths[0].length)).size).toBeGreaterThan(3);
    for (const shape of shapes) for (const path of shape.paths) for (let index = 0; index < path.length; index++) {
      const a = path[index], b = path[(index + 1) % path.length];
      expect(Number.isFinite(a.x) && Number.isFinite(a.y)).toBe(true);
      expect(Math.abs(a.x - b.x) < 0.00001 || Math.abs(a.y - b.y) < 0.00001).toBe(true);
    }
  });
  // 계단 비중을 끄면 어떤 다른 도형군으로도 계단을 생성하지 않는다.
  it('계단 비중 0에서는 계단을 생성하지 않는다', () => {
    const input = structuredClone(DEFAULT_SETTINGS), random = createRandom('계단-끄기');
    input.weights.stair = 0;
    const shapes = Array.from({ length: 300 }, (_, index) => createShape(input, random, 100, 0, 0, index));
    expect(shapes.some(shape => shape.kind === 'stair')).toBe(false);
  });
  // 기존 저장 설정의 누락된 계단 비중은 명시적인 0과 동일하게 처리한다.
  it('계단 항목이 없는 이전 설정도 읽고 같은 좌표를 유지한다', () => {
    const legacy = structuredClone(DEFAULT_SETTINGS);
    delete legacy.weights.stair;
    expect(validateSettings(legacy)).toEqual([]);
    const explicit = structuredClone(legacy); explicit.weights.stair = 0;
    const oldRandom = createRandom('기존-시안'), newRandom = createRandom('기존-시안');
    for (let index = 0; index < 30; index++) expect(createShape(legacy, oldRandom, 100, 0, 0, index)).toEqual(createShape(explicit, newRandom, 100, 0, 0, index));
  });
  // 추가 도형의 실제 외곽선도 기존 간격 검사와 시드 재현 규칙을 따른다.
  it('계단 원고가 도형 간격을 지키고 같은 시드로 재현된다', async () => {
    const input = structuredClone(DEFAULT_SETTINGS);
    Object.assign(input, { width: 500, height: 300, minSize: 35, maxSize: 90, gap: 5, whiteRatio: 0.75 });
    input.weights = { triangle: 0, polygon: 0, frame: 0, arc: 0, symbol: 0, cylinder: 0, stair: 100 };
    input.markers.enabled = false;
    const result = await generatePattern(input);
    expect(result.shapes.length).toBeGreaterThan(5);
    expect(result.shapes.every(shape => shape.kind === 'stair')).toBe(true);
    for (let index = 0; index < result.shapes.length; index++) {
      for (const other of result.shapes.slice(index + 1)) expect(pathsConflict(result.shapes[index].paths, other.paths, input.gap)).toBe(false);
    }
    expect((await generatePattern(input)).shapes).toEqual(result.shapes);
  }, 30000);
});

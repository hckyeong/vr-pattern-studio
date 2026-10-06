import { describe, expect, it } from 'vitest';
import { generatePattern } from '../src/core/generator';
import { createRandom } from '../src/core/random';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import { createShape } from '../src/core/shapes';
import type { PatternShape, ShapeKind } from '../src/core/types';

/** 종류 이름에 의존하지 않고 닫힌 외곽선의 반지름으로 실제 원을 판별한다. */
function isCircle(shape: PatternShape): boolean {
  if (shape.paths.length !== 1 || shape.paths[0].length < 16) return false;
  const path = shape.paths[0];
  const x = path.reduce((sum, point) => sum + point.x, 0) / path.length;
  const y = path.reduce((sum, point) => sum + point.y, 0) / path.length;
  const radii = path.map(point => Math.hypot(point.x - x, point.y - y));
  return Math.max(...radii) - Math.min(...radii) < Math.max(...radii) * 0.0001;
}

/** 한 도형군만 선택한 상태에서 여러 형태와 회전을 재현한다. */
function sampleShapes(kind: ShapeKind): PatternShape[] {
  const input = structuredClone(DEFAULT_SETTINGS), random = createRandom('도형군-원-분리');
  input.weights = { triangle: 0, polygon: 0, frame: 0, arc: 0, symbol: 0, cylinder: 0 };
  input.weights[kind] = 100;
  return Array.from({ length: 200 }, (_, index) => createShape(input, random, 100, 0, 0, index));
}

describe('도형 비중과 실제 형태의 일치', () => {
  // 원 비중을 끄면 기호 도형군에서도 동그란 점이 생성되지 않아야 한다.
  it('십자·빗금만 선택하면 실제 원이 생성되지 않는다', () => {
    const shapes = sampleShapes('symbol');
    expect(shapes.every(shape => shape.kind === 'symbol')).toBe(true);
    expect(shapes.filter(isCircle)).toHaveLength(0);
  });
  // 원과 원호는 화면에 표시된 동일한 비중 설정으로 제어한다.
  it('원·원호를 선택하면 원과 열린 원호를 모두 생성한다', () => {
    const shapes = sampleShapes('arc');
    expect(shapes.every(shape => shape.kind === 'arc')).toBe(true);
    const circles = shapes.filter(isCircle);
    expect(circles.length).toBeGreaterThan(0);
    expect(circles.length).toBeLessThan(shapes.length);
  });
  // 오류가 보고된 21×3m 원고와 비중을 전체 배치 과정까지 재현한다.
  it('원·원통이 0인 사용자 설정으로 배치한 원고에 원이 없다', async () => {
    const input = structuredClone(DEFAULT_SETTINGS);
    Object.assign(input, { unit: 'm', width: 21, height: 3, minSize: 0.3, maxSize: 1.45, gap: 0.05, whiteRatio: 0.63, seed: 'wc1t0w-s8oatd' });
    input.weights = { triangle: 30, polygon: 9, frame: 31, arc: 0, symbol: 41, cylinder: 0 };
    input.markers = { ...input.markers, count: 10, side: 0.25 };
    const result = await generatePattern(input);
    expect(result.shapes.some(shape => shape.kind === 'symbol')).toBe(true);
    expect(result.shapes.some(shape => shape.kind === 'arc' || shape.kind === 'cylinder')).toBe(false);
    expect(result.shapes.filter(isCircle)).toHaveLength(0);
  }, 30000);
});

import { describe, expect, it } from 'vitest';
import { generatePattern } from '../src/core/generator';
import { boundsOf, intersectPaths, normalizePaths, offsetPaths, pathsArea, pathsConflict, rectangle, subtractPaths, transformPaths } from '../src/core/geometry';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import { createShape } from '../src/core/shapes';
import type { PatternSettings } from '../src/core/types';

/** 작은 검증용 설정을 독립 복사한다. */
function settings(): PatternSettings {
  const value = structuredClone(DEFAULT_SETTINGS);
  return { ...value, width: 500, height: 300, inputMode: 'size', unit: 'mm', minSize: 35, maxSize: 90, margin: 0, gap: 5, whiteRatio: 0.7, markers: { ...value.markers, enabled: false }, sheets: { ...value.sheets, enabled: false } };
}

describe('실제 벡터 기하', () => {
  it('교집합과 차집합 및 오프셋을 계산한다', () => {
    const a = rectangle(0, 0, 10, 10), b = rectangle(5, 0, 10, 10);
    expect(pathsArea(intersectPaths(a, b))).toBeCloseTo(50);
    expect(pathsArea(subtractPaths(a, b))).toBeCloseTo(50);
    expect(boundsOf(offsetPaths(a, 2)).minX).toBeCloseTo(-2);
  });
  it('구멍 속 도형과 떨어진 오목 도형을 충돌로 취급하지 않는다', () => {
    const ring = normalizePaths([...rectangle(0, 0, 20, 20), ...rectangle(3, 3, 14, 14)], 'evenodd');
    expect(pathsConflict(ring, rectangle(7, 7, 3, 3), 2)).toBe(false);
    expect(pathsConflict(ring, rectangle(3.5, 7, 3, 3), 2)).toBe(true);
    expect(pathsArea(ring)).toBeCloseTo(204);
  });
  it('회전된 선형 도형의 실제 간격을 검사한다', () => {
    const a = transformPaths(rectangle(-10, -1, 20, 2), 0, 0, Math.PI / 4);
    const b = transformPaths(rectangle(-10, -1, 20, 2), -4, 4, Math.PI / 4);
    expect(pathsConflict(a, b, 3)).toBe(false);
    expect(pathsConflict(a, b, 4)).toBe(true);
  });
  it('원통 윗면의 흰 구멍을 잉크 충돌 영역에서 제외한다', () => {
    const input = settings(); input.weights = { triangle: 0, polygon: 0, frame: 0, arc: 0, symbol: 0, cylinder: 1 };
    const cylinder = createShape(input, () => 0, 100, 0, 0, 0);
    expect(cylinder.paths.length).toBeGreaterThan(1);
    expect(pathsConflict(cylinder.paths, rectangle(-2, -24, 4, 4), 1)).toBe(false);
    expect(pathsConflict(cylinder.paths, rectangle(-2, 0, 4, 4), 1)).toBe(true);
  });
});

describe('시드 기반 생성', () => {
  it('기본 설정의 마커 개수를 유지하고 실제 잉크 면적을 합산한다', async () => {
    const result = await generatePattern(structuredClone(DEFAULT_SETTINGS));
    expect(result.shapes.filter(shape => shape.kind === 'marker')).toHaveLength(DEFAULT_SETTINGS.markers.count);
    expect(result.whiteRatio).toBeCloseTo(1 - result.shapes.reduce((sum, shape) => sum + pathsArea(shape.paths), 0) / (result.canvas.width * result.canvas.height), 10);
    expect(result.targetReached || result.warnings.length > 0).toBe(true);
  }, 30000);
  it('회전 마커의 보호 영역을 시트 겹침과 도련 경계에서 제외한다', async () => {
    const input = settings(); input.margin = 5;
    input.markers = { ...input.markers, enabled: true, count: 3, side: 40, rotate: true };
    input.sheets = { ...input.sheets, enabled: true, width: 200, overlap: 10, bleed: 5 };
    const result = await generatePattern(input);
    for (const marker of result.shapes.filter(shape => shape.kind === 'marker')) {
      expect(marker.bounds.minX).toBeGreaterThanOrEqual(5);
      expect(marker.bounds.maxX).toBeLessThanOrEqual(495);
      for (const seam of [200, 400]) expect(pathsConflict(marker.footprint!, rectangle(seam - 15, 0, 20, 300), 0)).toBe(false);
      for (const other of result.shapes.filter(shape => shape.id !== marker.id)) expect(pathsConflict(marker.footprint!, other.footprint ?? other.paths, input.gap)).toBe(false);
    }
  }, 30000);
  it('시드와 설정이 같으면 벡터 결과가 같다', async () => {
    const first = await generatePattern(settings()), second = await generatePattern(settings());
    expect(first.shapes).toEqual(second.shapes);
    expect(first.attempts).toBe(second.attempts);
    expect(first.shapes.length).toBeGreaterThan(10);
  }, 30000);
  it('캔버스 안 실제 잉크 면적과 흰 여백이 일치하고 모든 도형 간격을 지킨다', async () => {
    const input = settings(), result = await generatePattern(input);
    const actualArea = result.shapes.reduce((sum, shape) => sum + pathsArea(shape.paths), 0);
    expect(result.whiteRatio).toBeCloseTo(1 - actualArea / (500 * 300), 10);
    for (let i = 0; i < result.shapes.length; i++) {
      const a = result.shapes[i];
      expect(a.bounds.minX).toBeGreaterThanOrEqual(-0.000001);
      expect(a.bounds.maxX).toBeLessThanOrEqual(500.000001);
      for (const b of result.shapes.slice(i + 1)) expect(pathsConflict(a.paths, b.paths, input.gap)).toBe(false);
    }
  }, 30000);
  it('배치할 수 없는 마커 개수를 조용히 줄이지 않는다', async () => {
    const input = settings(); input.markers = { ...input.markers, enabled: true, count: 2, side: 600 };
    await expect(generatePattern(input)).rejects.toThrow();
  });
  it('가장자리 도형의 도련 원본을 보존하고 잉크 면적은 재단 안쪽만 계산한다', async () => {
    const input = settings(); input.edgeCrop = true;
    const result = await generatePattern(input);
    const cropped = result.shapes.filter(shape => shape.bleedPaths);
    expect(cropped.length).toBeGreaterThan(0);
    for (const shape of cropped) {
      const original = boundsOf(shape.bleedPaths!);
      expect(original.minX < 0 || original.minY < 0 || original.maxX > 500 || original.maxY > 300).toBe(true);
      expect(shape.bounds.minX).toBeGreaterThanOrEqual(-0.000001);
      expect(shape.bounds.minY).toBeGreaterThanOrEqual(-0.000001);
      expect(shape.bounds.maxX).toBeLessThanOrEqual(500.000001);
      expect(shape.bounds.maxY).toBeLessThanOrEqual(300.000001);
      expect(shape.area).toBeCloseTo(pathsArea(intersectPaths(shape.bleedPaths!, rectangle(0, 0, 500, 300))), 6);
      expect(shape.paths).not.toBe(shape.bleedPaths);
    }
    expect(result.whiteRatio).toBeCloseTo(1 - result.shapes.reduce((sum, shape) => sum + shape.area, 0) / 150000, 10);
  }, 30000);
  it('미터 작업 단위에서도 길이와 간격을 같은 단위로 처리한다', async () => {
    const input = settings();
    input.unit = 'm'; input.width = 0.5; input.height = 0.3; input.minSize = 0.035; input.maxSize = 0.09; input.gap = 0.005;
    const result = await generatePattern(input);
    expect(result.canvas.width).toBe(0.5);
    expect(result.canvas.physicalWidthMm).toBe(500);
    expect(result.shapes.length).toBeGreaterThan(10);
    expect(result.shapes.every(shape => shape.bounds.maxX <= 0.500001)).toBe(true);
  }, 30000);
  it('센티미터 크기의 실제 인쇄 길이를 보존한다', async () => {
    const input = settings();
    input.unit = 'cm'; input.width = 50; input.height = 30; input.minSize = 3.5; input.maxSize = 9; input.gap = 0.5;
    const result = await generatePattern(input);
    expect(result.canvas.physicalWidthMm).toBe(500);
    expect(result.canvas.width).toBe(50);
    expect(result.shapes.length).toBeGreaterThan(10);
  }, 30000);
  it('매우 긴 비율에서도 캔버스 안의 실제 잉크만 계산한다', async () => {
    const input = settings();
    input.inputMode = 'ratio'; input.aspectRatio = '200:1'; input.minSize = 20; input.maxSize = 65; input.gap = 1;
    const result = await generatePattern(input);
    expect(result.canvas.width).toBe(10000);
    expect(result.canvas.height).toBe(50);
    expect(result.shapes.every(shape => shape.bounds.maxY <= 50.000001 && shape.bounds.minY >= -0.000001)).toBe(true);
    expect(result.whiteRatio).toBeGreaterThan(0);
  }, 30000);
  it('불가능한 여백 목표에 실제 비율과 경고를 반환한다', async () => {
    const input = settings(); input.gap = 290; input.whiteRatio = 0.05;
    const result = await generatePattern(input);
    expect(result.targetReached).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.whiteRatio).toBeGreaterThan(input.whiteRatio);
  }, 30000);
});

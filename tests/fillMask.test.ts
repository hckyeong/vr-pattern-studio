import { describe, expect, it } from 'vitest';
import { maskFromPixels, maskPaths, prepareFillMask, validFillMask } from '../src/core/fillMask';
import { boundsOf, intersectPaths, normalizePaths, pathsArea, pathsConflict, rectangle, subtractPaths } from '../src/core/geometry';
import { generatePattern } from '../src/core/generator';
import { DEFAULT_SETTINGS, resolveCanvas, validateSettings } from '../src/core/settings';
import { exportSvg } from '../src/core/svg';
import { createSheetRegions } from '../src/core/sheets';
import { artworkInkArea } from '../src/core/artwork';
import type { FillMask, PatternSettings } from '../src/core/types';

/** 문자 격자에서 흰색·검정·투명 픽셀을 만들어 사진 대신 정확한 경계 조건을 준다. */
function grid(rows: string[]): FillMask {
  const pixels = new Uint8ClampedArray(rows.length * rows[0].length * 4);
  rows.forEach((row, y) => [...row].forEach((cell, x) => pixels.set([cell === '0' ? 0 : 255, cell === '0' ? 0 : 255, cell === '0' ? 0 : 255, cell === '.' ? 0 : 255], (y * row.length + x) * 4)));
  return maskFromPixels(pixels, rows[0].length, rows.length, '흑백.png');
}

/** 생성·출력 검증에 필요한 작은 실제 작업 설정을 만든다. */
function settings(mask: FillMask): PatternSettings {
  return { ...structuredClone(DEFAULT_SETTINGS), width: 800, height: 800, minSize: 65, maxSize: 210, gap: 7, whiteRatio: .7, fillMask: mask, seed: '흰색-영역-검증', markers: { ...DEFAULT_SETTINGS.markers, enabled: false } };
}

describe('사진의 흰색 영역 변환', () => {
  it('검은 내부 구멍·분리된 흰 조각·투명 부분을 구분한다', () => {
    const mask = grid(['1111001.', '1001001.', '1001000.', '1111000.']);
    expect(validFillMask(mask)).toBe(true);
    expect(pathsArea(mask.paths)).toBeCloseTo(14 / 32, 7);
    expect(pathsArea(intersectPaths(mask.paths, rectangle(1 / 8, 1 / 4, 2 / 8, 2 / 4)))).toBe(0);
    expect(pathsArea(intersectPaths(mask.paths, rectangle(7 / 8, 0, 1 / 8, 1)))).toBe(0);
  });

  it('밝기 기준과 알파를 적용하고 전부 검정인 입력을 거부한다', () => {
    const pixels = new Uint8ClampedArray([199,199,199,255, 200,200,200,255, 255,255,255,0, 255,255,255,128]);
    expect(pathsArea(maskFromPixels(pixels, 4, 1, '회색.png').paths)).toBeCloseTo(.25);
    expect(() => grid(['000', '...'])).toThrow('흰색 영역이 없습니다');
    expect(() => maskFromPixels(pixels, 4, 1, '사진.png', 0)).toThrow('흰색 기준');
    expect(() => maskFromPixels(pixels, 4, 2, '사진.png')).toThrow('픽셀 데이터');
  });

  it('단순한 흰 면은 꼭짓점 네 개로 합치고 비율 유지·늘이기를 구분한다', () => {
    const mask = grid(['1111', '1111']);
    expect(mask.paths).toHaveLength(1); expect(mask.paths[0]).toHaveLength(4);
    expect(boundsOf(maskPaths(mask, { width: 100, height: 100 }))).toEqual({ minX: 0, maxX: 100, minY: 25, maxY: 75 });
    expect(boundsOf(maskPaths({ ...mask, fit: 'stretch' }, { width: 100, height: 100 }))).toEqual({ minX: 0, maxX: 100, minY: 0, maxY: 100 });
  });

  it('잡음이 과도한 입력과 잘못된 저장 좌표를 제한한다', () => {
    const pixels = new Uint8ClampedArray(256 * 256 * 4);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) pixels.set((x + y) % 2 ? [255,255,255,255] : [0,0,0,255], (y * 256 + x) * 4);
    expect(() => maskFromPixels(pixels, 256, 256, '잡음.png')).toThrow('경계가 너무 많습니다');
    const mask = grid(['11', '11']); mask.paths[0][0].x = NaN;
    expect(validFillMask(mask)).toBe(false); expect(validateSettings(settings(mask)).join(' ')).toContain('흰색 채움 영역');
    expect(validFillMask({ ...grid(['11']), paths: [] })).toBe(false);
  });

  it('공간 색인으로 자른 결과도 내부 구멍과 분리 영역을 보존한다', () => {
    const mask = grid(['111000', '101011', '111011']);
    const canvas = resolveCanvas(settings(mask)), prepared = prepareFillMask(mask, canvas);
    for (const candidate of [rectangle(0,0,800,800), rectangle(150,250,420,280), rectangle(-200,-200,100,100)]) {
      const expected = intersectPaths(candidate, prepared.paths), actual = prepared.clip(candidate);
      expect(pathsArea(subtractPaths(expected, actual))).toBeLessThan(1e-6);
      expect(pathsArea(subtractPaths(actual, expected))).toBeLessThan(1e-6);
    }
  });
});

describe('흰색 영역의 패턴 생성과 벡터 출력', () => {
  it('경계에서 실제 벡터를 자르고 검은 구멍·간격·시드 재현과 영역 내 여백을 지킨다', async () => {
    const input = settings(grid(['01111110', '01111110', '01100110', '01100110', '01111110', '01111110', '00000011', '00000011']));
    const result = await generatePattern(input), repeat = await generatePattern(input);
    const allowed = maskPaths(input.fillMask!, result.canvas);
    expect(result.shapes.length).toBeGreaterThan(8); expect(repeat.shapes).toEqual(result.shapes);
    expect(result.shapes.some(shape => shape.paths.some(path => path.some(point => Math.abs(point.x - 100) < 1e-6)))).toBe(true);
    for (const shape of result.shapes) {
      expect(pathsArea(subtractPaths(shape.paths, allowed))).toBeLessThan(1e-6);
      expect(shape.bleedPaths).toBeUndefined();
    }
    for (let i = 0; i < result.shapes.length; i++) for (let j = i + 1; j < result.shapes.length; j++) expect(pathsConflict(result.shapes[i].paths, result.shapes[j].paths, input.gap - .00001)).toBe(false);
    expect(result.whiteRatio).toBeCloseTo(1 - result.shapes.reduce((sum, shape) => sum + shape.area, 0) / pathsArea(allowed), 8);
    const svg = exportSvg(result);
    expect(svg).not.toMatch(/<image|data:image/); expect(svg).toContain('fillMask');
    const sheet = createSheetRegions(result.canvas, { ...input, sheets: { ...input.sheets, enabled: true, width: 400 } })[1];
    const sheetSvg = exportSvg(result, { sheet });
    expect(sheetSvg).not.toMatch(/<image|data:image/);
    expect(sheetSvg).toContain('sheet-clip');
  });

  it('마커 보호 여백을 전부 흰 영역 안에 두고 코드 셀은 자르지 않는다', async () => {
    const input = settings(grid(['111111', '110011', '110011', '111111', '000011', '000011']));
    input.markers = { ...input.markers, enabled: true, count: 3, side: 45 };
    const result = await generatePattern(input), allowed = maskPaths(input.fillMask!, result.canvas);
    const markers = result.shapes.filter(shape => shape.kind === 'marker');
    expect(markers).toHaveLength(3);
    for (const marker of markers) {
      expect(pathsArea(subtractPaths(marker.footprint!, allowed))).toBeLessThan(1e-6);
      expect(marker.marker?.side).toBe(45);
    }
  });

  it('마커가 들어갈 수 없는 흰 영역이면 이유를 안내한다', async () => {
    const input = settings(grid(['00000000', '00000001']));
    input.markers = { ...input.markers, enabled: true, count: 1, side: 200 };
    await expect(generatePattern(input)).rejects.toThrow('흰색 채움 영역');
  });

  it('고정 SVG를 보존하며 영역 안의 잉크만 계산하고 모든 그림을 피한다', async () => {
    const input = settings(grid(['1100', '1100', '1100', '1100']));
    input.artworks = [{ name: '경계로고.svg', aspect: 1, x: .5, y: .5, widthRatio: .35, avoidance: 'outline', parts: [{ color: '#000000', paths: rectangle(0,0,1,1) }] }];
    const result = await generatePattern(input), allowed = maskPaths(input.fillMask!, result.canvas);
    const art = result.shapes.filter(shape => shape.kind === 'artwork'), patterns = result.shapes.filter(shape => shape.kind !== 'artwork');
    expect(pathsArea(subtractPaths(art[0].paths, allowed))).toBeGreaterThan(100);
    for (const shape of patterns) {
      expect(pathsConflict(shape.paths, art[0].paths, input.gap - .00001)).toBe(false);
      expect(pathsArea(subtractPaths(shape.paths, allowed))).toBeLessThan(1e-6);
    }
    const area = artworkInkArea(art, allowed) + patterns.reduce((sum, shape) => sum + shape.area, 0);
    expect(result.whiteRatio).toBeCloseTo(1 - area / pathsArea(normalizePaths(allowed)), 7);
  });
});

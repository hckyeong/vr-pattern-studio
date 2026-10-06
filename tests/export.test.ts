import { describe, expect, it } from 'vitest';
import dictionary from '../src/data/arucogen.json';
import { createMarker } from '../src/core/markers';
import { createSheetRegions } from '../src/core/sheets';
import { exportSvg, exportSheetMapSvg, getSvgFilename } from '../src/core/svg';
import type { DictionaryName, PatternResult, PatternSettings } from '../src/core/types';

/** 출력 검증에 필요한 전체 설정을 생성한다. */
function fixture(): PatternResult {
  const settings: PatternSettings = { width: 250, height: 100, unit: 'cm', inputMode: 'size', aspectRatio: '5:2', printWidthMm: null, seed: '<시드>&"', whiteRatio: 0.7, minSize: 1, maxSize: 10, gap: 1, margin: 1, edgeCrop: true, grayRatio: 0, vertexMin: 3, vertexMax: 8, concaveRatio: 0, rotationStep: 0, weights: { triangle: 1, polygon: 1, frame: 1, arc: 1, symbol: 1, cylinder: 1 }, markers: { enabled: true, dictionary: '4x4_1000', count: 1, startId: 0, side: 6, quietZoneCells: 1, rotate: false }, sheets: { enabled: true, width: 100, overlap: 5, bleed: 2, scale: 1 } };
  return { version: '1', settings, canvas: { width: 250, height: 100, physicalWidthMm: 2500, physicalHeightMm: 1000, lengthUnit: 'cm' }, shapes: [createMarker(settings.markers, 0, 50, 50, 0, 0)], whiteRatio: 0.9, targetReached: true, attempts: 1, warnings: [], elapsedMs: 1 };
}

describe('마커 벡터와 사전', () => {
  it.each(['4x4_1000', '5x5_1000', '6x6_1000'] as DictionaryName[])('첫 번호와 마지막 번호의 모든 셀을 복원한다: %s', name => {
    const settings = fixture().settings.markers;
    const sideBits = Number(name[0]);
    for (const id of [0, 999]) {
      const shape = createMarker({ ...settings, dictionary: name, side: sideBits + 2 }, id, 0, 0, 0, 0);
      const bitString = dictionary[name][id].map((byte, index) => byte.toString(2).padStart(Math.min(8, sideBits ** 2 - 8 * index), '0')).join('');
      for (let row = 0; row < sideBits; row++) for (let col = 0; col < sideBits; col++) {
        const left = col + 1 - (sideBits + 2) / 2, top = row + 1 - (sideBits + 2) / 2;
        expect(shape.paths.some(path => path[0].x === left && path[0].y === top)).toBe(bitString[row * sideBits + col] === '0');
      }
      expect(shape.area).toBe(4 * sideBits + 4 + [...bitString].filter(bit => bit === '0').length);
    }
  });
  it('사전 범위와 음수 크기를 거부하고 보호 여백을 회전한다', () => {
    const options = fixture().settings.markers;
    for (const id of [-1, 1000, 0.5]) expect(() => createMarker(options, id, 0, 0, 0, 0)).toThrow();
    expect(() => createMarker({ ...options, side: -1 }, 0, 0, 0, 0, 0)).toThrow();
    const shape = createMarker(options, 0, 0, 0, 45, 0);
    expect(shape.bounds.maxX).toBeCloseTo(4 * Math.SQRT2);
    expect(shape.footprint).toHaveLength(1);
  });
});

describe('시트와 벡터 출력', () => {
  it('유효 시공폭과 왼쪽 겹침 및 도련을 보존한다', () => {
    const result = fixture();
    expect(createSheetRegions(result.canvas, result.settings)).toEqual([
      { index: 0, trimX: 0, trimWidth: 100, x: -2, y: -2, width: 104, height: 104 },
      { index: 1, trimX: 100, trimWidth: 100, x: 93, y: -2, width: 109, height: 104 },
      { index: 2, trimX: 200, trimWidth: 50, x: 193, y: -2, width: 59, height: 104 },
    ]);
  });
  it('실측 축척과 전역 viewBox를 맞추고 메타데이터를 이스케이프한다', () => {
    const result = fixture();
    result.settings.sheets.scale = 0.1;
    const sheet = createSheetRegions(result.canvas, result.settings)[1];
    const svg = exportSvg(result, { sheet });
    expect(svg).toContain('width="109mm" height="104mm" viewBox="93 -2 109 104"');
    expect(svg).toContain('&lt;시드&gt;&amp;');
    expect(svg).toContain('data-aruco-id="0"');
    expect(svg).toContain('clip-path="url(#sheet-clip)"');
    expect(svg).not.toContain('clip-path="url(#canvas-clip)"');
    expect(svg).not.toMatch(/<image|<script|<foreignObject/);
    expect(getSvgFilename(result, sheet)).toMatch(/-시트02\.svg$/);
  });
  it('실측 미정 원고는 픽셀 단위를 표시하고 배치도를 별도로 생성한다', () => {
    const result = fixture();
    result.canvas.physicalWidthMm = null;
    result.canvas.physicalHeightMm = null;
    expect(exportSvg(result)).toContain('width="250px" height="100px"');
    expect(exportSheetMapSvg(result)).toContain('실측 미지정');
  });
  it('30장의 정보를 두 열로 나누고 행 간격과 문서 높이를 확장한다', () => {
    const result = fixture();
    result.canvas.width = 3000;
    result.canvas.physicalWidthMm = 30000;
    const svg = exportSheetMapSvg(result);
    const cards = [...svg.matchAll(/data-sheet-card="(\d+)" transform="translate\((\d+) ([\d.]+)\)"/g)];
    expect(cards).toHaveLength(30);
    const rows = cards.map(card => Number(card[3]));
    for (let index = 0; index < rows.length; index += 2) {
      expect(rows[index]).toBe(rows[index + 1]);
      if (index > 0) expect(rows[index] - rows[index - 2]).toBeCloseTo(191, 6);
    }
    const height = Number(svg.match(/height="(\d+)px"/)![1]);
    expect(height).toBeGreaterThan(rows[29] + 175);
    expect(svg).toContain('실제 출력:');
    expect(svg).toContain('마커 번호:');
    expect(svg).toContain('<circle cx=');
  });
  it('윤곽선 내보내기도 마커의 검정 셀을 유지한다', () => {
    const svg = exportSvg(fixture(), { outline: true });
    expect(svg).toContain('fill="#000000"');
    expect(svg).not.toContain('fill="none"');
  });
  it('시트 도련에 원래 도형을 연장하고 전체 원고에는 재단된 도형을 사용한다', () => {
    const result = fixture();
    result.shapes = [{ id: '도련검증', kind: 'polygon', color: '#000000', fillRule: 'nonzero', area: 100,
      bounds: { minX: 0, minY: 10, maxX: 10, maxY: 20 },
      paths: [[{ x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 20 }]],
      bleedPaths: [[{ x: -10, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 20 }, { x: -10, y: 20 }]],
    }];
    const full = exportSvg(result);
    const sheet = exportSvg(result, { sheet: createSheetRegions(result.canvas, result.settings)[0] });
    expect(full).toContain('d="M0,10L10,10L10,20L0,20Z"');
    expect(full).not.toContain('d="M-10,10');
    expect(full).toContain('clip-path="url(#canvas-clip)"');
    expect(sheet).toContain('d="M-10,10L10,10L10,20L-10,20Z"');
    expect(sheet).toContain('clip-path="url(#sheet-clip)"');
    expect(sheet).not.toContain('clip-path="url(#canvas-clip)"');
  });
});

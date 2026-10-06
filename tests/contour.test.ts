// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { artworkContour, placeArtwork } from '../src/core/artwork';
import { createContourGuide, placeNearContour } from '../src/core/contourPlacement';
import { boundsOf, intersectPaths, pathsArea, pathsConflict, rectangle } from '../src/core/geometry';
import { importSvg } from '../src/core/importSvg';
import { generatePattern } from '../src/core/generator';
import { DEFAULT_SETTINGS, resolveCanvas } from '../src/core/settings';
import { createSheetRegions } from '../src/core/sheets';
import { exportSvg } from '../src/core/svg';
import type { PatternShape, Polygon } from '../src/core/types';

/** 외곽과 구멍이 분명한 도형으로 삽입 파일을 구성한다. */
function artwork(body: string) { return importSvg(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`, '최외곽.svg'); }
/** 이동 전후 형태 비교에 사용할 비대칭 도형을 만든다. */
function triangle(): PatternShape {
  const paths = [[{ x: -13, y: -6 }, { x: 18, y: 2 }, { x: -4, y: 15 }]];
  return { id: '형태-유지', kind: 'triangle', color: '#177f80', paths, bounds: boundsOf(paths), area: pathsArea(paths), fillRule: 'nonzero' };
}
/** 평행 이동의 영향을 없앤 상대 꼭짓점으로 형태를 비교한다. */
function relative(paths: Polygon[]) { const anchor = paths[0][0]; return paths.map(path => path.map(point => [Number((point.x - anchor.x).toFixed(7)), Number((point.y - anchor.y).toFixed(7))])); }

describe('SVG 최외곽 보호와 형태 유지', () => {
  // 닫힌 구멍은 보호하지만 바깥으로 열린 오목한 공간은 사각형으로 막지 않는다.
  it('새 SVG의 최외곽에서 내부 구멍만 채우고 오목함을 유지한다', () => {
    const ring = artwork('<path fill-rule="evenodd" d="M0 0H100V100H0Z M20 20H80V80H20Z"/>');
    expect(ring.avoidance).toBe('silhouette');
    expect(pathsArea(artworkContour(ring))).toBeCloseTo(1);
    expect(pathsArea(artworkContour({ ...ring, avoidance: 'outline' }))).toBeCloseTo(.64);
    const concave = artwork('<path d="M0 0H30V70H100V100H0Z"/>');
    expect(pathsArea(artworkContour(concave))).toBeCloseTo(.51);
    expect(pathsConflict(artworkContour(concave), rectangle(.5, .2, .2, .2), .03)).toBe(false);
    expect(pathsConflict(artworkContour({ ...concave, avoidance: 'bounds' }), rectangle(.5, .2, .2, .2), .03)).toBe(true);
  });
  // 떨어진 조각 사이를 임의의 볼록 껍질로 연결하지 않는다.
  it('분리된 두 조각 사이의 바깥 공간을 열어 둔다', () => {
    const split = artwork('<rect width="20" height="100"/><rect x="80" width="20" height="100"/>');
    const contour = artworkContour(split);
    expect(contour).toHaveLength(2); expect(pathsArea(contour)).toBeCloseTo(.4);
    expect(pathsConflict(contour, rectangle(.3, .3, .4, .4), .02)).toBe(false);
  });
  // 마커와 실제 도형 충돌 검사가 쓰는 간격으로 가까운 후보를 찾는다.
  it('주변 배치는 잘라내기 없이 평행 이동만 하고 간격을 맞춘다', () => {
    const original = triangle(), guide = createContourGuide(rectangle(100, 100, 200, 180));
    for (let i = 0; i < 20; i++) {
      const placed = placeNearContour(original, guide, (i + .3) / 20, 8)!;
      expect(placed).not.toBeNull();
      expect(relative(placed.paths)).toEqual(relative(original.paths));
      expect(placed.area).toBe(original.area); expect(placed.color).toBe(original.color);
      expect(pathsConflict(placed.paths, guide.paths, 8)).toBe(false);
      expect(pathsConflict(placed.paths, guide.paths, 8.02)).toBe(true);
    }
  });
  // 구멍과 오목한 경계를 포함한 실제 원고의 모든 도형을 다시 검사한다.
  it('오목한 영역에 배치하고 이동·저장·시트 출력에서도 보호 간격을 유지한다', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    Object.assign(settings, { width: 600, height: 400, minSize: 30, maxSize: 90, gap: 5, whiteRatio: .65 });
    settings.artwork = artwork('<path d="M0 0H30V70H100V100H0Z"/>'); settings.artwork.widthRatio = .48;
    Object.assign(settings.markers, { count: 2, side: 20 });
    Object.assign(settings.sheets, { enabled: true, width: 300, bleed: 5 });
    for (const x of [.34, .64]) {
      settings.artwork.x = x;
      const result = await generatePattern(settings), protection = placeArtwork(settings.artwork, resolveCanvas(settings)).footprint;
      const patterns = result.shapes.filter(shape => shape.kind !== 'artwork');
      for (const shape of patterns) expect(pathsConflict(protection, shape.footprint ?? shape.paths, settings.gap)).toBe(false);
      const bounds = boundsOf(protection), box = rectangle(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
      expect(patterns.some(shape => pathsArea(intersectPaths(shape.paths, box)) > 20)).toBe(true);
      expect(patterns.filter(shape => shape.kind !== 'marker' && pathsConflict(protection, shape.paths, settings.gap + .1)).length).toBeGreaterThan(3);
      for (const shape of patterns) if (shape.bleedPaths) expect(pathsConflict(protection, shape.bleedPaths, settings.gap)).toBe(false);
      expect((await generatePattern(settings)).shapes).toEqual(result.shapes);
      const doc = new DOMParser().parseFromString(exportSvg(result, { sheet: createSheetRegions(result.canvas, result.settings)[0] }), 'image/svg+xml');
      expect(doc.querySelector('parsererror')).toBeNull(); expect(doc.querySelector('image')).toBeNull();
      expect(JSON.parse(doc.querySelector('metadata')!.textContent!).settings.artwork.avoidance).toBe('silhouette');
    }
  }, 30000);
});

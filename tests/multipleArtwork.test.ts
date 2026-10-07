// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { artworkShapes, constrainArtwork, getArtworks, MAX_ARTWORKS, placeArtwork, validArtwork, withArtworks } from '../src/core/artwork';
import { boundsOf, pathsArea, pathsConflict, rectangle, subtractPaths } from '../src/core/geometry';
import { generatePattern } from '../src/core/generator';
import { createArtworkPreparationCache } from '../src/core/preparedArtwork';
import { DEFAULT_SETTINGS, resolveCanvas, validateSettings } from '../src/core/settings';
import { saveWorkspace, loadWorkspace } from '../src/core/storage';
import { exportSvg } from '../src/core/svg';
import { createSheetRegions } from '../src/core/sheets';
import type { PatternResult, SvgArtwork } from '../src/core/types';

/** 회전 검증에 사용할 정규화한 직사각형 SVG를 만든다. */
function source(changes: Partial<SvgArtwork> = {}): SvgArtwork {
  return { name: '같은 이름.svg', aspect: .5, parts: [{ color: '#123456', paths: rectangle(0, 0, 1, .5) }], x: .5, y: .5, widthRatio: .4, avoidance: 'silhouette', ...changes };
}

/** 실행 시간만 제외해 반복 생성 원고를 비교한다. */
function stable(result: PatternResult) { const { elapsedMs, ...rest } = result; return rest; }

describe('삽입 SVG 중심 회전', () => {
  it('중심과 면적을 유지하며 출력 좌표와 보호 영역을 함께 90도 회전한다', () => {
    const canvas = resolveCanvas({ ...DEFAULT_SETTINGS, width: 1000, height: 600 });
    const original = source(), rotated = source({ rotation: 90 });
    const before = placeArtwork(original, canvas), after = placeArtwork(rotated, canvas);
    expect(after.shapes[0].paths[0]).toEqual([{ x: 600, y: 100 }, { x: 600, y: 500 }, { x: 400, y: 500 }, { x: 400, y: 100 }]);
    expect(boundsOf(after.footprint)).toEqual({ minX: 400, minY: 100, maxX: 600, maxY: 500 });
    expect(after.inkArea).toBe(before.inkArea);
    expect(subtractPaths(after.shapes[0].paths, after.footprint)).toEqual([]);
    expect(placeArtwork(source({ rotation: 360 }), canvas)).toEqual(before);
    expect(original.rotation).toBeUndefined();
  });

  it.each([-360, -90, 0, 17, 45, 90, 180, 270, 359])('%s도에서 긴 SVG와 좁은 캔버스의 모든 모서리를 내부로 제한한다', rotation => {
    for (const [width, height] of [[1000, 50], [50, 1000]]) {
      const canvas = resolveCanvas({ ...DEFAULT_SETTINGS, width, height });
      const original = source({ aspect: 10, parts: [{ color: '#000000', paths: rectangle(0, 0, 1, 10) }], widthRatio: 1, x: -1, y: 3, rotation });
      const constrained = constrainArtwork(original, canvas), bounds = boundsOf(artworkShapes(constrained, canvas).flatMap(shape => shape.paths));
      expect(validArtwork(constrained)).toBe(true);
      expect(bounds.minX).toBeGreaterThanOrEqual(-.000001); expect(bounds.minY).toBeGreaterThanOrEqual(-.000001);
      expect(bounds.maxX).toBeLessThanOrEqual(width + .000001); expect(bounds.maxY).toBeLessThanOrEqual(height + .000001);
      expect(constrained.rotation).toBeGreaterThanOrEqual(0); expect(constrained.rotation).toBeLessThan(360);
    }
  });

  it('회전은 원본 윤곽을 재사용하면서 배치 색인과 덩어리 경계를 갱신한다', () => {
    const cache = createArtworkPreparationCache(), canvas = resolveCanvas(DEFAULT_SETTINGS), original = source({ contourMode: 'grouped-hull' });
    const zero = cache.prepare(original, canvas);
    expect(cache.prepare({ ...original, rotation: 0 }, canvas).collision).toBe(zero.collision);
    const rotated = cache.prepare({ ...original, rotation: 37 }, canvas);
    expect(rotated.collision).not.toBe(zero.collision);
    expect(subtractPaths(rotated.footprint, rotated.collision.paths)).toEqual([]);
    expect(cache.prepare({ ...original, rotation: 37 }, canvas).collision).toBe(rotated.collision);
    expect(cache.getStats()).toMatchObject({ hits: 2, misses: 2, contourHits: 3, contourMisses: 1 });
  });
});

describe('복수 SVG의 입력과 생성 및 저장', () => {
  it('같은 그림의 다른 배치를 개별 캐시에 보관하고 반복할 때 모두 재사용한다', () => {
    const cache = createArtworkPreparationCache({ maxArtworks: MAX_ARTWORKS }), canvas = resolveCanvas(DEFAULT_SETTINGS);
    const items = [source({ x: .2, widthRatio: .2 }), source({ x: .5, widthRatio: .2, rotation: 90 }), source({ x: .8, widthRatio: .2, rotation: 37 })];
    const first = items.map((artwork, index) => cache.prepare(artwork, canvas, String(index)));
    items.forEach((artwork, index) => expect(cache.prepare(artwork, canvas, String(index)).collision).toBe(first[index].collision));
    expect(cache.getStats()).toMatchObject({ hits: 3, misses: 3, artworkCount: 3 });
  });

  it('이전 단일 설정을 읽고 빈 목록을 포함한 새 목록으로 안전하게 전환한다', () => {
    const original = { ...DEFAULT_SETTINGS, artwork: source() }, before = structuredClone(original);
    expect(getArtworks(original)).toEqual([original.artwork]);
    const changed = withArtworks(original, [source(), source({ rotation: 45 })]);
    expect(changed.artwork).toBeUndefined(); expect(changed.artworks).toHaveLength(2);
    expect(getArtworks(withArtworks(changed, []))).toEqual([]);
    expect(original).toEqual(before);
  });

  it('세 SVG의 원본과 계산 경계를 모두 피하고 고유 식별자 및 회전을 출력한다', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    Object.assign(settings, { width: 700, height: 400, minSize: 25, maxSize: 75, whiteRatio: .75, gap: 4 });
    Object.assign(settings.markers, { count: 3, side: 16 });
    settings.artworks = [
      source({ x: .2, y: .3, widthRatio: .2, rotation: 33, contourMode: 'grouped-hull' }),
      source({ x: .5, y: .6, widthRatio: .2, rotation: 90, avoidance: 'outline' }),
      source({ x: .8, y: .35, widthRatio: .2, rotation: 145, avoidance: 'bounds' }),
    ];
    const before = structuredClone(settings), canvas = resolveCanvas(settings), cache = createArtworkPreparationCache({ maxArtworks: 16 });
    const result = await generatePattern(settings, undefined, { artworkCache: cache });
    expect(result.shapes.filter(shape => shape.kind === 'artwork')).toHaveLength(3);
    expect(result.shapes.filter(shape => shape.kind === 'marker')).toHaveLength(3);
    expect(new Set(result.shapes.map(shape => shape.id)).size).toBe(result.shapes.length);
    for (const [index, artwork] of settings.artworks.entries()) {
      const original = placeArtwork(artwork, canvas), prepared = cache.prepare(artwork, canvas, String(index));
      expect(result.shapes.filter(shape => shape.kind === 'artwork')[index].paths).toEqual(original.shapes[0].paths);
      for (const shape of result.shapes.filter(shape => shape.kind !== 'artwork')) {
        expect(pathsConflict(shape.footprint ?? shape.paths, original.footprint, settings.gap)).toBe(false);
        expect(pathsConflict(shape.footprint ?? shape.paths, prepared.collision.paths, settings.gap)).toBe(false);
      }
    }
    const repeated = await generatePattern(settings, undefined, { artworkCache: cache });
    expect(stable(repeated)).toEqual(stable(result)); expect(settings).toEqual(before);
    const split = { ...result, settings: { ...result.settings, sheets: { ...result.settings.sheets, enabled: true, width: 350, overlap: 10 } } };
    for (const output of [exportSvg(result), exportSvg(split, { sheet: createSheetRegions(canvas, split.settings)[1] })]) {
      const document = new DOMParser().parseFromString(output, 'image/svg+xml');
      expect(document.querySelector('parsererror, image, script, foreignObject')).toBeNull();
      expect(document.querySelectorAll('g[id^="imported-artwork-"]')).toHaveLength(3);
      expect(JSON.parse(document.querySelector('metadata')!.textContent!).settings.artworks).toEqual(result.settings.artworks);
    }
    saveWorkspace(settings, [result]);
    expect(loadWorkspace()?.settings.artworks).toEqual(settings.artworks);
    expect(loadWorkspace()?.results[0].shapes).toEqual(result.shapes);
  }, 30000);

  it('배열 원소가 하나면 기존 단일 SVG와 같은 배치를 재현한다', async () => {
    const settings = { ...structuredClone(DEFAULT_SETTINGS), artwork: source({ widthRatio: .15, contourMode: 'grouped-hull' as const }) };
    const legacy = await generatePattern(settings), multiple = await generatePattern(withArtworks(settings, [settings.artwork]));
    expect(multiple.shapes).toEqual(legacy.shapes); expect(multiple.attempts).toBe(legacy.attempts); expect(multiple.whiteRatio).toBe(legacy.whiteRatio);
  });

  it('겹친 SVG의 흰 덧칠과 그리기 순서를 실제 여백 면적에 반영한다', async () => {
    const black = source({ aspect: 1, widthRatio: .2, parts: [{ color: '#000000', paths: rectangle(0, 0, 1, 1) }] });
    const white = { ...black, widthRatio: .1, parts: [{ color: '#ffffff', paths: rectangle(0, 0, 1, 1) }] };
    const settings = { ...structuredClone(DEFAULT_SETTINGS), width: 1000, height: 1000, whiteRatio: .98, artworks: [black, white] };
    settings.markers.enabled = false;
    const cleared = await generatePattern(settings), repainted = await generatePattern({ ...settings, artworks: [white, black] });
    expect(cleared.shapes).toHaveLength(2); expect(cleared.whiteRatio).toBeCloseTo(.97);
    expect(repainted.whiteRatio).toBeCloseTo(.96);
    const overlap = await generatePattern({ ...settings, artworks: [black, { ...black, x: .6 }] });
    expect(overlap.whiteRatio).toBeCloseTo(.94);
    expect(pathsArea(overlap.shapes[0].paths)).toBe(40000);
  });

  it('잘못된 각도·목록·전체 좌표 상한을 거부한다', () => {
    for (const rotation of [NaN, Infinity, -361, 361, '90', null]) expect(validArtwork(source({ rotation } as Partial<SvgArtwork>))).toBe(false);
    for (const artworks of [null, {}, [null], Array.from({ length: 17 }, () => source())]) expect(validateSettings({ ...DEFAULT_SETTINGS, artworks } as never).length).toBeGreaterThan(0);
    const dense = source({ parts: [{ color: '#123456', paths: [Array.from({ length: 30000 }, (_, index) => ({ x: (index % 100) / 100, y: .5 * Math.floor(index / 100) / 300 }))] }] });
    expect(validateSettings({ ...DEFAULT_SETTINGS, artworks: [dense, dense, dense] }).join(' ')).toContain('80,000');
    expect(validateSettings({ ...DEFAULT_SETTINGS, artwork: source(), artworks: [] }).length).toBeGreaterThan(0);
    expect(validateSettings({ ...DEFAULT_SETTINGS, artworks: [] })).toEqual([]);
  });
});

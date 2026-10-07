import { describe, expect, it } from 'vitest';
import { placeArtwork, validArtwork } from '../src/core/artwork';
import { generatePattern } from '../src/core/generator';
import { pathsConflict, rectangle, subtractPaths } from '../src/core/geometry';
import { createArtworkPreparationCache } from '../src/core/preparedArtwork';
import { DEFAULT_SETTINGS, resolveCanvas, validateSettings } from '../src/core/settings';
import { exportSvg } from '../src/core/svg';
import type { PatternResult, SvgArtwork } from '../src/core/types';

/** 오목한 큰 조각과 가까운 작은 조각을 포함한 검증 원고를 만든다. */
function artwork(): SvgArtwork {
  return {
    name: '덩어리.svg', aspect: 1, x: .5, y: .5, widthRatio: .35, avoidance: 'silhouette', contourMode: 'grouped-hull',
    parts: [{ color: '#123456', paths: [[{ x: 0, y: 0 }, { x: .8, y: 0 }, { x: .8, y: .15 }, { x: .15, y: .15 }, { x: .15, y: 1 }, { x: 0, y: 1 }]] },
      { color: '#abcdef', paths: rectangle(.81, 0, .19, .15) }],
  };
}

/** 실행 시간만 제외해 동일 시드의 생성 결과를 비교한다. */
function stable(result: PatternResult) { const { elapsedMs, ...rest } = result; return rest; }

describe('덩어리별 볼록 껍질의 캐시와 생성 연결', () => {
  it('출력 좌표와 잉크 면적은 유지하며 계산 경계에만 적용한다', () => {
    const source = artwork(), canvas = resolveCanvas(DEFAULT_SETTINGS), before = structuredClone(source);
    const cache = createArtworkPreparationCache(), prepared = cache.prepare(source, canvas);
    expect({ shapes: prepared.shapes, footprint: prepared.footprint, inkArea: prepared.inkArea }).toEqual(placeArtwork(source, canvas));
    expect(prepared.simplification).toMatchObject({ applied: true, method: 'grouped-hull', groups: 1 });
    expect(prepared.simplification.mergeDistance).toBe(source.widthRatio * canvas.width * .02);
    expect(subtractPaths(prepared.footprint, prepared.collision.paths)).toEqual([]);
    expect(prepared.contour?.collision).toBe(prepared.collision);
    expect(cache.prepare(structuredClone(source), canvas).collision).toBe(prepared.collision);
    expect(source).toEqual(before);
  });

  it('방식과 묶음 거리 변경 시 원본 윤곽을 재사용하고 계산 자료를 갱신한다', () => {
    const source = artwork(), canvas = resolveCanvas(DEFAULT_SETTINGS), cache = createArtworkPreparationCache();
    const first = cache.prepare(source, canvas);
    expect(cache.prepare({ ...source, hullMergeRatio: .02 }, canvas).collision).toBe(first.collision);
    const separate = cache.prepare({ ...source, hullMergeRatio: 0 }, canvas);
    expect(separate.collision).not.toBe(first.collision);
    expect(separate.simplification.groups).toBe(2);
    const exact = cache.prepare({ ...source, contourMode: 'simplify', contourTolerance: 0 }, canvas);
    expect(exact.collision.paths).toEqual(exact.footprint);
    const legacy = { ...source }; delete legacy.contourMode;
    expect(cache.prepare(legacy, canvas).collision).toBe(exact.collision);
    expect(cache.getStats()).toMatchObject({ contourMisses: 1, contourHits: 4, misses: 3, hits: 2 });
  });

  it('사각 경계 모드는 볼록 껍질 옵션과 무관하게 기존 경계를 쓴다', () => {
    const prepared = createArtworkPreparationCache().prepare({ ...artwork(), avoidance: 'bounds' }, resolveCanvas(DEFAULT_SETTINGS));
    expect(prepared.collision.paths).toEqual(prepared.footprint);
    expect(prepared.simplification).toMatchObject({ applied: false, simplifiedSegments: 4 });
    expect(prepared.simplification.method).toBeUndefined();
  });

  it.each(['silhouette', 'outline'] as const)('%s 모드에서 원본과 볼록 껍질 및 마커의 간격을 유지한다', async avoidance => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    Object.assign(settings, { width: 600, height: 400, minSize: 30, maxSize: 95, whiteRatio: .75, gap: 4, artwork: { ...artwork(), avoidance } });
    Object.assign(settings.markers, { count: 2, side: 18 });
    const canvas = resolveCanvas(settings), cache = createArtworkPreparationCache();
    const prepared = cache.prepare(settings.artwork!, canvas), original = placeArtwork(settings.artwork!, canvas);
    const result = await generatePattern(settings, undefined, { artworkCache: cache });
    expect(result.shapes.filter(shape => shape.kind === 'artwork')).toEqual(original.shapes);
    expect(result.shapes.some(shape => shape.kind === 'marker')).toBe(true);
    for (const shape of result.shapes.filter(shape => shape.kind !== 'artwork')) {
      expect(pathsConflict(shape.footprint ?? shape.paths, original.footprint, settings.gap)).toBe(false);
      expect(pathsConflict(shape.footprint ?? shape.paths, prepared.collision.paths, settings.gap)).toBe(false);
    }
    const repeated = await generatePattern(settings, undefined, { artworkCache: cache });
    expect(stable(repeated)).toEqual(stable(result));
    expect(exportSvg(repeated)).toBe(exportSvg(result));
    expect(result.settings.artwork?.contourMode).toBe('grouped-hull');
  }, 30000);

  it('이전 설정을 허용하고 유효하지 않은 방식이나 묶음 거리를 거부한다', () => {
    const source = artwork(), previous = { ...source }; delete previous.contourMode;
    expect(validArtwork(previous)).toBe(true);
    for (const hullMergeRatio of [0, .02, .1]) expect(validArtwork({ ...source, hullMergeRatio })).toBe(true);
    for (const changed of [{ contourMode: 'convex' }, { contourMode: null }, ...[-1, .10001, NaN, Infinity, '0.02', null].map(hullMergeRatio => ({ hullMergeRatio }))]) {
      const invalid = { ...source, ...changed } as SvgArtwork;
      expect(validArtwork(invalid)).toBe(false);
      expect(validateSettings({ ...DEFAULT_SETTINGS, artwork: invalid }).length).toBeGreaterThan(0);
    }
  });
});

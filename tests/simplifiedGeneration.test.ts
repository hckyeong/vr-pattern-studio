import { describe, expect, it } from 'vitest';
import { placeArtwork, validArtwork } from '../src/core/artwork';
import { generatePattern } from '../src/core/generator';
import { pathsConflict } from '../src/core/geometry';
import { createArtworkPreparationCache } from '../src/core/preparedArtwork';
import { DEFAULT_SETTINGS, resolveCanvas, validateSettings } from '../src/core/settings';
import { exportSvg } from '../src/core/svg';
import type { PatternResult, SvgArtwork } from '../src/core/types';

/** 작은 굴곡이 많은 원본을 원래 좌표 그대로 만드는 간격 검증 입력이다. */
function detailedSettings(avoidance: SvgArtwork['avoidance'], gap: number) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  Object.assign(settings, { width: 600, height: 400, minSize: 30, maxSize: 95, whiteRatio: .7, gap });
  Object.assign(settings.markers, { count: 2, side: 18 });
  const polygon = Array.from({ length: 512 }, (_, index) => {
    const angle = index * Math.PI * 2 / 512;
    const radius = .42 + .012 * Math.sin(angle * 17);
    return { x: .5 + Math.cos(angle) * radius, y: .5 + Math.sin(angle) * radius };
  });
  settings.artwork = { name: '윤곽.svg', aspect: 1, x: .5, y: .5, widthRatio: .35, avoidance, contourTolerance: .001, parts: [{ color: '#123456', paths: [polygon] }] };
  return settings;
}

/** 측정 시간만 제외하고 반복 생성의 원고와 설정을 비교한다. */
function stable(result: PatternResult) { const { elapsedMs, ...rest } = result; return rest; }

describe('간략화한 계산 윤곽의 실제 생성 안전성', () => {
  it.each(['silhouette', 'outline'] as const)('%s 모드에서 원본 로고와 마커 보호 영역 사이 간격을 지킨다', async avoidance => {
    for (const gap of [0, 4]) {
      const settings = detailedSettings(avoidance, gap);
      const before = structuredClone(settings.artwork);
      const cache = createArtworkPreparationCache();
      const prepared = cache.prepare(settings.artwork!, resolveCanvas(settings));
      expect(prepared.simplification.applied).toBe(true);
      const original = placeArtwork(settings.artwork!, resolveCanvas(settings));
      const result = await generatePattern(settings, undefined, { artworkCache: cache });
      expect(result.shapes.filter(shape => shape.kind === 'artwork')).toEqual(original.shapes);
      for (const shape of result.shapes.filter(shape => shape.kind !== 'artwork')) {
        expect(pathsConflict(shape.footprint ?? shape.paths, original.footprint, gap)).toBe(false);
      }
      const repeated = await generatePattern(settings, undefined, { artworkCache: cache });
      expect(stable(repeated)).toEqual(stable(result));
      expect(exportSvg(repeated)).toBe(exportSvg(result));
      expect(settings.artwork).toEqual(before);
    }
  }, 30000);

  it('이전 파일은 원본 모드로 유지하고 유효하지 않은 간략화 값은 거부한다', () => {
    const settings = detailedSettings('silhouette', 4);
    const artwork = settings.artwork!;
    const previous = { ...artwork }; delete previous.contourTolerance;
    expect(validArtwork(previous)).toBe(true);
    for (const contourTolerance of [0, .00025, .001, .0025, .005]) expect(validArtwork({ ...artwork, contourTolerance })).toBe(true);
    for (const contourTolerance of [-1, NaN, Infinity, .00501, '0.001', null]) {
      const invalid = { ...artwork, contourTolerance } as SvgArtwork;
      expect(validArtwork(invalid)).toBe(false);
      expect(validateSettings({ ...settings, artwork: invalid }).length).toBeGreaterThan(0);
    }
  });
});

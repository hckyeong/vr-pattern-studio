// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { generatePattern } from '../src/core/generator';
import { importSvg } from '../src/core/importSvg';
import { createArtworkPreparationCache } from '../src/core/preparedArtwork';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import { createSheetRegions } from '../src/core/sheets';
import { exportSvg } from '../src/core/svg';
import type { PatternResult, SvgArtwork } from '../src/core/types';

/** 실행 시간만 제외하고 기존 판정과 생성 결과 전체를 비교한다. */
function stable(result: PatternResult) { const { elapsedMs, ...rest } = result; return rest; }

/** 오목한 외곽·분리 조각·흰 덧칠을 포함한 실제 입력을 구성한다. */
function settingsFor(avoidance: SvgArtwork['avoidance']) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  Object.assign(settings, { width: 600, height: 400, minSize: 35, maxSize: 100, gap: 4, whiteRatio: .65 });
  Object.assign(settings.markers, { count: 2, side: 18 });
  Object.assign(settings.sheets, { enabled: true, width: 300, bleed: 4, overlap: 12 });
  settings.artwork = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H30V65H80V100H0Z"/><rect x="100" width="20" height="100"/><rect fill="white" x="5" y="10" width="15" height="20"/></svg>', '성능.svg');
  settings.artwork.avoidance = avoidance;
  settings.artwork.widthRatio = .42;
  return settings;
}

describe('SVG 성능 개선의 생성 결과 호환성', () => {
  // 회피 방식·시드·이동·간격이 바뀌어도 기존 판정과 좌표 및 시트 출력이 같다.
  it.each(['silhouette', 'outline', 'bounds'] as const)('%s 모드의 첫 생성과 캐시 재사용이 기준 판정과 같다', async avoidance => {
    const cache = createArtworkPreparationCache();
    const settings = settingsFor(avoidance);
    for (const step of [0, 1, 2]) {
      settings.seed = `호환성-${step}`;
      if (step === 2) { settings.artwork!.x = .37; settings.gap = 6; }
      const reference = await generatePattern(settings, undefined, { usePreparedCollision: false });
      const actual = await generatePattern(settings, undefined, { artworkCache: cache });
      expect(stable(actual)).toEqual(stable(reference));
      expect(exportSvg(actual)).toBe(exportSvg(reference));
      const sheet = createSheetRegions(actual.canvas, actual.settings)[1];
      expect(exportSvg(actual, { sheet })).toBe(exportSvg(reference, { sheet }));
    }
  }, 30000);

  // 이전 결과 수정과 캐시 폐기는 새 원고에 영향을 주지 않는다.
  it('완료된 시안의 수정과 캐시 폐기 뒤에도 같은 원고를 복원한다', async () => {
    const cache = createArtworkPreparationCache();
    const settings = settingsFor('silhouette');
    const reference = await generatePattern(settings, undefined, { usePreparedCollision: false });
    const first = await generatePattern(settings, undefined, { artworkCache: cache });
    const artwork = first.shapes.find(shape => shape.kind === 'artwork')!;
    artwork.paths[0][0].x = -999; artwork.color = '#ff0000';
    first.settings.artwork!.parts[0].paths[0][0].x = .9;
    expect(stable(await generatePattern(settings, undefined, { artworkCache: cache }))).toEqual(stable(reference));
    cache.clear();
    expect(stable(await generatePattern(settings, undefined, { artworkCache: cache }))).toEqual(stable(reference));
  }, 30000);

  // SVG가 없는 생성에는 준비 자료나 SVG 전용 판정이 끼어들지 않는다.
  it('SVG가 없는 생성의 결과를 유지한다', async () => {
    const settings = settingsFor('silhouette'); delete settings.artwork;
    const reference = await generatePattern(settings, undefined, { usePreparedCollision: false });
    expect(stable(await generatePattern(settings))).toEqual(stable(reference));
  });
});

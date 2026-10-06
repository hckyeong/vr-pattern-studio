import type { PatternColors, PatternResult, PatternSettings } from './types';
import { createRandom } from './random';

export const MAX_SWATCHES = 32;

/** 짧은 색상 코드를 불투명한 여섯 자리 RGB 값으로 정규화한다. */
export function normalizeHex(value: string): string | null {
  const hex = value.trim().replace(/^#/, '');
  if (/^[\da-f]{3}$/i.test(hex)) return `#${[...hex].map(char => char + char).join('').toLowerCase()}`;
  return /^[\da-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null;
}

/** 이전 설정의 회색 비중을 유지하며 편집 가능한 팔레트로 해석한다. */
export function resolveColors(settings: Pick<PatternSettings, 'colors' | 'grayRatio'>): PatternColors {
  return settings.colors ?? { background: '#ffffff', swatches: [
    { name: '짙은 회색', color: '#4d4d4d', weight: settings.grayRatio * 100 },
    { name: '검정', color: '#000000', weight: (1 - settings.grayRatio) * 100 },
  ] };
}

/** 저장·가져오기에서 허용된 색상과 비중만 통과시킨다. */
export function validColors(value: unknown): value is PatternColors {
  if (!value || typeof value !== 'object') return false;
  const colors = value as PatternColors;
  return typeof colors.background === 'string' && /^#[\da-f]{6}$/i.test(colors.background)
    && Array.isArray(colors.swatches) && colors.swatches.length > 0 && colors.swatches.length <= MAX_SWATCHES
    && colors.swatches.every(swatch => swatch && typeof swatch.name === 'string' && swatch.name.length <= 128
      && typeof swatch.color === 'string' && /^#[\da-f]{6}$/i.test(swatch.color)
      && Number.isFinite(swatch.weight) && swatch.weight >= 0 && swatch.weight <= 1000)
    && colors.swatches.some(swatch => swatch.weight > 0);
}

/** 고정 난수 하나로 양수 비중의 색만 선택한다. */
export function chooseColor(settings: Pick<PatternSettings, 'colors' | 'grayRatio'>, sample: number): string {
  if (!settings.colors) return sample < settings.grayRatio ? '#4d4d4d' : '#000000';
  const swatches = settings.colors.swatches.filter(swatch => swatch.weight > 0);
  let cursor = sample * swatches.reduce((sum, swatch) => sum + swatch.weight, 0);
  for (const swatch of swatches) { cursor -= swatch.weight; if (cursor < 0) return swatch.color; }
  return swatches[swatches.length - 1].color;
}

/** 선택 시안의 좌표·마커·삽입 그림을 유지하고 일반 도형의 색만 바꾼다. */
export function recolorResult(result: PatternResult, colors: PatternColors): PatternResult {
  if (!validColors(colors)) throw new Error('색상과 비중을 확인해 주세요. 한 색 이상은 비중이 0보다 커야 합니다.');
  const settings = { ...result.settings, colors: structuredClone(colors) };
  return { ...result, settings, warnings: result.warnings.map(warning => warning.replaceAll('흰 여백', '여백')), shapes: result.shapes.map(shape => {
    if (shape.kind === 'marker' || shape.kind === 'artwork') return shape;
    let sample = shape.colorSample;
    if (sample === undefined || !Number.isFinite(sample) || sample < 0 || sample >= 1) {
      sample = createRandom(`${result.settings.seed}:색상:${shape.id}`)();
      // 이전 흑백 시안은 기존 회색·검정 구간 안에서 난수를 복원한다.
      if (!result.settings.colors) sample = shape.color === '#4d4d4d'
        ? sample * result.settings.grayRatio : result.settings.grayRatio + sample * (1 - result.settings.grayRatio);
      sample = Math.min(sample, 1 - Number.EPSILON);
    }
    return { ...shape, colorSample: sample, color: chooseColor(settings, sample) };
  }) };
}

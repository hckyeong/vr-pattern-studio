import { cloneSettings, resolveCanvas, UNIT_MM } from '../core/settings';
import type { PatternSettings } from '../core/types';

/** 입력 방식 전환 전후의 가로 대비 도형 크기와 실측 폭을 보존한다. */
export function convertInputMode(settings: PatternSettings, inputMode: PatternSettings['inputMode']): PatternSettings {
  if (settings.inputMode === inputMode) return cloneSettings(settings);
  const current = resolveCanvas(settings);
  const next = cloneSettings(settings);
  next.inputMode = inputMode;
  if (inputMode === 'ratio') next.printWidthMm = current.physicalWidthMm;
  else {
    next.width = current.physicalWidthMm !== null && settings.unit !== 'px' ? current.physicalWidthMm / UNIT_MM[settings.unit] : settings.width;
    next.height = next.width * current.height / current.width;
  }
  const factor = resolveCanvas(next).width / current.width;
  next.minSize *= factor; next.maxSize *= factor; next.gap *= factor; next.margin *= factor;
  next.markers.side *= factor;
  next.sheets.width *= factor; next.sheets.overlap *= factor; next.sheets.bleed *= factor;
  return next;
}

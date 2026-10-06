import { describe, expect, it } from 'vitest';
import { cloneSettings, DEFAULT_SETTINGS, parseRatio, resolveCanvas, validateSettings } from '../src/core/settings';
import { convertInputMode } from '../src/ui/convertInputMode';

describe('입력과 물리 치수', () => {
  // 단위와 비율의 서로 다른 의미를 검증한다.
  it('실측 단위는 mm로 해석하고 픽셀에는 임의 인쇄 크기를 붙이지 않는다', () => {
    const settings = cloneSettings(DEFAULT_SETTINGS);
    settings.width = 10; settings.height = 4.3; settings.unit = 'm';
    expect(resolveCanvas(settings).physicalWidthMm).toBe(10000);
    settings.unit = 'px';
    expect(resolveCanvas(settings).physicalWidthMm).toBeNull();
    settings.printWidthMm = 500;
    expect(resolveCanvas(settings).physicalHeightMm).toBe(215);
  });
  // 비율 입력은 유한한 양수끼리만 계산한다.
  it('잘못된 비율과 음수·무한대·ID 초과를 거부한다', () => {
    expect(parseRatio('21:9')).toEqual([21, 9]);
    expect(parseRatio('0:9')).toBeNull();
    expect(parseRatio('가로:세로')).toBeNull();
    const settings = cloneSettings(DEFAULT_SETTINGS);
    settings.width = Infinity; settings.gap = -1; settings.markers.startId = 999;
    expect(validateSettings(settings).length).toBeGreaterThanOrEqual(3);
  });
  // 물리 치수가 필요한 시트 분할을 확인한다.
  it('실측이 없는 픽셀 원고의 시트 분할을 막고 지정 후 허용한다', () => {
    const settings = cloneSettings(DEFAULT_SETTINGS);
    settings.unit = 'px'; settings.sheets.enabled = true;
    expect(validateSettings(settings).join(' ')).toContain('실측');
    settings.printWidthMm = 10000;
    expect(validateSettings(settings)).toEqual([]);
  });
  // 미터에서 비율 모드로 바꿔도 도형과 마커의 상대 크기를 유지한다.
  it('비율 모드 왕복 시 작은 미터값을 작업 좌표로 정확히 환산한다', () => {
    const settings = cloneSettings(DEFAULT_SETTINGS);
    settings.unit = 'm'; settings.width = 10; settings.height = 4.3;
    settings.minSize = 0.32; settings.maxSize = 1.45; settings.gap = 0.035;
    settings.markers.side = 0.25; settings.sheets.width = 1;
    settings.sheets.overlap = 0.02; settings.sheets.bleed = 0.01;
    const ratio = convertInputMode(settings, 'ratio');
    expect(ratio.minSize).toBeCloseTo(320);
    expect(ratio.markers.side).toBeCloseTo(250);
    expect(ratio.printWidthMm).toBe(10000);
    expect(resolveCanvas(ratio).width).toBe(10000);
    const restored = convertInputMode(ratio, 'size');
    expect(restored.width).toBeCloseTo(10);
    expect(restored.minSize).toBeCloseTo(0.32);
    expect(restored.gap).toBeCloseTo(0.035);
    expect(restored.sheets.bleed).toBeCloseTo(0.01);
    expect(validateSettings(restored)).toEqual([]);
  });
});

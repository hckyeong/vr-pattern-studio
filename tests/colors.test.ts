// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { importAse } from '../src/core/ase';
import { chooseColor, normalizeHex, recolorResult, resolveColors, validColors } from '../src/core/colors';
import { DEFAULT_SETTINGS, validateSettings } from '../src/core/settings';
import { generatePattern } from '../src/core/generator';
import { exportSvg } from '../src/core/svg';
import { createSheetRegions } from '../src/core/sheets';
import { loadWorkspace, saveWorkspace } from '../src/core/storage';
import type { PatternColors } from '../src/core/types';

/** 경계 조건 검증을 위한 작은 ASE 블록을 직접 구성한다. */
function aseFixture(model = 'RGB ', values = [1, 0, 0], type = 2, grouped = false): ArrayBuffer {
  const title = Buffer.from([0, 2, 0xac, 0x00, 0, 0]);
  const payload = Buffer.alloc(title.length + 4 + values.length * 4 + 2);
  title.copy(payload); payload.write(model, title.length, 'ascii');
  values.forEach((value, index) => payload.writeFloatBE(value, title.length + 4 + index * 4));
  payload.writeUInt16BE(type, payload.length - 2);
  /** 블록 본문 앞에 종류와 길이를 기록한다. */
  const block = (kind: number, data: Buffer) => { const header = Buffer.alloc(6); header.writeUInt16BE(kind); header.writeUInt32BE(data.length, 2); return Buffer.concat([header, data]); };
  const blocks = grouped ? [block(0xc001, title), block(1, payload), block(0xc002, Buffer.alloc(0))] : [block(1, payload)];
  const header = Buffer.from('415345460001000000000000', 'hex'); header.writeUInt32BE(blocks.length, 8);
  return Uint8Array.from(Buffer.concat([header, ...blocks])).buffer;
}

describe('ASE 팔레트 가져오기', () => {
  // 기존 독립 제작 스크립트가 저장한 실제 파일과 알려진 색상을 대조한다.
  it('기존 5색 ASE 파일의 한글 이름과 RGB 값을 복원한다', () => {
    const bytes = readFileSync('tests/fixtures/palette.ase');
    const imported = importAse(Uint8Array.from(bytes).buffer);
    expect(imported.swatches.map(swatch => swatch.color)).toEqual(['#ffffff', '#143d4a', '#177f80', '#e9673d', '#edb949']);
    expect(imported.swatches[0].name).toContain('청록과 주홍');
    expect(imported.notices).toEqual([]);
  });
  // 색상 그룹의 시작과 끝은 색 개수에 포함하지 않는다.
  it('그룹 안의 색상을 읽고 한글을 보존한다', () => {
    expect(importAse(aseFixture('RGB ', [1, 0, 0], 2, true)).swatches).toEqual([{ name: '가', color: '#ff0000', weight: 1 }]);
  });
  // 표준 원색과 중간 회색으로 색 공간 변환을 검증한다.
  it.each([
    ['CMYK', [0, 1, 1, 0], '#ff0000'], ['Gray', [0.5], '#808080'],
    ['LAB ', [1, 0, 0], '#ffffff'], ['LAB ', [0, 0, 0], '#000000'],
    ['LAB ', [0.5, 0, 0], '#777777'], ['LAB ', [0.542917, 80.8125, 69.8851], '#ff0000'],
  ])('색 공간 %s를 RGB로 읽는다', (model, values, expected) => {
    expect(importAse(aseFixture(model, values)).swatches[0].color).toBe(expected);
  });
  // 별색과 프로파일 없는 CMYK의 변환 한계를 호출자에게 전달한다.
  it('별색과 CMYK 근사 변환 안내를 반환한다', () => {
    expect(importAse(aseFixture('CMYK', [0, 0, 0, 1], 1)).notices).toHaveLength(2);
  });
  // 파일이 어느 지점에서 잘려도 불완전한 팔레트를 적용하지 않는다.
  it('잘린 파일과 거짓 블록 길이·개수를 거부한다', () => {
    const valid = aseFixture();
    for (let size = 0; size < valid.byteLength; size++) expect(() => importAse(valid.slice(0, size))).toThrow();
    for (const position of [8, 14]) { const bad = valid.slice(0); new DataView(bad).setUint32(position, 0xffffffff); expect(() => importAse(bad)).toThrow(); }
    const trailing = new Uint8Array(valid.byteLength + 1); trailing.set(new Uint8Array(valid));
    expect(() => importAse(trailing.buffer)).toThrow();
    expect(() => importAse(new ArrayBuffer(1_000_001))).toThrow('1MB');
  });
  // 실행 문자열이나 잘못된 수치를 색상 속성으로 전달하지 않는다.
  it('알 수 없는 형식·버전과 유효하지 않은 채널을 거부한다', () => {
    expect(() => importAse(aseFixture('HSB '))).toThrow();
    for (const value of [NaN, Infinity, -1, 2]) expect(() => importAse(aseFixture('RGB ', [value, 0, 0]))).toThrow();
    const bad = aseFixture(); new DataView(bad).setUint16(4, 2);
    expect(() => importAse(bad)).toThrow('1.0');
  });
});

const palette: PatternColors = { background: '#ece2cc', swatches: [
  { name: '청록', color: '#177f80', weight: 2 }, { name: '제외', color: '#ff00ff', weight: 0 }, { name: '주홍', color: '#e9673d', weight: 1 },
] };

describe('도형 색상과 출력', () => {
  // 직접 입력은 RGB만 허용하고 팔레트가 없는 이전 설정을 그대로 읽는다.
  it('입력 코드와 비중을 검증하고 기존 흑백 설정을 지원한다', () => {
    expect(normalizeHex('AbC')).toBe('#aabbcc'); expect(normalizeHex('url(x)')).toBeNull();
    expect(normalizeHex('#ff000080')).toBeNull(); expect(validColors(palette)).toBe(true);
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual([]);
    expect(validColors({ ...palette, swatches: [] })).toBe(false);
    expect(validColors({ ...palette, background: 'url(x)' })).toBe(false);
    expect(validColors({ ...palette, swatches: palette.swatches.map(s => ({ ...s, weight: 0 })) })).toBe(false);
    expect(validateSettings({ ...DEFAULT_SETTINGS, colors: { ...palette, background: '#oops' } }).length).toBeGreaterThan(0);
    expect(resolveColors(DEFAULT_SETTINGS).background).toBe('#ffffff');
  });
  // 색상 비중 0은 선택 구간의 경계에서도 제외한다.
  it('0 비중을 제외하고 나머지 비중대로 색상을 배정한다', () => {
    const settings = { ...DEFAULT_SETTINGS, colors: palette };
    expect(chooseColor(settings, 0)).toBe('#177f80');
    expect(chooseColor(settings, 2 / 3)).toBe('#e9673d');
    expect(chooseColor(settings, 0.99999)).toBe('#e9673d');
  });
  // 새 생성과 즉시 재색칠이 동일한 좌표·난수·색상을 사용하도록 검증한다.
  it('재색칠·재생성·전체 및 시트 출력·저장 복원에 같은 팔레트를 사용한다', async () => {
    const input = structuredClone(DEFAULT_SETTINGS);
    Object.assign(input, { width: 600, height: 300, minSize: 30, maxSize: 80, gap: 3, whiteRatio: .82 });
    Object.assign(input.markers, { count: 1, side: 30 });
    Object.assign(input.sheets, { enabled: true, width: 300, bleed: 5 });
    const original = await generatePattern(input);
    const changed = recolorResult(original, palette);
    const regenerated = await generatePattern({ ...input, colors: palette });
    expect(changed.shapes).toEqual(regenerated.shapes);
    expect(changed.shapes.map(s => s.paths)).toEqual(original.shapes.map(s => s.paths));
    expect(changed.whiteRatio).toBe(original.whiteRatio);
    expect(changed.shapes.find(s => s.kind === 'marker')).toEqual(original.shapes.find(s => s.kind === 'marker'));
    expect(original.settings.colors).toBeUndefined();
    for (const options of [{}, { sheet: createSheetRegions(changed.canvas, changed.settings)[1] }]) {
      const doc = new DOMParser().parseFromString(exportSvg(changed, options), 'image/svg+xml');
      expect(doc.querySelector('parsererror')).toBeNull();
      expect(doc.querySelector('svg > rect')?.getAttribute('fill')).toBe(palette.background);
      expect(doc.querySelector('[data-aruco-id] > path')?.getAttribute('fill')).toBe('#ffffff');
      expect(doc.querySelector('[data-aruco-id] > path:last-child')?.getAttribute('fill')).toBe('#000000');
      expect(doc.querySelector('image')).toBeNull();
      expect(JSON.parse(doc.querySelector('metadata')!.textContent!).settings.colors).toEqual(palette);
    }
    saveWorkspace(changed.settings, [changed, original]);
    expect(loadWorkspace()?.results[0]).toEqual(changed);
    expect(loadWorkspace()?.results[1].settings.colors).toBeUndefined();
    const legacy = structuredClone(original); legacy.shapes.forEach(shape => { delete shape.colorSample; });
    expect(recolorResult(legacy, resolveColors(input)).shapes.map(s => s.color)).toEqual(original.shapes.map(s => s.color));
    const artwork = { ...original.shapes[0], kind: 'artwork' as const, color: '#fedcba' };
    expect(recolorResult({ ...original, shapes: [artwork] }, palette).shapes[0]).toBe(artwork);
  }, 30000);
});

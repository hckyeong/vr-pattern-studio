import type { ColorSwatch } from './types';
import { MAX_SWATCHES } from './colors';

export const MAX_ASE_BYTES = 1_000_000;

/** 0~1 채널을 SVG에서 사용할 불투명 RGB 색상으로 변환한다. */
function rgbHex(channels: number[]): string {
  return '#' + channels.map(channel => Math.round(Math.max(0, Math.min(1, channel)) * 255).toString(16).padStart(2, '0')).join('');
}

/** D50 기준 Lab를 D65로 순응한 뒤 sRGB로 변환하고 색역 밖 채널은 제한한다. */
function labToRgb([lightness, a, b]: number[]): number[] {
  const fy = (lightness * 100 + 16) / 116;
  /** Lab의 비선형 좌표를 기준 백색에 대한 삼자극 값으로 복원한다. */
  const inverse = (value: number) => value > 6 / 29 ? value ** 3 : (value - 4 / 29) * 3 * (6 / 29) ** 2;
  const x50 = inverse(fy + a / 500) * 0.9642956764, y50 = inverse(fy), z50 = inverse(fy - b / 200) * 0.8251046025;
  const x = 0.9554734215 * x50 - 0.0230984549 * y50 + 0.0632592432 * z50;
  const y = -0.0283697093 * x50 + 1.0099953981 * y50 + 0.0210414412 * z50;
  const z = 0.0123140149 * x50 - 0.0205076493 * y50 + 1.3303659262 * z50;
  const linear = [3.2409699419 * x - 1.5373831776 * y - 0.4986107603 * z,
    -0.9692436363 * x + 1.8759675015 * y + 0.0415550574 * z,
    0.0556300797 * x - 0.2039769589 * y + 1.0569715142 * z];
  return linear.map(value => value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);
}

/** 길이·개수·색상 값을 검증하며 로컬 ASE 1.0 색상표만 읽는다. */
export function importAse(buffer: ArrayBuffer): { swatches: ColorSwatch[]; notices: string[] } {
  if (buffer.byteLength > MAX_ASE_BYTES) throw new Error('ASE 파일은 1MB 이하로 선택해 주세요.');
  const view = new DataView(buffer);
  let offset = 0, boundary = buffer.byteLength;
  /** 현재 블록 범위를 벗어나는 읽기를 차단한다. */
  function requireBytes(count: number) {
    if (offset + count > boundary) throw new Error('ASE 파일이 잘렸거나 블록 길이가 올바르지 않습니다.');
  }
  /** 큰 바이트부터 저장된 16비트 정수를 읽는다. */
  function u16() { requireBytes(2); const value = view.getUint16(offset); offset += 2; return value; }
  /** 큰 바이트부터 저장된 32비트 정수를 읽는다. */
  function u32() { requireBytes(4); const value = view.getUint32(offset); offset += 4; return value; }
  /** 고정 길이 형식 식별자를 읽는다. */
  function ascii(count: number) {
    requireBytes(count); let value = '';
    for (let i = 0; i < count; i++) value += String.fromCharCode(view.getUint8(offset++));
    return value;
  }
  /** 종료 문자가 포함된 UTF-16 색상·그룹 이름을 읽는다. */
  function name() {
    const count = u16();
    if (count < 1 || count > 4096) throw new Error('ASE 색상 이름의 길이가 올바르지 않습니다.');
    requireBytes(count * 2);
    const bytes = new Uint8Array(buffer, offset, (count - 1) * 2); offset += (count - 1) * 2;
    if (u16() !== 0) throw new Error('ASE 색상 이름의 종료 문자가 없습니다.');
    try { return new TextDecoder('utf-16be', { fatal: true }).decode(bytes).replace(/[\u0000-\u001f]/g, '').slice(0, 128); }
    catch { throw new Error('ASE 색상 이름의 문자 인코딩이 올바르지 않습니다.'); }
  }
  if (ascii(4) !== 'ASEF') throw new Error('Adobe 색상표 ASE 파일을 선택해 주세요.');
  if (u16() !== 1 || u16() !== 0) throw new Error('ASE 1.0 형식만 지원합니다.');
  const blocks = u32();
  if (blocks < 1 || blocks > 4096) throw new Error('ASE 블록 수가 허용 범위를 벗어났습니다.');
  const swatches: ColorSwatch[] = [], notices = new Set<string>();
  let groups = 0;
  for (let block = 0; block < blocks; block++) {
    boundary = buffer.byteLength;
    const type = u16(), length = u32(); requireBytes(length); boundary = offset + length;
    if (type === 0xc001) { name(); groups++; }
    else if (type === 0xc002) {
      if (!groups) throw new Error('ASE 색상 그룹 구성이 올바르지 않습니다.');
      groups--;
    } else if (type === 1) {
      const title = name(), model = ascii(4);
      const channels = ({ 'RGB ': 3, CMYK: 4, 'LAB ': 3, Gray: 1 } as Record<string, number>)[model];
      if (!channels) throw new Error('이 ASE 파일에 지원하지 않는 색상 형식이 있습니다. RGB 색상표로 저장해 주세요.');
      const values: number[] = [];
      for (let i = 0; i < channels; i++) {
        requireBytes(4); const value = view.getFloat32(offset); offset += 4;
        const isLabChannel = model === 'LAB ' && i > 0;
        if (!Number.isFinite(value) || value < (isLabChannel ? -128 : 0) || value > (isLabChannel ? 127 : 1)) throw new Error('ASE 색상 값이 허용 범위를 벗어났습니다.');
        values.push(value);
      }
      const colorType = u16();
      if (colorType > 2) throw new Error('ASE 색상 유형이 올바르지 않습니다.');
      if (colorType === 1) notices.add('별색은 RGB 색상으로 가져오며 별색 지정은 유지하지 않습니다.');
      let rgb = values;
      if (model === 'CMYK') {
        rgb = values.slice(0, 3).map(value => (1 - value) * (1 - values[3]));
        notices.add('CMYK는 인쇄 프로파일 없이 RGB 근사색으로 변환했습니다.');
      } else if (model === 'LAB ') {
        rgb = labToRgb(values); notices.add('Lab는 sRGB로 변환하며 색역 밖 색상은 조정됩니다.');
      } else if (model === 'Gray') rgb = [values[0], values[0], values[0]];
      swatches.push({ name: title || `색상 ${swatches.length + 1}`, color: rgbHex(rgb), weight: 1 });
      if (swatches.length > MAX_SWATCHES) throw new Error(`색상은 최대 ${MAX_SWATCHES}개입니다. 사용할 색상만 담은 ASE 파일을 선택해 주세요.`);
    } else throw new Error('지원하지 않는 ASE 블록이 있습니다. 색상표를 다시 저장해 주세요.');
    if (offset !== boundary) throw new Error('ASE 블록 길이가 내용과 일치하지 않습니다.');
  }
  if (offset !== buffer.byteLength || groups) throw new Error('ASE 파일의 블록 수 또는 그룹 구성이 올바르지 않습니다.');
  if (!swatches.length) throw new Error('ASE 파일에 사용할 색상이 없습니다.');
  return { swatches, notices: [...notices] };
}

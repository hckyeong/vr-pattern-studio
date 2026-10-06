import dictionaryData from '../data/arucogen.json';
import type { PatternSettings, PatternShape, Polygon } from './types';

const dictionaries = dictionaryData as Record<string, number[][]>;

/** 사전 비트를 검증하고 회전된 검정 셀과 흰 보호 영역을 생성한다. */
export function createMarker(options: PatternSettings['markers'], id: number, x: number, y: number, rotation: number, sheetIndex: number): PatternShape {
  const size = Number(options.dictionary[0]);
  const entries = dictionaries[options.dictionary];
  if (![4, 5, 6].includes(size) || !entries || !Number.isInteger(id) || id < 0 || id >= entries.length) throw new Error('마커 사전 또는 번호가 올바르지 않습니다.');
  if (![x, y, rotation, options.side, options.quietZoneCells].every(Number.isFinite) || options.side <= 0 || options.quietZoneCells < 0) throw new Error('마커 크기 또는 좌표가 올바르지 않습니다.');
  const bytes = entries[id];
  const total = size * size;
  if (bytes.length !== Math.ceil(total / 8) || bytes.some((byte, index) => !Number.isInteger(byte) || byte < 0 || byte >= 2 ** Math.min(8, total - index * 8))) throw new Error('마커 사전 비트 정보가 올바르지 않습니다.');
  const bits: number[] = [];
  for (const byte of bytes) for (let bit = Math.min(7, total - bits.length - 1); bit >= 0; bit--) bits.push((byte >> bit) & 1);
  const cell = options.side / (size + 2);
  const angle = rotation * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  /** 중심 기준 사각형을 전역 좌표로 회전한다. */
  const square = (left: number, top: number, side: number): Polygon => [[left, top], [left + side, top], [left + side, top + side], [left, top + side]].map(([px, py]) => ({ x: x + px * cos - py * sin, y: y + px * sin + py * cos }));
  const paths: Polygon[] = [];
  for (let row = 0; row < size + 2; row++) for (let col = 0; col < size + 2; col++) {
    if (row === 0 || col === 0 || row === size + 1 || col === size + 1 || bits[(row - 1) * size + col - 1] === 0) paths.push(square(col * cell - options.side / 2, row * cell - options.side / 2, cell));
  }
  const fullSide = options.side + 2 * options.quietZoneCells * cell;
  const footprint = [square(-fullSide / 2, -fullSide / 2, fullSide)];
  const points = footprint[0];
  return { id: `marker-${options.dictionary}-${id}`, kind: 'marker', color: '#000000', paths, fillRule: 'nonzero', footprint,
    bounds: { minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)) },
    area: paths.length * cell * cell, marker: { dictionary: options.dictionary, id, x, y, side: options.side, rotation, quietZoneCells: options.quietZoneCells, sheetIndex } };
}

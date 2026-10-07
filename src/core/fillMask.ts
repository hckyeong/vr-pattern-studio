import RBush from 'rbush';
import { boundsOf, intersectPaths, normalizePaths, pathsArea, rectangle } from './geometry';
import type { Bounds, FillMask, Polygon, ResolvedCanvas } from './types';

export const MASK_RESOLUTION = 512;
export const MAX_MASK_POINTS = 16000;
export const MASK_THRESHOLD = 200;
const MAX_RUNS = 12000;
interface Run { x: number; y: number; width: number; height: number }
interface MaskEntry extends Bounds { path: Polygon }

/** 밝은 불투명 픽셀의 연속 구간을 합쳐 구멍과 분리 영역을 보존한 벡터를 만든다. */
export function maskFromPixels(data: Uint8ClampedArray, width: number, height: number, name: string, threshold = MASK_THRESHOLD): FillMask {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || Math.max(width, height) > MASK_RESOLUTION || data.length !== width * height * 4) throw new Error('이미지 분석 크기 또는 픽셀 데이터가 올바르지 않습니다.');
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 255) throw new Error('흰색 기준은 1~255 사이의 정수여야 합니다.');
  const runs: Run[] = [];
  let previous = new Map<string, Run>();
  /** 투명도를 검정 배경에 합성한 밝기로 계산해 투명한 흰 픽셀을 제외한다. */
  const white = (x: number, y: number): boolean => {
    const offset = (y * width + x) * 4;
    return (data[offset] * .2126 + data[offset + 1] * .7152 + data[offset + 2] * .0722) * data[offset + 3] / 255 >= threshold;
  };
  for (let y = 0; y < height; y++) {
    const current = new Map<string, Run>();
    for (let x = 0; x < width;) {
      if (!white(x, y)) { x++; continue; }
      const start = x;
      while (x < width && white(x, y)) x++;
      const key = `${start}:${x}`, prior = previous.get(key);
      const run = prior ?? { x: start, y, width: x - start, height: 0 };
      run.height++; current.set(key, run);
      if (!prior) runs.push(run);
      if (runs.length > MAX_RUNS) throw new Error('이미지의 작은 점과 경계가 너무 많습니다. 잡음을 줄인 흑백 이미지로 다시 불러와 주세요.');
    }
    previous = current;
  }
  if (!runs.length) throw new Error('채울 흰색 영역이 없습니다. 밝기 200 이상의 불투명한 흰색 부분이 있는 이미지를 선택해 주세요.');
  const outlines = normalizePaths(runs.flatMap(run => rectangle(run.x, run.y, run.width, run.height)));
  // 합집합의 일직선 중간 점만 제거해 픽셀 외곽과 구멍을 그대로 유지한다.
  const paths = outlines.map(path => path.filter((point, index) => {
    const before = path[(index + path.length - 1) % path.length], after = path[(index + 1) % path.length];
    return (point.x - before.x) * (after.y - point.y) !== (point.y - before.y) * (after.x - point.x);
  }).map(point => ({ x: point.x / width, y: point.y / height })));
  if (paths.reduce((count, path) => count + path.length, 0) > MAX_MASK_POINTS) throw new Error('흰색 영역의 경계가 너무 복잡합니다. 작은 점이나 미세한 무늬를 줄여 주세요.');
  return { name: name.slice(0, 200), aspect: height / width, width, height, threshold, fit: 'contain', paths };
}

/** 저장소와 워커에서 마스크 크기·좌표·복잡도·실제 채움 면적을 검증한다. */
export function validFillMask(mask: FillMask): boolean {
  if (!mask || typeof mask.name !== 'string' || mask.name.length > 200 || !['contain', 'stretch'].includes(mask.fit)) return false;
  if (!Number.isFinite(mask.aspect) || mask.aspect < .000001 || mask.aspect > 1e6) return false;
  if (![mask.width, mask.height].every(value => Number.isInteger(value) && value >= 1 && value <= MASK_RESOLUTION) || !Number.isInteger(mask.threshold) || mask.threshold < 1 || mask.threshold > 255) return false;
  if (!Array.isArray(mask.paths) || !mask.paths.length || mask.paths.length > MAX_MASK_POINTS / 3) return false;
  let points = 0;
  return mask.paths.every(path => Array.isArray(path) && path.length >= 3 && (points += path.length) <= MAX_MASK_POINTS && path.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)) && pathsArea(mask.paths) > 0;
}

/** 이미지 비율 유지 또는 캔버스 맞춤 설정으로 흰 영역을 작업 좌표에 옮긴다. */
export function maskPaths(mask: FillMask, canvas: Pick<ResolvedCanvas, 'width' | 'height'>): Polygon[] {
  const width = mask.fit === 'stretch' ? canvas.width : Math.min(canvas.width, canvas.height / mask.aspect);
  const height = mask.fit === 'stretch' ? canvas.height : width * mask.aspect;
  const left = (canvas.width - width) / 2, top = (canvas.height - height) / 2;
  return mask.paths.map(path => path.map(point => ({ x: left + point.x * width, y: top + point.y * height })));
}

/** 가까운 마스크 경로만 교집합에 사용하며 구멍의 방향을 보존한다. */
export function prepareFillMask(mask: FillMask, canvas: ResolvedCanvas) {
  const paths = normalizePaths(maskPaths(mask, canvas));
  const area = pathsArea(paths);
  if (!area) throw new Error('현재 작업 크기에서 흰색 영역을 계산할 수 없습니다. 작업 크기를 늘려 주세요.');
  const index = new RBush<MaskEntry>().load(paths.map(path => ({ ...boundsOf([path]), path })));
  return {
    paths, area, bounds: boundsOf(paths),
    /** 후보와 경계 상자가 겹치는 흰 영역 및 내부 구멍으로 도형을 자른다. */
    clip(candidate: Polygon[]): Polygon[] {
      if (!candidate.length) return [];
      const nearby = index.search(boundsOf(candidate)).map(entry => entry.path);
      return nearby.length ? intersectPaths(candidate, nearby) : [];
    },
  };
}

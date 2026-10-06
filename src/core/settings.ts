import type { PatternSettings, ResolvedCanvas, ShapeKind, Unit } from './types';
import { validArtwork } from './artwork';
import { validColors } from './colors';

export const GENERATOR_VERSION = '1.5.0';
export const UNIT_MM: Record<Unit, number> = { mm: 1, cm: 10, m: 1000, px: 1 };
export const SHAPE_LABELS: Record<ShapeKind, string> = {
  triangle: '삼각형', polygon: '다각형', frame: '열린 프레임', arc: '원·원호', symbol: '십자·빗금', cylinder: '원통', stair: '계단',
};
export const DEFAULT_SETTINGS: PatternSettings = {
  width: 10000, height: 4300, unit: 'mm', inputMode: 'size', aspectRatio: '21:9', printWidthMm: null,
  seed: '공간-2026', whiteRatio: 0.58, minSize: 320, maxSize: 1450, gap: 35, margin: 0,
  edgeCrop: true, grayRatio: 0.28, vertexMin: 4, vertexMax: 8, concaveRatio: 0.35, rotationStep: 0,
  weights: { triangle: 30, polygon: 25, frame: 15, arc: 10, symbol: 15, cylinder: 5, stair: 15 },
  markers: { enabled: true, dictionary: '4x4_1000', count: 8, startId: 0, side: 250, quietZoneCells: 1, rotate: true },
  sheets: { enabled: false, width: 1000, overlap: 20, bleed: 10, scale: 1 },
};

/** 중첩 설정을 독립적으로 복사해 다른 시안의 설정을 보호한다. */
export function cloneSettings(settings: PatternSettings): PatternSettings {
  return structuredClone(settings);
}

/** 재현에 사용할 새 시드 문자열을 만든다. */
export function makeSeed(): string {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  return Array.from(values, value => value.toString(36)).join('-');
}

/** 가로와 세로의 비율 문자열을 양수 두 개로 해석한다. */
export function parseRatio(value: string): [number, number] | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)\s*$/.exec(value);
  if (!match) return null;
  const width = Number(match[1]), height = Number(match[2]);
  return width > 0 && height > 0 && Number.isFinite(width / height) ? [width, height] : null;
}

/** 작업 좌표와 인쇄용 물리 치수를 구분해 캔버스를 해석한다. */
export function resolveCanvas(settings: PatternSettings): ResolvedCanvas {
  const ratioMode = settings.inputMode === 'ratio';
  const ratio = parseRatio(settings.aspectRatio);
  if (ratioMode && !ratio) throw new Error('비율은 21:9처럼 양수 두 개로 입력해 주세요.');
  const width = ratioMode ? 10000 : settings.width;
  const height = ratioMode ? 10000 * ratio![1] / ratio![0] : settings.height;
  const physical = !ratioMode && settings.unit !== 'px';
  const physicalWidthMm = physical ? width * UNIT_MM[settings.unit] : settings.printWidthMm;
  return {
    width, height,
    physicalWidthMm,
    physicalHeightMm: physicalWidthMm === null ? null : physicalWidthMm * height / width,
    lengthUnit: ratioMode ? '단위' : settings.unit,
  };
}

/** 생성 전에 입력 범위와 서로 충돌하는 설정을 점검한다. */
export function validateSettings(settings: PatternSettings): string[] {
  const errors: string[] = [];
  if (!settings || typeof settings !== 'object') return ['설정 형식이 올바르지 않습니다.'];
  if (settings.colors !== undefined && !validColors(settings.colors)) errors.push('팔레트는 배경색과 1~32개의 RGB 색상으로 구성하고, 한 색 이상의 비중을 0보다 크게 지정해 주세요.');
  if (settings.artwork !== undefined && !validArtwork(settings.artwork)) errors.push('삽입 SVG의 벡터 데이터나 배치 값이 올바르지 않습니다. 파일을 다시 불러와 주세요.');
  if (!['mm', 'cm', 'm', 'px'].includes(settings.unit)) errors.push('지원하지 않는 길이 단위입니다.');
  if (!['size', 'ratio'].includes(settings.inputMode)) errors.push('작업 크기 입력 방식을 선택해 주세요.');
  if (typeof settings.seed !== 'string' || settings.seed.length < 1 || settings.seed.length > 128) errors.push('시드는 1~128자로 입력해 주세요.');
  if (typeof settings.aspectRatio !== 'string' || (settings.inputMode === 'ratio' && !parseRatio(settings.aspectRatio))) errors.push('비율은 21:9처럼 입력해 주세요.');
  const lengths: [string, number, number, number][] = [
    ['가로', settings.width, 0.001, 1e6], ['세로', settings.height, 0.001, 1e6],
    ['최소 도형 크기', settings.minSize, 0.0001, 1e6], ['최대 도형 크기', settings.maxSize, 0.0001, 1e6],
    ['최소 간격', settings.gap, 0, 1e6], ['외곽 여백', settings.margin, 0, 1e6],
    ['여백 비율', settings.whiteRatio, 0.05, 0.98], ['회색 비율', settings.grayRatio, 0, 1],
    ['오목한 도형 비율', settings.concaveRatio, 0, 1], ['회전 단계', settings.rotationStep, 0, 180],
    ['최소 꼭짓점 수', settings.vertexMin, 3, 12], ['최대 꼭짓점 수', settings.vertexMax, 3, 12],
  ];
  for (const [name, value, min, max] of lengths) {
    if (!Number.isFinite(value) || value < min || value > max) errors.push(`${name}은 ${min}~${max} 범위로 입력해 주세요.`);
  }
  if (settings.minSize > settings.maxSize) errors.push('최소 도형 크기는 최대 크기보다 클 수 없습니다.');
  if (settings.vertexMin > settings.vertexMax || !Number.isInteger(settings.vertexMin) || !Number.isInteger(settings.vertexMax)) errors.push('꼭짓점 범위는 작은 정수부터 큰 정수 순서로 입력해 주세요.');
  if (settings.printWidthMm !== null && (!Number.isFinite(settings.printWidthMm) || settings.printWidthMm <= 0 || settings.printWidthMm > 1e9)) errors.push('실측 인쇄 가로 길이는 0보다 큰 mm 값으로 입력해 주세요.');
  const weights = settings.weights;
  if (!weights || Object.keys(SHAPE_LABELS).some(kind => {
    // 계단 항목이 없는 기존 시안은 나머지 비중을 유지한 채 불러온다.
    const weight = weights[kind as ShapeKind] ?? (kind === 'stair' ? 0 : NaN);
    return !Number.isFinite(weight) || weight < 0 || weight > 1000;
  })) errors.push('도형별 비중은 0~1000으로 입력해 주세요.');
  else if (Object.values(weights).reduce((sum, value) => sum + value, 0) <= 0) errors.push('도형을 한 종류 이상 선택해 주세요.');
  const marker = settings.markers;
  if (!marker || !['4x4_1000', '5x5_1000', '6x6_1000'].includes(marker.dictionary)) errors.push('ArUco 사전을 선택해 주세요.');
  else {
    if (!Number.isInteger(marker.count) || marker.count < 0 || marker.count > 1000) errors.push('마커 수는 0~1000개로 입력해 주세요.');
    if (!Number.isInteger(marker.startId) || marker.startId < 0 || marker.startId + marker.count > 1000) errors.push('마커 ID는 사전 범위 0~999 안에서 중복 없이 배치해야 합니다.');
    if (!Number.isFinite(marker.side) || marker.side <= 0) errors.push('마커 한 변의 길이는 0보다 커야 합니다.');
    if (!Number.isFinite(marker.quietZoneCells) || marker.quietZoneCells < 1 || marker.quietZoneCells > 10) errors.push('마커 보호 여백은 1~10셀로 입력해 주세요.');
  }
  const sheets = settings.sheets;
  if (!sheets) errors.push('시트 출력 설정이 없습니다.');
  else {
    if (!Number.isFinite(sheets.width) || sheets.width <= 0) errors.push('시트 유효 폭은 0보다 커야 합니다.');
    if (!Number.isFinite(sheets.overlap) || sheets.overlap < 0 || sheets.overlap >= sheets.width) errors.push('시공 겹침은 0 이상, 시트 유효 폭 미만으로 입력해 주세요.');
    if (!Number.isFinite(sheets.bleed) || sheets.bleed < 0 || sheets.bleed >= sheets.width / 2) errors.push('도련은 시트 유효 폭의 절반보다 작아야 합니다.');
    if (![1, 0.1].includes(sheets.scale)) errors.push('출력 축척은 1:1 또는 1:10으로 선택해 주세요.');
  }
  if (errors.length) return errors;
  const canvas = resolveCanvas(settings);
  if (canvas.width / canvas.height > 200 || canvas.height / canvas.width > 200) errors.push('가로세로 비율은 200:1~1:200 범위로 입력해 주세요.');
  if (settings.margin * 2 >= Math.min(canvas.width, canvas.height)) errors.push('외곽 여백이 작업 영역을 모두 차지합니다.');
  if (settings.gap >= Math.min(canvas.width, canvas.height)) errors.push('최소 간격은 작업 영역의 짧은 변보다 작아야 합니다.');
  if (sheets.enabled && Math.ceil(canvas.width / sheets.width) > 500) errors.push('시트 분할은 최대 500장입니다. 유효 폭을 늘려 주세요.');
  if (sheets.enabled && canvas.physicalWidthMm === null) errors.push('시트 분할에는 실측 인쇄 가로 길이가 필요합니다.');
  return errors;
}

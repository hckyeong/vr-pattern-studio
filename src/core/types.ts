export type Point = { x: number; y: number };
export type Polygon = Point[];
export type ShapeKind = 'triangle' | 'polygon' | 'frame' | 'arc' | 'symbol' | 'cylinder' | 'stair';
export type Unit = 'mm' | 'cm' | 'm' | 'px';
export type DictionaryName = '4x4_1000' | '5x5_1000' | '6x6_1000';

export interface SvgArtwork {
  name: string;
  /** 원본 윤곽을 가로 1의 좌표계로 정규화하고 세로/가로 비율을 저장한다. */
  aspect: number;
  parts: { color: string; paths: Polygon[] }[];
  /** 캔버스 대비 중심 위치와 가로 비율로 단위 전환에도 배치를 보존한다. */
  x: number;
  y: number;
  widthRatio: number;
  /** 최외곽 배치는 내부 구멍을 보호하고 도형의 형태를 유지해 윤곽 가까이 옮긴다. */
  avoidance: 'silhouette' | 'outline' | 'bounds';
}

export interface PatternSettings {
  width: number;
  height: number;
  unit: Unit;
  inputMode: 'size' | 'ratio';
  aspectRatio: string;
  printWidthMm: number | null;
  seed: string;
  whiteRatio: number;
  minSize: number;
  maxSize: number;
  gap: number;
  margin: number;
  edgeCrop: boolean;
  grayRatio: number;
  /** 없으면 기존 검정·회색 비중과 흰 배경을 사용한다. */
  colors?: PatternColors;
  vertexMin: number;
  vertexMax: number;
  concaveRatio: number;
  rotationStep: number;
  /** 이전 시안에 계단 비중이 없으면 0으로 취급한다. */
  weights: Record<Exclude<ShapeKind, 'stair'>, number> & { stair?: number };
  artwork?: SvgArtwork;
  markers: {
    enabled: boolean;
    dictionary: DictionaryName;
    count: number;
    startId: number;
    side: number;
    quietZoneCells: number;
    rotate: boolean;
  };
  sheets: {
    enabled: boolean;
    width: number;
    overlap: number;
    bleed: number;
    scale: 1 | 0.1;
  };
}

export interface ColorSwatch { name: string; color: string; weight: number }
export interface PatternColors { background: string; swatches: ColorSwatch[] }

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export interface MarkerInfo {
  dictionary: DictionaryName;
  id: number;
  x: number;
  y: number;
  side: number;
  rotation: number;
  quietZoneCells: number;
  sheetIndex: number;
}

export interface PatternShape {
  id: string;
  kind: ShapeKind | 'marker' | 'artwork';
  color: string;
  /** 팔레트를 바꿔도 색 배정과 도형 배치를 재현하는 난수 값이다. */
  colorSample?: number;
  /** 실제 잉크가 놓이는 벡터 외곽선과 구멍을 저장한다. */
  paths: Polygon[];
  /** 외곽에서 잘린 도형의 원본을 도련 인쇄에만 사용한다. */
  bleedPaths?: Polygon[];
  /** 한 도형의 흰 구멍을 포함한 채움 규칙이다. */
  fillRule: 'evenodd' | 'nonzero';
  /** 마커는 흰 보호 영역 전체를 충돌 검사에 사용한다. */
  footprint?: Polygon[];
  bounds: Bounds;
  area: number;
  marker?: MarkerInfo;
}

export interface ResolvedCanvas {
  width: number;
  height: number;
  physicalWidthMm: number | null;
  physicalHeightMm: number | null;
  lengthUnit: string;
}

export interface GenerationProgress {
  progress: number;
  phase: string;
  placed: number;
  whiteRatio: number;
}

export interface PatternResult {
  version: string;
  settings: PatternSettings;
  canvas: ResolvedCanvas;
  shapes: PatternShape[];
  whiteRatio: number;
  targetReached: boolean;
  attempts: number;
  warnings: string[];
  elapsedMs: number;
}

export interface SheetRegion {
  index: number;
  trimX: number;
  trimWidth: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type WorkerResponse =
  | { type: 'progress'; value: GenerationProgress }
  | { type: 'result'; value: PatternResult }
  | { type: 'error'; message: string };

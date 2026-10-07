export type Point = { x: number; y: number };
export type Polygon = Point[];
export type ShapeKind = 'triangle' | 'polygon' | 'frame' | 'arc' | 'symbol' | 'cylinder' | 'stair';
export type Unit = 'mm' | 'cm' | 'm' | 'px';
export type DictionaryName = '4x4_1000' | '5x5_1000' | '6x6_1000';

export interface FillMask {
  name: string;
  /** 분석 해상도로 줄이기 전 원본 이미지의 세로/가로 비율을 보존한다. */
  aspect: number;
  /** 분석한 이미지의 픽셀 크기와 흰색 판정 기준을 기록한다. */
  width: number;
  height: number;
  threshold: number;
  fit: 'contain' | 'stretch';
  /** 이미지의 가로·세로를 각각 1로 정규화한 흰 영역이며 내부 구멍도 보존한다. */
  paths: Polygon[];
}

export interface SvgArtwork {
  name: string;
  /** 원본 윤곽을 가로 1의 좌표계로 정규화하고 세로/가로 비율을 저장한다. */
  aspect: number;
  parts: { color: string; paths: Polygon[] }[];
  /** 캔버스 대비 중심 위치와 가로 비율로 단위 전환에도 배치를 보존한다. */
  x: number;
  y: number;
  widthRatio: number;
  /** SVG 중심을 기준으로 시계 방향으로 회전하는 각도이며 생략하면 0도다. */
  rotation?: number;
  /** 최외곽 배치는 내부 구멍을 보호하고 도형의 형태를 유지해 윤곽 가까이 옮긴다. */
  avoidance: 'silhouette' | 'outline' | 'bounds';
  /** 오차 기반 간략화에서 원본 너비 대비 허용 오차이며 미지정 또는 0이면 원본을 사용한다. */
  contourTolerance?: number;
  /** 미지정은 기존 오차 기반 간략화이고 grouped-hull은 근접 덩어리별 볼록 껍질을 쓴다. */
  contourMode?: 'simplify' | 'grouped-hull';
  /** 볼록 껍질로 함께 묶을 조각 사이 거리이며 SVG 너비 대비 비율이다. */
  hullMergeRatio?: number;
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
  /** 여러 SVG의 그리기 순서이며 기존 단일 artwork 설정과 함께 사용하지 않는다. */
  artworks?: SvgArtwork[];
  /** 흑백 이미지에서 추출한 흰 영역 안으로 일반 패턴을 잘라 배치한다. */
  fillMask?: FillMask;
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

export interface WorkerRequest {
  requestId: number;
  settings: PatternSettings;
}

export type WorkerResponse =
  | { requestId: number; type: 'progress'; value: GenerationProgress }
  | { requestId: number; type: 'result'; value: PatternResult }
  | { requestId: number; type: 'error'; message: string };

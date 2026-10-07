import { artworkContour, constrainArtwork, placeArtwork } from './artwork';
import { createContourGuide } from './contourPlacement';
import type { ContourGuide } from './contourPlacement';
import { prepareCollision } from './geometry';
import type { PreparedCollision } from './geometry';
import { simplifyCollisionContour } from './simplifyContour';
import { DEFAULT_HULL_MERGE_RATIO, groupedHullContour } from './groupedHull';
import type { PatternShape, Polygon, ResolvedCanvas, SvgArtwork } from './types';

export interface ArtworkContourSimplification {
  originalSegments: number;
  simplifiedSegments: number;
  applied: boolean;
  /** 실제 캔버스 좌표의 길이 단위로 환산한 간략화 허용 오차다. */
  tolerance: number;
  /** 덩어리별 볼록 껍질에만 묶음 수와 실제 묶음 거리를 기록한다. */
  method?: 'grouped-hull';
  groups?: number;
  mergeDistance?: number;
}

export interface PreparedArtwork {
  shapes: PatternShape[];
  /** 보호 윤곽과 충돌 자료 및 가이드는 읽기 전용으로 공유한다. */
  footprint: Polygon[];
  inkArea: number;
  collision: PreparedCollision;
  contour: ContourGuide | null;
  simplification: ArtworkContourSimplification;
}

export interface ArtworkPreparationCacheOptions {
  /** 회피 모드를 포함한 원본 기하 자료의 최대 보관 개수다. */
  maxArtworks?: number;
  /** 원본·배치·계산 윤곽에서 실제 보관하는 선분 수 합계 상한이다. */
  maxSegments?: number;
}

export interface ArtworkPreparationCacheStats {
  hits: number;
  misses: number;
  contourHits: number;
  contourMisses: number;
  collisionPreparations: number;
  contourPreparations: number;
  evictions: number;
  artworkCount: number;
  placementCount: number;
  /** 실제 충돌 색인에 들어간 선분 수로 기존 통계의 의미를 유지한다. */
  segmentCount: number;
  /** 같은 객체는 중복 집계하지 않은 원본·배치·계산 윤곽의 선분 합계다. */
  retainedSegmentCount: number;
}

export interface ArtworkPreparationCache {
  /** 원본 윤곽과 최신 배치의 준비 자료를 재사용한다. */
  prepare(artwork: SvgArtwork, canvas: ResolvedCanvas, instanceKey?: string): PreparedArtwork;
  /** 보관 자료와 누적 검증 카운터를 모두 비운다. */
  clear(): void;
  /** 보관 수와 실제 준비 횟수의 독립적인 표본을 반환한다. */
  getStats(): ArtworkPreparationCacheStats;
}

interface ArtworkCacheEntry {
  originalContour: Polygon[];
  placementKey: string;
  prepared: PreparedArtwork;
  retainedSegments: number;
}

/** 좌표를 반올림하지 않고 음의 영까지 구분한 일정한 배열 키를 만든다. */
function serializeKey(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => typeof item === 'number' && Object.is(item, -0) ? '-0' : item);
}

/** 경로와 도형의 순서 및 회피 방식만으로 원본 윤곽 키를 만든다. */
function geometryKey(artwork: SvgArtwork): string {
  return serializeKey([artwork.avoidance, artwork.parts.map(part => part.paths.map(path => path.map(point => [point.x, point.y])))]);
}

/** 실제 배치·회전·색상·간략화 방식을 구분해 오래된 계산 경계의 재사용을 막는다. */
function placementKey(artwork: SvgArtwork, canvas: ResolvedCanvas): string {
  const placed = constrainArtwork(artwork, canvas);
  return serializeKey([canvas.width, canvas.height, placed.aspect, placed.x, placed.y, placed.widthRatio, placed.rotation ?? 0, placed.contourTolerance ?? 0, placed.contourMode ?? 'simplify', placed.hullMergeRatio ?? DEFAULT_HULL_MERGE_RATIO, placed.parts.map(part => part.color)]);
}

/** 별도 좌표를 가진 원본·배치·계산 윤곽을 모두 세어 보관 예산을 계산한다. */
function retainedSegments(originalContour: Polygon[], prepared: PreparedArtwork): number {
  let count = 0;
  for (const paths of new Set([originalContour, prepared.footprint, prepared.collision.paths])) {
    for (const path of paths) count += path.length;
  }
  return count;
}

/** 중첩 준비 자료를 동결해 공유한 윤곽과 가이드의 외부 변조를 막는다. */
function freezePrepared<T>(value: T, visited = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || visited.has(value)) return value;
  visited.add(value);
  for (const child of Object.values(value)) freezePrepared(child, visited);
  return Object.freeze(value);
}

/** 결과에서 편집할 도형만 복제하고 동결한 기하 준비 자료를 공유한다. */
function cloneResult(prepared: PreparedArtwork): PreparedArtwork {
  return { ...prepared, shapes: structuredClone(prepared.shapes) };
}

/** 캐시 보관 상한을 유한한 음이 아닌 정수로 검증한다. */
function cacheLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) throw new RangeError('SVG 준비 캐시 상한은 유한한 음이 아닌 수여야 합니다.');
  return Math.floor(value);
}

/** 최근 원본 윤곽 두 개와 각 윤곽의 최신 배치를 한정된 선분 수로 보관한다. */
export function createArtworkPreparationCache(options: ArtworkPreparationCacheOptions = {}): ArtworkPreparationCache {
  const maxArtworks = cacheLimit(options.maxArtworks, 2), maxSegments = cacheLimit(options.maxSegments, 80000);
  const entries = new Map<string, ArtworkCacheEntry>();
  let segmentCount = 0, retainedSegmentCount = 0;
  let counters = { hits: 0, misses: 0, contourHits: 0, contourMisses: 0, collisionPreparations: 0, contourPreparations: 0, evictions: 0 };

  /** 가장 오래 사용하지 않은 원본과 배치 자료를 함께 제거한다. */
  function evictOldest(): void {
    const oldest = entries.keys().next();
    if (oldest.done) return;
    const entry = entries.get(oldest.value)!;
    segmentCount -= entry.prepared.collision.segmentCount;
    retainedSegmentCount -= entry.retainedSegments;
    entries.delete(oldest.value);
    counters.evictions++;
  }

  return {
    /** 같은 그림의 여러 삽입 위치를 구분하고 회전·간략화 계산 자료를 재사용한다. */
    prepare(artwork, canvas, instanceKey) {
      const sourceKey = serializeKey([instanceKey ?? null, geometryKey(artwork)]), placedKey = placementKey(artwork, canvas);
      const retained = entries.get(sourceKey);
      if (retained) {
        counters.contourHits++;
        entries.delete(sourceKey);
        entries.set(sourceKey, retained);
        if (retained.placementKey === placedKey) {
          counters.hits++;
          return cloneResult(retained.prepared);
        }
      } else counters.contourMisses++;
      counters.misses++;

      const originalContour = retained?.originalContour ?? freezePrepared(artworkContour(artwork));
      const placed = placeArtwork(artwork, canvas, originalContour);
      const constrained = constrainArtwork(artwork, canvas);
      const tolerance = constrained.widthRatio * canvas.width * (artwork.contourTolerance ?? 0);
      const grouped = artwork.avoidance !== 'bounds' && artwork.contourMode === 'grouped-hull'
        ? groupedHullContour(placed.footprint, constrained.widthRatio * canvas.width * (artwork.hullMergeRatio ?? DEFAULT_HULL_MERGE_RATIO))
        : null;
      const originalSegments = artwork.avoidance === 'bounds' ? placed.footprint.reduce((count, path) => count + path.length, 0) : 0;
      const simplified = artwork.avoidance === 'bounds'
        ? { paths: placed.footprint, originalSegments, simplifiedSegments: originalSegments, applied: false, tolerance: 0 }
        : grouped ? { ...grouped, tolerance: 0 } : simplifyCollisionContour(placed.footprint, tolerance);
      const collision = prepareCollision(simplified.paths);
      counters.collisionPreparations++;
      const contour = artwork.avoidance === 'silhouette' ? createContourGuide(collision.paths, collision) : null;
      if (contour) counters.contourPreparations++;
      const simplification: ArtworkContourSimplification = { originalSegments: simplified.originalSegments, simplifiedSegments: simplified.simplifiedSegments, applied: simplified.applied, tolerance: simplified.tolerance, ...(grouped ? { method: 'grouped-hull', groups: grouped.groups, mergeDistance: grouped.mergeDistance } as const : {}) };
      const prepared = freezePrepared({ ...placed, collision, contour, simplification });
      const retainedCount = retainedSegments(originalContour, prepared);

      if (retained) {
        segmentCount -= retained.prepared.collision.segmentCount;
        retainedSegmentCount -= retained.retainedSegments;
        entries.delete(sourceKey);
      }
      if (maxArtworks > 0 && retainedCount <= maxSegments) {
        entries.set(sourceKey, { originalContour, placementKey: placedKey, prepared, retainedSegments: retainedCount });
        segmentCount += collision.segmentCount;
        retainedSegmentCount += retainedCount;
        while (entries.size > maxArtworks || retainedSegmentCount > maxSegments) evictOldest();
      }
      return cloneResult(prepared);
    },
    /** 보관 자료와 카운터를 초기화해 다음 요청을 완전히 새로 준비한다. */
    clear() {
      entries.clear();
      segmentCount = 0;
      retainedSegmentCount = 0;
      counters = { hits: 0, misses: 0, contourHits: 0, contourMisses: 0, collisionPreparations: 0, contourPreparations: 0, evictions: 0 };
    },
    /** 내부 상태를 변경할 수 없는 독립적인 통계 객체를 반환한다. */
    getStats() {
      return { ...counters, artworkCount: entries.size, placementCount: entries.size, segmentCount, retainedSegmentCount };
    },
  };
}

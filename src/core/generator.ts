import RBush from 'rbush';
import { constrainArtwork, placeArtwork } from './artwork';
import { boundsOf, intersectPaths, normalizePaths, pathsArea, pathsConflict, rectangle } from './geometry';
import { createMarker } from './markers';
import { createRandom } from './random';
import { GENERATOR_VERSION, resolveCanvas, validateSettings } from './settings';
import { createShape } from './shapes';
import { createSheetRegions } from './sheets';
import { createContourGuide, placeNearContour } from './contourPlacement';
import type { ContourGuide } from './contourPlacement';
import type { Bounds, GenerationProgress, PatternResult, PatternSettings, PatternShape, Polygon } from './types';

interface SpatialEntry extends Bounds { paths: Polygon[] }

/** 공간 색인으로 후보를 추린 뒤 실제 벡터 간격을 검사한다. */
function canPlace(index: RBush<SpatialEntry>, paths: Polygon[], bounds: Bounds, gap: number): boolean {
  const candidates = index.search({ minX: bounds.minX - gap, minY: bounds.minY - gap, maxX: bounds.maxX + gap, maxY: bounds.maxY + gap });
  return candidates.every(candidate => !pathsConflict(paths, candidate.paths, gap));
}

/** 삽입 SVG와 마커를 먼저 보호하고 나머지 공간에 크기순으로 도형을 배치한다. */
export async function generatePattern(settings: PatternSettings, onProgress?: (progress: GenerationProgress) => void): Promise<PatternResult> {
  const errors = validateSettings(settings);
  if (errors.length) throw new Error(errors.join('\n'));
  const started = performance.now(), canvas = resolveCanvas(settings), random = createRandom(settings.seed);
  settings = structuredClone(settings);
  if (settings.artwork) settings.artwork = constrainArtwork(settings.artwork, canvas);
  const index = new RBush<SpatialEntry>(), shapes: PatternShape[] = [], warnings: string[] = [];
  const canvasPath = rectangle(0, 0, canvas.width, canvas.height), canvasArea = canvas.width * canvas.height;
  const targetArea = canvasArea * (1 - settings.whiteRatio);
  let inkArea = 0, attempts = 0;
  let contour: ContourGuide | null = null;
  /** 검증된 도형을 공간 색인과 실제 잉크 합계에 반영한다. */
  const add = (shape: PatternShape): void => {
    shape.paths = normalizePaths(shape.paths, shape.fillRule);
    shape.fillRule = 'nonzero';
    shape.area = pathsArea(shape.paths);
    shapes.push(shape); inkArea += shape.area;
    const collision = shape.footprint ?? shape.paths;
    index.insert({ ...boundsOf(collision), paths: collision });
  };
  /** 진행률을 알리고 이벤트 루프에 제어권을 넘긴다. */
  const report = async (phase: string, progress: number): Promise<void> => {
    onProgress?.({ phase, progress, placed: shapes.length, whiteRatio: 1 - inkArea / canvasArea });
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  };
  if (settings.artwork) {
    const artwork = placeArtwork(settings.artwork, canvas);
    shapes.push(...artwork.shapes);
    inkArea = artwork.inkArea;
    index.insert({ ...boundsOf(artwork.footprint), paths: artwork.footprint });
    if (settings.artwork.avoidance === 'silhouette') contour = createContourGuide(artwork.footprint);
    await report('삽입 SVG 보호 영역 확보', 0.01);
  }
  if (settings.markers.enabled) {
    const regions = createSheetRegions(canvas, settings);
    const cell = settings.markers.side / (Number(settings.markers.dictionary[0]) + 2);
    const unrotatedHalf = settings.markers.side / 2 + settings.markers.quietZoneCells * cell;
    for (let markerIndex = 0; markerIndex < settings.markers.count; markerIndex++) {
      let placed = false;
      for (let trial = 0; trial < 2000; trial++) {
        attempts++;
        const region = regions[(markerIndex + Math.floor(trial / 100)) % regions.length];
        const rotation = settings.markers.rotate ? random() * 360 : 0;
        const angle = rotation * Math.PI / 180;
        const half = unrotatedHalf * (Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle)));
        const left = region.trimX + settings.margin + half + (settings.sheets.enabled && region.index > 0 ? settings.sheets.bleed : 0);
        const right = region.trimX + region.trimWidth - settings.margin - half - (settings.sheets.enabled && region.index < regions.length - 1 ? settings.sheets.overlap + settings.sheets.bleed : 0);
        const top = settings.margin + half, bottom = canvas.height - settings.margin - half;
        if (right < left || bottom < top) continue;
        const marker = createMarker(settings.markers, settings.markers.startId + markerIndex, left + random() * (right - left), top + random() * (bottom - top), rotation, region.index);
        if (canPlace(index, marker.footprint!, marker.bounds, settings.gap)) { add(marker); placed = true; break; }
      }
      if (!placed) throw new Error(`마커 ${settings.markers.count}개 중 ${markerIndex + 1}번째를 배치할 수 없습니다. 마커 크기·보호 영역·간격·시트 폭을 확인해 주세요.`);
      if (markerIndex % 10 === 0) await report('마커 보호 영역 배치', 0.05 * (markerIndex + 1) / settings.markers.count);
    }
  }
  if (inkArea > targetArea) warnings.push('고정 SVG와 마커의 잉크 면적만으로 목표 잉크 비율을 초과했습니다.');
  const estimatedCount = targetArea / Math.max(settings.minSize ** 2 * 0.3, 1e-12);
  const budget = Math.min(180000, Math.max(3000, Math.ceil(estimatedCount * 35)));
  const phases = [{ low: 0.62, high: 1, share: 0.25, name: '큰 도형 배치' }, { low: 0.22, high: 0.62, share: 0.3, name: '중간 도형 배치' }, { low: 0, high: 0.22, share: 0.45, name: '작은 도형 배치' }];
  let work = 0;
  for (const phase of phases) {
    let consecutiveFailures = 0;
    const phaseBudget = Math.ceil(budget * phase.share);
    for (let trial = 0; trial < phaseBudget && inkArea < targetArea - canvasArea * 0.002 && shapes.length < 10000; trial++) {
      attempts++; work++;
      const factor = phase.low + random() * (phase.high - phase.low);
      const size = settings.minSize + (settings.maxSize - settings.minSize) * factor;
      let shape = createShape(settings, random, size, random() * canvas.width, random() * canvas.height, shapes.length);
      // 후보의 일부를 윤곽 근처로 옮기고 나머지는 전체 공간에 분산한다.
      if (contour && trial % 3 === 0) shape = placeNearContour(shape, contour, random(), settings.gap) ?? shape;
      let bounds = shape.bounds;
      const outside = bounds.minX < settings.margin || bounds.minY < settings.margin || bounds.maxX > canvas.width - settings.margin || bounds.maxY > canvas.height - settings.margin;
      if (outside && (!settings.edgeCrop || settings.margin > 0)) { consecutiveFailures++; }
      else {
        if (outside) {
          // 시트 도련에는 재단 전 잉크를 보존하고 충돌과 밀도는 재단 안쪽만 계산한다.
          shape.bleedPaths = structuredClone(shape.paths);
          shape.paths = intersectPaths(shape.paths, canvasPath);
          shape.area = pathsArea(shape.paths); bounds = boundsOf(shape.paths); shape.bounds = bounds;
        }
        if (shape.area > size * size * 0.015 && inkArea + shape.area <= targetArea + canvasArea * 0.002 && canPlace(index, shape.paths, bounds, settings.gap)) { add(shape); consecutiveFailures = 0; }
        else consecutiveFailures++;
      }
      if (work % 100 === 0) await report(phase.name, Math.min(0.99, 0.05 + work / budget * 0.94));
      if (consecutiveFailures >= Math.max(1000, Math.min(5000, estimatedCount))) break;
    }
  }
  const whiteRatio = 1 - inkArea / canvasArea;
  const targetReached = Math.abs(whiteRatio - settings.whiteRatio) <= 0.005;
  if (!targetReached) warnings.push(`최소 간격과 크기 조건에서 목표 여백 ${(settings.whiteRatio * 100).toFixed(1)}%에 도달하지 못했습니다. 실제 여백은 ${(whiteRatio * 100).toFixed(1)}%입니다.`);
  if (shapes.length >= 10000) warnings.push('도형 10,000개 제한에 도달했습니다.');
  await report('생성 완료', 1);
  return { version: GENERATOR_VERSION, settings: structuredClone(settings), canvas, shapes, whiteRatio, targetReached, attempts, warnings, elapsedMs: performance.now() - started };
}

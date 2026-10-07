import RBush from 'rbush';
import { artworkInkArea, constrainArtwork, getArtworks, placeArtwork, withArtworks } from './artwork';
import { boundsOf, intersectPaths, normalizePaths, pathsArea, pathsConflict, pathsConflictPrepared, rectangle, subtractPaths } from './geometry';
import { prepareFillMask } from './fillMask';
import type { PreparedCollision } from './geometry';
import { createArtworkPreparationCache } from './preparedArtwork';
import type { ArtworkPreparationCache } from './preparedArtwork';
import { createMarker } from './markers';
import { createRandom } from './random';
import { GENERATOR_VERSION, resolveCanvas, validateSettings } from './settings';
import { createShape } from './shapes';
import { createSheetRegions } from './sheets';
import { createContourGuide, placeNearContour } from './contourPlacement';
import type { ContourGuide } from './contourPlacement';
import type { Bounds, GenerationProgress, PatternResult, PatternSettings, PatternShape, Polygon } from './types';

interface SpatialEntry extends Bounds { paths: Polygon[]; collision?: PreparedCollision }

export interface GenerationContext {
  artworkCache?: ArtworkPreparationCache;
  usePreparedCollision?: boolean;
}

/** 공간 색인으로 후보를 추린 뒤 실제 벡터 간격을 검사한다. */
function canPlace(index: RBush<SpatialEntry>, paths: Polygon[], bounds: Bounds, gap: number): boolean {
  const candidates = index.search({ minX: bounds.minX - gap, minY: bounds.minY - gap, maxX: bounds.maxX + gap, maxY: bounds.maxY + gap });
  return candidates.every(candidate => !(candidate.collision
    ? pathsConflictPrepared(paths, candidate.collision, gap)
    : pathsConflict(paths, candidate.paths, gap)));
}

/** 모든 SVG를 피하고 흰색 채움 영역의 경계로 도형을 자르며 마커의 온전한 형태를 보존한다. */
export async function generatePattern(settings: PatternSettings, onProgress?: (progress: GenerationProgress) => void, context?: GenerationContext): Promise<PatternResult> {
  const errors = validateSettings(settings);
  if (errors.length) throw new Error(errors.join('\n'));
  const started = performance.now(), canvas = resolveCanvas(settings), random = createRandom(settings.seed);
  settings = structuredClone(settings);
  if (settings.artworks) settings = withArtworks(settings, settings.artworks.map(artwork => constrainArtwork(artwork, canvas)));
  else if (settings.artwork) settings.artwork = constrainArtwork(settings.artwork, canvas);
  const artworks = getArtworks(settings);
  const artworkCache = context?.artworkCache ?? createArtworkPreparationCache({ maxArtworks: Math.max(2, artworks.length) });
  const index = new RBush<SpatialEntry>(), shapes: PatternShape[] = [], warnings: string[] = [];
  const canvasPath = rectangle(0, 0, canvas.width, canvas.height);
  const mask = settings.fillMask ? prepareFillMask(settings.fillMask, canvas) : null;
  const fillArea = mask?.area ?? canvas.width * canvas.height;
  const targetArea = fillArea * (1 - settings.whiteRatio);
  let inkArea = 0, attempts = 0;
  const contours: ContourGuide[] = [];
  let overlappingArtworks = false;
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
    onProgress?.({ phase, progress, placed: shapes.length, whiteRatio: 1 - inkArea / fillArea });
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  };
  for (const [artworkIndex, source] of artworks.entries()) {
    // 기준 판정과 비교할 때만 준비 색인을 생략하며 실제 생성에서는 같은 자료를 공유한다.
    const prepared = context?.usePreparedCollision === false && !context.artworkCache
      ? null
      : artworkCache.prepare(source, canvas, artworks.length > 1 ? String(artworkIndex) : undefined);
    const artwork = prepared ?? placeArtwork(source, canvas);
    if (artworks.length > 1) artwork.shapes.forEach((shape, partIndex) => { shape.id = `imported-artwork-${artworkIndex}-${partIndex}`; });
    shapes.push(...artwork.shapes);
    inkArea += mask ? artworkInkArea(artwork.shapes, mask.paths) : artwork.inkArea;
    const collision = context?.usePreparedCollision === false ? undefined : prepared?.collision;
    const collisionPaths = collision?.paths ?? artwork.footprint;
    if (index.search(boundsOf(artwork.footprint)).length) overlappingArtworks = true;
    index.insert({ ...boundsOf(collisionPaths), paths: collisionPaths, collision });
    if (source.avoidance === 'silhouette') contours.push(prepared?.contour && collision
      ? prepared.contour
      : createContourGuide(artwork.footprint, collision));
    await report(`삽입 SVG 보호 영역 확보 · ${artworkIndex + 1}/${artworks.length}`, 0.01);
  }
  // 떨어진 그림은 캐시의 면적을 재사용하고 겹침 가능성이 있을 때만 흰 덧칠까지 다시 합성한다.
  if (overlappingArtworks) inkArea = artworkInkArea(shapes, mask?.paths);
  const contourLength = contours.reduce((length, contour) => length + contour.length, 0);
  /** 전체 윤곽 길이에 비례해 SVG를 고르고 한 개일 때는 기존 난수 사용을 유지한다. */
  function nearArtwork(shape: PatternShape, sample: number): PatternShape {
    if (contours.length === 1) return placeNearContour(shape, contours[0], sample, settings.gap) ?? shape;
    let remaining = sample * contourLength;
    for (const contour of contours) {
      if (contour.length > 0 && remaining < contour.length) return placeNearContour(shape, contour, remaining / contour.length, settings.gap) ?? shape;
      remaining -= contour.length;
    }
    return shape;
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
        const left = Math.max(region.trimX + settings.margin + half + (settings.sheets.enabled && region.index > 0 ? settings.sheets.bleed : 0), mask ? mask.bounds.minX + half : 0);
        const right = Math.min(region.trimX + region.trimWidth - settings.margin - half - (settings.sheets.enabled && region.index < regions.length - 1 ? settings.sheets.overlap + settings.sheets.bleed : 0), mask ? mask.bounds.maxX - half : canvas.width);
        const top = Math.max(settings.margin + half, mask ? mask.bounds.minY + half : 0), bottom = Math.min(canvas.height - settings.margin - half, mask ? mask.bounds.maxY - half : canvas.height);
        if (right < left || bottom < top) continue;
        const marker = createMarker(settings.markers, settings.markers.startId + markerIndex, left + random() * (right - left), top + random() * (bottom - top), rotation, region.index);
        // 인식 코드와 보호 여백은 자르지 않고 흰 영역에 전부 들어갈 때만 배치한다.
        const withinMask = !mask || pathsArea(subtractPaths(marker.footprint!, mask.paths)) <= 1e-12;
        if (withinMask && canPlace(index, marker.footprint!, marker.bounds, settings.gap)) { add(marker); placed = true; break; }
      }
      if (!placed) throw new Error(`마커 ${settings.markers.count}개 중 ${markerIndex + 1}번째를 배치할 수 없습니다. ${mask ? '흰색 채움 영역과 ' : ''}마커 크기·보호 영역·간격·시트 폭을 확인해 주세요.`);
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
    for (let trial = 0; trial < phaseBudget && inkArea < targetArea - fillArea * 0.002 && shapes.length < 10000; trial++) {
      attempts++; work++;
      const factor = phase.low + random() * (phase.high - phase.low);
      const size = settings.minSize + (settings.maxSize - settings.minSize) * factor;
      const sampleX = random(), sampleY = random();
      const centerX = mask ? mask.bounds.minX + sampleX * (mask.bounds.maxX - mask.bounds.minX) : sampleX * canvas.width;
      const centerY = mask ? mask.bounds.minY + sampleY * (mask.bounds.maxY - mask.bounds.minY) : sampleY * canvas.height;
      let shape = createShape(settings, random, size, centerX, centerY, shapes.length);
      // 후보의 일부를 윤곽 근처로 옮기고 나머지는 전체 공간에 분산한다.
      if (contours.length && trial % 3 === 0) shape = nearArtwork(shape, random());
      let bounds = shape.bounds;
      const outside = bounds.minX < settings.margin || bounds.minY < settings.margin || bounds.maxX > canvas.width - settings.margin || bounds.maxY > canvas.height - settings.margin;
      if (outside && ((!settings.edgeCrop && !mask) || settings.margin > 0)) { consecutiveFailures++; }
      else {
        if (mask) {
          // 마스크를 벗어난 원본은 도련에도 복원하지 않고 잘린 벡터 자체를 저장한다.
          shape.paths = mask.clip(shape.paths);
          shape.area = pathsArea(shape.paths); bounds = boundsOf(shape.paths); shape.bounds = bounds;
        } else if (outside) {
          // 시트 도련에는 재단 전 잉크를 보존하고 충돌과 밀도는 재단 안쪽만 계산한다.
          shape.bleedPaths = structuredClone(shape.paths);
          shape.paths = intersectPaths(shape.paths, canvasPath);
          shape.area = pathsArea(shape.paths); bounds = boundsOf(shape.paths); shape.bounds = bounds;
        }
        if (shape.area > size * size * 0.015 && inkArea + shape.area <= targetArea + fillArea * 0.002 && canPlace(index, shape.paths, bounds, settings.gap)) { add(shape); consecutiveFailures = 0; }
        else consecutiveFailures++;
      }
      if (work % 100 === 0) await report(phase.name, Math.min(0.99, 0.05 + work / budget * 0.94));
      if (consecutiveFailures >= Math.max(1000, Math.min(5000, estimatedCount))) break;
    }
  }
  const whiteRatio = 1 - inkArea / fillArea;
  const targetReached = Math.abs(whiteRatio - settings.whiteRatio) <= 0.005;
  if (!targetReached) warnings.push(`최소 간격과 크기 조건에서 목표 여백 ${(settings.whiteRatio * 100).toFixed(1)}%에 도달하지 못했습니다. 실제 여백은 ${(whiteRatio * 100).toFixed(1)}%입니다.`);
  if (shapes.length >= 10000) warnings.push('도형 10,000개 제한에 도달했습니다.');
  await report('생성 완료', 1);
  return { version: GENERATOR_VERSION, settings: structuredClone(settings), canvas, shapes, whiteRatio, targetReached, attempts, warnings, elapsedMs: performance.now() - started };
}

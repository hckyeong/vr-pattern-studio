import { describe, expect, it } from 'vitest';
import { artworkContour, constrainArtwork, placeArtwork } from '../src/core/artwork';
import { pathsArea, rectangle, subtractPaths } from '../src/core/geometry';
import { createArtworkPreparationCache } from '../src/core/preparedArtwork';
import type { ArtworkPreparationCacheStats, PreparedArtwork } from '../src/core/preparedArtwork';
import type { ResolvedCanvas, SvgArtwork } from '../src/core/types';

const canvas: ResolvedCanvas = { width: 947.1234567, height: 711.8765432, physicalWidthMm: 947.1234567, physicalHeightMm: 711.8765432, lengthUnit: 'mm' };

/** 오목한 외곽과 구멍, 떨어진 조각, 흰 덧칠이 있는 검증 원고를 만든다. */
function artwork(): SvgArtwork {
  return {
    name: '같은 이름.svg', aspect: .8, x: .563849, y: .478261, widthRatio: .417823, avoidance: 'silhouette',
    parts: [
      { color: '#123456', paths: [[{ x: 0, y: 0 }, { x: .38000007, y: 0 }, { x: .38000007, y: .55 }, { x: .7, y: .55 }, { x: .7, y: .8 }, { x: 0, y: .8 }]] },
      { color: '#456789', paths: [...rectangle(.76, .05, .2, .5), rectangle(.8, .1, .12, .3)[0].reverse()] },
      { color: '#FFFFFF', paths: rectangle(.06, .12, .22000003, .26000007) },
    ],
  };
}

/** 캐시의 기하 결과를 기존 배치 함수와 숫자 하나까지 일치시켜 검사한다. */
function expectOriginal(prepared: PreparedArtwork, source: SvgArtwork, targetCanvas = canvas): void {
  expect({ shapes: prepared.shapes, footprint: prepared.footprint, inkArea: prepared.inkArea }).toEqual(placeArtwork(source, targetCanvas));
  if (!prepared.simplification.applied) expect(prepared.collision.paths).toEqual(prepared.footprint);
  expect(prepared.contour?.collision).toBe(source.avoidance === 'silhouette' ? prepared.collision : undefined);
}

/** 곡선을 촘촘한 점으로 근사한 경로와 내부 흰 덧칠을 가진 검증 원고를 만든다. */
function curvedArtwork(): SvgArtwork {
  const path = Array.from({ length: 256 }, (_item, index) => {
    const angle = index * Math.PI * 2 / 256;
    return { x: .5 + Math.cos(angle) * .45, y: .5 + Math.sin(angle) * .45 };
  });
  return { ...artwork(), aspect: 1, contourTolerance: .005, parts: [{ color: '#123456', paths: [path] }, { color: '#FFFFFF', paths: rectangle(.3, .3, .4, .4) }] };
}

/** 지정하지 않은 누적 카운터와 보관 상태를 영으로 채워 비교한다. */
function stats(values: Partial<ArtworkPreparationCacheStats>): ArtworkPreparationCacheStats {
  return { hits: 0, misses: 0, contourHits: 0, contourMisses: 0, collisionPreparations: 0, contourPreparations: 0, evictions: 0, artworkCount: 0, placementCount: 0, segmentCount: 0, retainedSegmentCount: 0, ...values };
}

describe('SVG 전처리 캐시의 내용 키와 기하 호환성', () => {
  // 처음 준비한 결과와 내용이 같은 별도 객체 모두 기존 수치 결과를 유지한다.
  it('동일한 좌표 값의 복제 입력은 배치와 충돌 색인을 재사용한다', () => {
    const cache = createArtworkPreparationCache(), source = artwork();
    const first = cache.prepare(source, canvas), second = cache.prepare(structuredClone(source), structuredClone(canvas));
    expectOriginal(first, source); expectOriginal(second, source);
    expect(second.collision).toBe(first.collision);
    expect(second.contour).toBe(first.contour);
    expect(second.shapes).not.toBe(first.shapes);
    expect(cache.getStats()).toEqual(stats({ hits: 1, misses: 1, contourHits: 1, contourMisses: 1, collisionPreparations: 1, contourPreparations: 1, artworkCount: 1, placementCount: 1, segmentCount: first.collision.segmentCount, retainedSegmentCount: first.collision.segmentCount * 3 }));
  });

  // 파일 이름과 물리 단위 표시만 달라진 입력은 실제 좌표가 같다.
  it('파일명과 실제 캔버스 크기에 영향을 주지 않는 메타데이터는 키에서 제외한다', () => {
    const cache = createArtworkPreparationCache(), source = artwork();
    const first = cache.prepare(source, canvas);
    const second = cache.prepare({ ...source, name: '다른 이름.svg' }, { ...canvas, physicalWidthMm: null, physicalHeightMm: null, lengthUnit: 'px' });
    expect(second.collision).toBe(first.collision);
    expect(cache.getStats().hits).toBe(1);
  });

  // 소수 여섯 자리의 윤곽 결과가 같아도 입력의 실제 좌표 변경은 구분한다.
  it('동명 SVG의 다른 경로와 반올림 전의 미세 좌표 변경을 구분한다', () => {
    const cache = createArtworkPreparationCache(), source = artwork();
    const first = cache.prepare(source, canvas);
    const changed = structuredClone(source); changed.parts[0].paths[0][1].x += 0.00000001;
    expect(artworkContour(changed)).toEqual(artworkContour(source));
    const second = cache.prepare(changed, canvas);
    expectOriginal(second, changed);
    expect(second.shapes).not.toEqual(first.shapes);
    expect(cache.getStats()).toMatchObject({ hits: 0, misses: 2, contourHits: 0, contourMisses: 2, artworkCount: 2 });
  });

  // 도형 색상은 원본 윤곽과 무관하지만 흰 덧칠과 반환 색상을 바꾼다.
  it('색상 변경은 원본 윤곽을 재사용하고 잉크 면적과 배치를 다시 준비한다', () => {
    const cache = createArtworkPreparationCache(), source = artwork();
    const first = cache.prepare(source, canvas);
    const changed = structuredClone(source); changed.parts[2].color = '#fedcba';
    const second = cache.prepare(changed, canvas);
    expectOriginal(second, changed);
    expect(second.inkArea).toBeGreaterThan(first.inkArea);
    expect(second.collision).not.toBe(first.collision);
    expect(cache.getStats()).toMatchObject({ hits: 0, misses: 2, contourHits: 1, contourMisses: 1, artworkCount: 1, placementCount: 1 });
    changed.parts[2].color = '#ffffff';
    expectOriginal(cache.prepare(changed, canvas), changed);
    expect(cache.getStats().misses).toBe(3);
  });

  // 흰색이 검은 면보다 먼저 놓이면 이후 검은 면의 잉크가 다시 칠해진다.
  it('도형 경로와 색상의 순서는 내용 키와 덧칠 순서에 그대로 반영한다', () => {
    const cache = createArtworkPreparationCache(), source = artwork();
    const first = cache.prepare(source, canvas);
    const reordered = structuredClone(source); reordered.parts.unshift(reordered.parts.pop()!);
    const second = cache.prepare(reordered, canvas);
    expectOriginal(second, reordered);
    expect(second.inkArea).toBeGreaterThan(first.inkArea);
    expect(cache.getStats()).toMatchObject({ contourHits: 0, contourMisses: 2 });
    const swappedColors = structuredClone(source);
    [swappedColors.parts[0].color, swappedColors.parts[2].color] = [swappedColors.parts[2].color, swappedColors.parts[0].color];
    expectOriginal(cache.prepare(swappedColors, canvas), swappedColors);
    expect(cache.getStats()).toMatchObject({ contourHits: 1, contourMisses: 2, misses: 3 });
  });

  // 세 회피 모드는 동일 SVG에서도 각기 다른 보호 윤곽을 사용한다.
  it('최외곽과 기존 윤곽 및 사각 경계 모드의 결과를 보존한다', () => {
    const cache = createArtworkPreparationCache({ maxArtworks: 3 }), source = artwork();
    const footprints = [];
    for (const avoidance of ['silhouette', 'outline', 'bounds'] as const) {
      const changed = { ...source, avoidance }, prepared = cache.prepare(changed, canvas);
      expectOriginal(prepared, changed);
      expect(prepared.contour === null).toBe(avoidance !== 'silhouette');
      footprints.push(prepared.footprint);
    }
    expect(footprints[0]).not.toEqual(footprints[1]); expect(footprints[0]).not.toEqual(footprints[2]);
    expect(cache.getStats()).toMatchObject({ contourMisses: 3, artworkCount: 3, contourPreparations: 1 });
  });

  // 이동과 크기 변경은 원본 윤곽을 재사용하지만 세계 좌표 자료를 다시 만든다.
  it('위치와 크기 및 실제 캔버스 크기와 비율을 배치 키에 포함한다', () => {
    const cache = createArtworkPreparationCache(), source = artwork();
    cache.prepare(source, canvas);
    const inputs = [
      { source: { ...source, x: .61 }, canvas },
      { source: { ...source, y: .62 }, canvas },
      { source: { ...source, widthRatio: .32 }, canvas },
      { source: { ...source, aspect: .9 }, canvas },
      { source, canvas: { ...canvas, width: canvas.width + .00000001 } },
      { source, canvas: { ...canvas, height: 251.7654321 } },
    ];
    for (const input of inputs) expectOriginal(cache.prepare(input.source, input.canvas), input.source, input.canvas);
    expect(cache.getStats()).toMatchObject({ misses: 7, contourHits: 6, contourMisses: 1, placementCount: 1, collisionPreparations: 7 });
  });

  // 경계 밖의 두 요청이 실제로 같은 제한 배치를 만들면 재사용할 수 있다.
  it('제한된 위치와 크기가 같으면 원래 요청 값이 달라도 재사용한다', () => {
    const cache = createArtworkPreparationCache(), source = { ...artwork(), x: -1, y: 3, widthRatio: 2 };
    const first = cache.prepare(source, canvas), changed = { ...source, x: -2, y: 4, widthRatio: 3 };
    const second = cache.prepare(changed, canvas);
    expectOriginal(second, changed);
    expect(second.collision).toBe(first.collision);
    expect(cache.getStats().hits).toBe(1);
  });

  // 입력 객체를 제자리 수정해도 객체 식별값 대신 실제 경로 내용을 다시 검사한다.
  it('원본 입력 객체의 경로와 색상 변조를 다음 요청에 반영한다', () => {
    const cache = createArtworkPreparationCache(), source = artwork();
    const first = cache.prepare(source, canvas);
    source.parts[0].paths[0][1].x = .34;
    const second = cache.prepare(source, canvas);
    expectOriginal(second, source); expect(second.shapes).not.toEqual(first.shapes);
    source.parts[0].color = '#abcdef';
    expectOriginal(cache.prepare(source, canvas), source);
    expect(cache.getStats()).toMatchObject({ misses: 3, contourHits: 1, contourMisses: 2 });
  });

  // 캔버스 좌표의 소수 여섯 자리 정규화는 정규화 면적의 배율 제곱과 다르다.
  it('흰 덧칠 면적을 원본 면적의 배율 제곱으로 바꾸지 않는다', () => {
    const cache = createArtworkPreparationCache(), source = artwork();
    const actual = cache.prepare(source, canvas), width = source.widthRatio * canvas.width;
    const unitCanvas = { ...canvas, width: 1, height: 1 };
    const normalized = placeArtwork({ ...source, widthRatio: 1, x: .5, y: .4 }, unitCanvas).inkArea * width ** 2;
    expectOriginal(actual, source);
    expect(actual.inkArea).not.toBe(normalized);
    expect(pathsArea(actual.footprint)).toBeGreaterThan(actual.inkArea);
  });
});

describe('SVG 전처리 캐시의 변조 방지와 보관 상한', () => {
  // 사용자가 결과 도형을 재색칠하거나 좌표를 편집해도 다음 캐시 히트를 오염시키지 않는다.
  it('반환 도형의 색과 경로 및 경계는 캐시와 다른 결과에서 분리한다', () => {
    const cache = createArtworkPreparationCache(), source = artwork();
    const first = cache.prepare(source, canvas), second = cache.prepare(source, canvas);
    first.shapes[0].color = '#ffffff'; first.shapes[0].paths[0][0].x = -100; first.shapes[0].bounds.minX = -100;
    first.shapes.push(structuredClone(first.shapes[0]));
    expectOriginal(second, source); expectOriginal(cache.prepare(source, canvas), source);
    expect(cache.getStats().hits).toBe(2);
  });

  // 동결한 공유 윤곽과 가이드 및 충돌 자료를 통해 내부 자료를 변경할 수 없다.
  it('공유 준비 자료의 중첩 좌표와 가이드를 읽기 전용으로 보호한다', () => {
    const cache = createArtworkPreparationCache(), source = artwork(), prepared = cache.prepare(source, canvas);
    expect(Object.isFrozen(prepared.footprint)).toBe(true);
    expect(Object.isFrozen(prepared.footprint[0][0])).toBe(true);
    expect(Object.isFrozen(prepared.collision)).toBe(true);
    expect(Object.isFrozen(prepared.collision.paths[0][0])).toBe(true);
    expect(Object.isFrozen(prepared.contour)).toBe(true);
    expect(Object.isFrozen(prepared.contour!.edges[0])).toBe(true);
    expect(() => { prepared.footprint[0][0].x = -100; }).toThrow(TypeError);
    expect(() => { prepared.contour!.edges[0].length = 0; }).toThrow(TypeError);
    prepared.footprint = [];
    expectOriginal(cache.prepare(source, canvas), source);
  });

  // 최근에 다시 사용한 자료는 세 번째 원고가 들어올 때도 보관한다.
  it('기본 두 개 상한에서는 가장 오래 사용하지 않은 원고를 폐기한다', () => {
    const cache = createArtworkPreparationCache(), a = artwork(), b = artwork(), c = artwork();
    b.parts[0].paths[0][1].x = .31; c.parts[0].paths[0][1].x = .32;
    const first = cache.prepare(a, canvas); cache.prepare(b, canvas); cache.prepare(a, canvas); cache.prepare(c, canvas);
    expect(cache.getStats()).toMatchObject({ hits: 1, misses: 3, evictions: 1, artworkCount: 2 });
    expect(cache.prepare(a, canvas).collision).toBe(first.collision);
    cache.prepare(b, canvas);
    expect(cache.getStats()).toMatchObject({ hits: 2, misses: 4, contourMisses: 4, evictions: 2, artworkCount: 2 });
  });

  // 한 원고의 이동 배치가 반복돼도 최신 배치 하나만 보관한다.
  it('이동이나 색상 변경의 배치 변형을 무한 축적하지 않는다', () => {
    const cache = createArtworkPreparationCache(), source = artwork();
    const first = cache.prepare(source, canvas);
    for (let index = 0; index < 20; index++) cache.prepare({ ...source, x: .3 + index / 100 }, canvas);
    expect(cache.getStats()).toMatchObject({ misses: 21, contourHits: 20, contourMisses: 1, artworkCount: 1, placementCount: 1, segmentCount: first.collision.segmentCount });
    const returned = cache.prepare(source, canvas);
    expectOriginal(returned, source); expect(returned.collision).not.toBe(first.collision);
    expect(cache.getStats().misses).toBe(22);
  });

  // 작은 선분 상한은 원고 개수 상한보다 먼저 오래된 색인을 폐기한다.
  it('전체 색인 선분 합계 상한을 넘으면 오래된 원고를 폐기한다', () => {
    const source = artwork(), probe = createArtworkPreparationCache(); probe.prepare(source, canvas);
    const count = probe.getStats().retainedSegmentCount;
    const cache = createArtworkPreparationCache({ maxArtworks: 3, maxSegments: count });
    cache.prepare(source, canvas);
    const changed = structuredClone(source); changed.parts[0].paths[0][1].x = .31;
    const second = cache.prepare(changed, canvas);
    expect(cache.getStats()).toMatchObject({ misses: 2, evictions: 1, artworkCount: 1, segmentCount: second.collision.segmentCount });
    expect(cache.getStats().retainedSegmentCount).toBeLessThanOrEqual(count);
    cache.prepare(source, canvas);
    expect(cache.getStats()).toMatchObject({ misses: 3, evictions: 2, artworkCount: 1 });
  });

  // 단일 요청이 상한보다 크면 정확한 결과만 반환하고 아무 준비 자료도 보관하지 않는다.
  it('단일 원고가 선분 상한을 초과하면 반환 후 보관하지 않는다', () => {
    const source = artwork(), probe = createArtworkPreparationCache(); probe.prepare(source, canvas);
    const count = probe.getStats().retainedSegmentCount;
    const cache = createArtworkPreparationCache({ maxSegments: count - 1 });
    const first = cache.prepare(source, canvas), second = cache.prepare(source, canvas);
    expectOriginal(first, source); expectOriginal(second, source);
    expect(second.collision).not.toBe(first.collision);
    expect(cache.getStats()).toEqual(stats({ misses: 2, contourMisses: 2, collisionPreparations: 2, contourPreparations: 2 }));
  });

  // 초과한 새 원고는 한도 안에 있던 다른 원고까지 불필요하게 폐기하지 않는다.
  it('단일 초과 원고를 보관하지 않으면서 이전에 보관한 원고를 유지한다', () => {
    const source = { ...artwork(), avoidance: 'bounds' as const }, cache = createArtworkPreparationCache({ maxSegments: 12 });
    const first = cache.prepare(source, canvas);
    expectOriginal(cache.prepare(artwork(), canvas), artwork());
    expect(cache.getStats()).toMatchObject({ artworkCount: 1, segmentCount: 4, retainedSegmentCount: 12, evictions: 0 });
    expect(cache.prepare(source, canvas).collision).toBe(first.collision);
  });

  // 보관 개수와 선분 상한은 검증에서 작게 지정하거나 영으로 비활성화할 수 있다.
  it('원고 개수 옵션과 영 상한 및 잘못된 상한을 처리한다', () => {
    const source = artwork(), cache = createArtworkPreparationCache({ maxArtworks: 1 });
    cache.prepare(source, canvas);
    const changed = structuredClone(source); changed.parts[0].paths[0][1].x = .31;
    cache.prepare(changed, canvas);
    expect(cache.getStats()).toMatchObject({ artworkCount: 1, evictions: 1 });
    for (const options of [{ maxArtworks: 0 }, { maxSegments: 0 }]) {
      const disabled = createArtworkPreparationCache(options);
      disabled.prepare(source, canvas); disabled.prepare(source, canvas);
      expect(disabled.getStats()).toMatchObject({ hits: 0, misses: 2, artworkCount: 0, segmentCount: 0 });
    }
    expect(() => createArtworkPreparationCache({ maxArtworks: -1 })).toThrow(RangeError);
    expect(() => createArtworkPreparationCache({ maxSegments: Infinity })).toThrow(RangeError);
  });

  // 통계의 복제 표본을 변경해도 카운터를 바꾸지 않으며 초기화는 자료와 카운터를 모두 비운다.
  it('통계는 독립적으로 반환하고 초기화 후 모든 자료를 다시 준비한다', () => {
    const source = artwork(), cache = createArtworkPreparationCache(), first = cache.prepare(source, canvas);
    cache.prepare(source, canvas);
    const snapshot = cache.getStats(); snapshot.hits = 100; snapshot.segmentCount = 0;
    expect(cache.getStats().hits).toBe(1); expect(cache.getStats().segmentCount).toBe(first.collision.segmentCount);
    cache.clear(); expect(cache.getStats()).toEqual(stats({}));
    const next = cache.prepare(source, canvas);
    expectOriginal(next, source); expect(next.collision).not.toBe(first.collision);
    expect(cache.getStats()).toMatchObject({ hits: 0, misses: 1, contourHits: 0, contourMisses: 1 });
  });
});

describe('SVG 충돌 윤곽 간략화 옵션의 캐시 연결', () => {
  // 미지정과 영 오차는 기존 기하 및 선분과 수치를 그대로 사용한다.
  it('간략화를 끈 원고는 기존 출력과 충돌 윤곽 및 면적을 유지한다', () => {
    const cache = createArtworkPreparationCache(), source = curvedArtwork();
    delete source.contourTolerance;
    const first = cache.prepare(source, canvas), second = cache.prepare({ ...source, contourTolerance: 0 }, canvas);
    expectOriginal(first, source); expectOriginal(second, source);
    expect(first.simplification).toEqual({ originalSegments: first.collision.segmentCount, simplifiedSegments: first.collision.segmentCount, applied: false, tolerance: 0 });
    expect(second.collision).toBe(first.collision);
    expect(first.contour!.paths).toBe(first.collision.paths);
    expect(cache.getStats()).toMatchObject({ hits: 1, misses: 1 });
  });

  // 실제 출력은 보존하고 보수적 계산 경계와 근접 배치 가이드만 함께 바꾼다.
  it('간략화한 충돌 윤곽은 원본 전체를 포함하고 선분 수를 줄인다', () => {
    const cache = createArtworkPreparationCache(), source = curvedArtwork();
    const prepared = cache.prepare(source, canvas), exact = placeArtwork(source, canvas);
    expectOriginal(prepared, source);
    expect(prepared.simplification.applied).toBe(true);
    expect(prepared.simplification.originalSegments).toBe(exact.footprint.flat().length);
    expect(prepared.simplification.simplifiedSegments).toBe(prepared.collision.segmentCount);
    expect(prepared.collision.segmentCount).toBeLessThan(prepared.simplification.originalSegments);
    expect(pathsArea(subtractPaths(exact.footprint, prepared.collision.paths))).toBe(0);
    expect(prepared.contour!.paths).toBe(prepared.collision.paths);
    expect(prepared.contour!.paths).not.toEqual(prepared.footprint);
    expect(prepared.contour!.collision).toBe(prepared.collision);
    expect(prepared.simplification.tolerance).toBe(constrainArtwork(source, canvas).widthRatio * canvas.width * source.contourTolerance!);
  });

  // 옵션을 켜거나 오차를 바꾸고 끌 때 원본 윤곽은 공유하고 계산 자료만 다시 준비한다.
  it('간략화 옵션 전환과 제자리 변경은 배치 캐시를 무효화한다', () => {
    const cache = createArtworkPreparationCache(), source = curvedArtwork();
    source.contourTolerance = 0;
    const off = cache.prepare(source, canvas);
    source.contourTolerance = .005;
    const on = cache.prepare(source, canvas);
    source.contourTolerance = .003;
    const changed = cache.prepare(source, canvas);
    source.contourTolerance = 0;
    const offAgain = cache.prepare(source, canvas);
    expectOriginal(offAgain, source);
    expect(offAgain.collision.paths).toEqual(off.collision.paths);
    expect(on.collision).not.toBe(off.collision); expect(changed.collision).not.toBe(on.collision);
    expect(changed.simplification.tolerance).toBe(source.widthRatio * canvas.width * .003);
    expect(cache.getStats()).toMatchObject({ hits: 0, misses: 4, contourHits: 3, contourMisses: 1, collisionPreparations: 4, artworkCount: 1, placementCount: 1 });
  });

  // 이동·크기 변경 후 원본을 다시 사용하고 간략화 오차는 제한된 실제 배치 크기로 환산한다.
  it('이동과 크기 및 좁은 캔버스의 실제 배치 폭에 맞춰 계산 윤곽을 다시 준비한다', () => {
    const cache = createArtworkPreparationCache(), source = curvedArtwork();
    const first = cache.prepare(source, canvas);
    const moved = { ...source, x: .4, y: .42 }, second = cache.prepare(moved, canvas);
    const scaled = { ...source, widthRatio: .3 }, third = cache.prepare(scaled, canvas);
    const narrowCanvas = { ...canvas, height: 125 }, constrained = cache.prepare(source, narrowCanvas);
    for (const prepared of [first, second, third]) {
      expect(prepared.simplification.applied).toBe(true);
      expect(pathsArea(subtractPaths(prepared.footprint, prepared.collision.paths))).toBe(0);
    }
    expectOriginal(second, moved); expectOriginal(third, scaled); expectOriginal(constrained, source, narrowCanvas);
    expect(second.simplification.tolerance).toBe(first.simplification.tolerance);
    expect(third.simplification.tolerance).toBe(scaled.widthRatio * canvas.width * scaled.contourTolerance!);
    expect(constrained.simplification.tolerance).toBe(constrainArtwork(source, narrowCanvas).widthRatio * narrowCanvas.width * source.contourTolerance!);
    expect(cache.getStats()).toMatchObject({ misses: 4, contourHits: 3, contourMisses: 1, placementCount: 1 });
  });

  // 다른 일반 패턴 시드가 붙은 입력이라도 SVG 준비를 바꾸는 값은 없다.
  it('다른 시드의 요청과 동일 좌표 복제에서 간략화 준비 자료를 재사용한다', () => {
    const cache = createArtworkPreparationCache(), source = curvedArtwork();
    const firstInput = { ...source, seed: '첫 번째 시드' }, secondInput = { ...structuredClone(source), seed: '두 번째 시드' };
    const first = cache.prepare(firstInput, canvas), second = cache.prepare(secondInput, canvas);
    expect(second.collision).toBe(first.collision); expect(second.contour).toBe(first.contour);
    expect(second.simplification).toBe(first.simplification);
    expect(cache.getStats()).toMatchObject({ hits: 1, misses: 1, collisionPreparations: 1 });
  });

  // 사각 경계에는 줄일 곡선이 없으므로 오차를 지정해도 원래 사각형을 검사한다.
  it('사각 경계 회피 모드는 간략화를 생략한다', () => {
    const cache = createArtworkPreparationCache(), source = { ...curvedArtwork(), avoidance: 'bounds' as const };
    const prepared = cache.prepare(source, canvas);
    expectOriginal(prepared, source);
    expect(prepared.simplification).toEqual({ originalSegments: 4, simplifiedSegments: 4, applied: false, tolerance: 0 });
    expect(prepared.contour).toBeNull();
    source.contourTolerance = .002;
    expect(cache.prepare(source, canvas).collision).not.toBe(prepared.collision);
    expect(cache.getStats()).toMatchObject({ misses: 2, contourHits: 1 });
  });

  // 계산 경계와 통계를 동결하고 출력 도형은 복제해 입력 및 다음 결과를 보존한다.
  it('간략화 경계와 통계 및 출력 도형의 변경이 원본과 캐시를 오염시키지 않는다', () => {
    const cache = createArtworkPreparationCache(), source = curvedArtwork(), snapshot = structuredClone(source);
    const prepared = cache.prepare(source, canvas);
    expect(source).toEqual(snapshot);
    expect(Object.isFrozen(source.parts[0].paths[0][0])).toBe(false);
    expect(Object.isFrozen(prepared.simplification)).toBe(true);
    expect(Object.isFrozen(prepared.collision.paths[0][0])).toBe(true);
    expect(() => { prepared.simplification.tolerance = 0; }).toThrow(TypeError);
    expect(() => { prepared.collision.paths[0][0].x = -100; }).toThrow(TypeError);
    prepared.shapes[0].color = '#ffffff'; prepared.shapes[0].paths[0][0].x = -100;
    const next = cache.prepare(source, canvas);
    expectOriginal(next, source); expect(next.simplification.applied).toBe(true);
    expect(source).toEqual(snapshot);
  });

  // 색인 선분 수만 작아도 보관한 원본과 배치 윤곽의 좌표까지 합쳐 상한을 검사한다.
  it('원본과 계산 윤곽의 실제 보관 합계로 선분 예산을 적용한다', () => {
    const source = curvedArtwork(), probe = createArtworkPreparationCache();
    const prepared = probe.prepare(source, canvas), originalSegments = prepared.simplification.originalSegments;
    const budget = originalSegments * 2 + prepared.collision.segmentCount;
    expect(probe.getStats()).toMatchObject({ segmentCount: prepared.collision.segmentCount, retainedSegmentCount: budget });
    const exactLimit = createArtworkPreparationCache({ maxSegments: budget });
    exactLimit.prepare(source, canvas); exactLimit.prepare(source, canvas);
    expect(exactLimit.getStats()).toMatchObject({ hits: 1, retainedSegmentCount: budget });
    const tooSmall = createArtworkPreparationCache({ maxSegments: budget - 1 });
    tooSmall.prepare(source, canvas); tooSmall.prepare(source, canvas);
    expect(tooSmall.getStats()).toMatchObject({ hits: 0, misses: 2, artworkCount: 0, segmentCount: 0, retainedSegmentCount: 0 });
  });
});

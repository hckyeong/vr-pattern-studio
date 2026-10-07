// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { importSvg } from '../src/core/importSvg';
import { constrainArtwork, placeArtwork } from '../src/core/artwork';
import { boundsOf, pathsArea, pathsConflict, rectangle } from '../src/core/geometry';
import { DEFAULT_SETTINGS, resolveCanvas, validateSettings } from '../src/core/settings';
import { generatePattern } from '../src/core/generator';
import { exportSvg } from '../src/core/svg';
import { loadWorkspace, saveWorkspace } from '../src/core/storage';
import { convertInputMode } from '../src/ui/convertInputMode';

/** 검증용 도형을 독립적인 SVG 원고로 감싼다. */
function svg(body: string): string { return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`; }
/** 작은 캔버스에 실제 마커와 오목한 삽입 그림을 함께 배치한다. */
function input() {
  const settings = structuredClone(DEFAULT_SETTINGS);
  Object.assign(settings, { width: 600, height: 400, minSize: 35, maxSize: 110, gap: 7, whiteRatio: .7 });
  settings.markers = { ...settings.markers, count: 3, side: 25 };
  settings.artwork = importSvg(svg('<path d="M0 0H30V70H100V100H0Z"/>'), '고정 그림.svg');
  settings.artwork.widthRatio = .3;
  return settings;
}

describe('SVG 가져오기', () => {
  // 스타일 상속과 변환 순서, 실측 선 두께를 확인한다.
  it('클래스 색상과 중첩 변환, 둥근 사각형·타원·굵은 선을 면으로 가져온다', () => {
    const artwork = importSvg(svg('<style>.ink {fill:rgb(20,40,60)}</style><g transform="translate(20 10)"><g transform="scale(2)"><rect class="ink" width="20" height="10" rx="2"/><ellipse cx="40" cy="10" rx="5" ry="3"/><path fill="none" stroke="black" stroke-width="2" stroke-linecap="round" d="M0 30L40 30"/></g></g>'), '예제.svg');
    expect(artwork.parts).toHaveLength(3);
    expect(artwork.parts[0].color).toBe('#14283c');
    expect(artwork.parts[0].paths[0].length).toBeGreaterThan(10);
    expect(artwork.aspect).toBeCloseTo(31 / 46, 2);
    expect(artwork).toMatchObject({ avoidance: 'outline', contourMode: 'simplify', contourTolerance: .001 });
  });
  // 상대 명령과 여러 하위 경로를 구분한다.
  it('곡선·원호와 짝홀 채움의 구멍을 유지한다', () => {
    const ring = importSvg(svg('<path fill-rule="evenodd" d="M0 0h100v100h-100z M20 20h60v60h-60z"/>'), '구멍.svg');
    expect(pathsArea(ring.parts[0].paths)).toBeCloseTo(.64);
    expect(pathsConflict(ring.parts[0].paths, rectangle(.3, .3, .1, .1), .01)).toBe(false);
    const curves = importSvg(svg('<path d="M0 50 Q25 0 50 50 T100 50 A50 20 0 0 1 0 50Z"/>'), '곡선.svg');
    expect(curves.parts[0].paths.flat().length).toBeGreaterThan(30);
  });
  // 좌우 반전된 그룹도 구멍과 색칠 면적을 유지한다.
  it('변환 순서를 적용하고 내부 use만 확장한다', () => {
    const artwork = importSvg(svg('<defs><path id="shape" d="M0 0H10V20H0Z"/></defs><g transform="translate(100 0) scale(-2 1)"><use href="#shape" x="10"/></g><rect x="100" width="10" height="20"/>'), '참조.svg');
    expect(artwork.parts).toHaveLength(2);
    expect(boundsOf(artwork.parts[0].paths).maxX).toBeCloseTo(.4);
    expect(artwork.aspect).toBeCloseTo(.4);
  });
  // 흰 덧칠을 잉크 면적에서 빼되 그림 보호 영역으로 유지한다.
  it('흰색 창문과 겹친 채움은 중복 없이 면적에 반영한다', () => {
    const settings = input();
    settings.artwork = importSvg(svg('<rect width="100" height="100"/><rect x="20" y="20" width="60" height="60" fill="white"/>'), '창문.svg');
    const placed = placeArtwork(settings.artwork, resolveCanvas(settings));
    const size = settings.artwork.widthRatio * settings.width;
    expect(placed.inkArea).toBeCloseTo(size * size * .64);
    expect(pathsArea(placed.footprint)).toBeCloseTo(size * size);
  });
  // 실행 가능한 내용이나 처리할 수 없는 효과는 명확히 거부한다.
  it.each([
    '<script>alert(1)</script>', '<rect width="10" height="10" onclick="alert(1)"/>',
    '<image href="https://example.com/a.png"/>', '<use href="https://example.com/a.svg#p"/>',
    '<foreignObject/>', '<animate/>', '<text>문자</text>',
    '<rect width="10" height="10" fill="url(#g)"/>',
    '<g clip-path="url(#c)"><rect width="10" height="10"/></g>',
    '<path d="M0 0L10 0" fill="none" stroke="black" stroke-dasharray="2 2"/>',
    '<rect width="10" height="10" opacity=".5"/>',
    '<defs><use id="loop" href="#loop"/></defs><use href="#loop"/>',
  ])('지원하지 않거나 위험한 SVG를 실행하지 않고 거부한다: %s', body => {
    expect(() => importSvg(svg(body), '거부.svg')).toThrow();
  });
  // XML 구문 오류와 빈 원고를 처리한다.
  it('깨진 XML·경로와 빈 원고를 거부한다', () => {
    expect(() => importSvg('<svg><path></svg>', '오류.svg')).toThrow();
    expect(() => importSvg(svg('<path d="M 1 nope"/>'), '오류.svg')).toThrow();
    expect(() => importSvg(svg('<g/>'), '빈.svg')).toThrow();
  });
});

describe('고정 그림과 패턴 배치', () => {
  // 일반 도형과 회전된 마커의 보호 영역 모두 고정 그림을 피해야 한다.
  it('SVG 윤곽과 최소 간격을 지키며 이동한 위치에서도 재현된다', async () => {
    const settings = input();
    for (const x of [.3, .72]) {
      settings.artwork!.x = x;
      const result = await generatePattern(settings);
      const fixed = placeArtwork(settings.artwork!, result.canvas);
      expect(result.shapes.filter(shape => shape.kind === 'artwork')).toHaveLength(1);
      expect(result.shapes.filter(shape => shape.kind === 'marker')).toHaveLength(3);
      for (const shape of result.shapes.filter(shape => shape.kind !== 'artwork')) expect(pathsConflict(fixed.footprint, shape.footprint ?? shape.paths, settings.gap)).toBe(false);
      const second = await generatePattern(settings);
      expect(second.shapes).toEqual(result.shapes);
    }
  }, 30000);
  // 사각형 회피는 실제 윤곽에서 빈 오목 영역까지 예약한다.
  it('전체 사각 영역 옵션은 오목한 빈 공간도 보호한다', async () => {
    const settings = input(); settings.artwork!.avoidance = 'bounds';
    const result = await generatePattern(settings), placed = placeArtwork(settings.artwork!, result.canvas);
    expect(placed.footprint[0]).toHaveLength(4);
    for (const shape of result.shapes.filter(shape => shape.kind !== 'artwork')) expect(pathsConflict(placed.footprint, shape.footprint ?? shape.paths, settings.gap)).toBe(false);
  }, 30000);
  // 백분율 배치가 단위나 비율 모드 변경에 안정적인지 확인한다.
  it('경계 밖 이동과 과도한 크기를 제한하고 단위 전환 후 위치를 보존한다', () => {
    const settings = input();
    const bounded = constrainArtwork({ ...settings.artwork!, x: -1, y: 4, widthRatio: 2 }, resolveCanvas(settings));
    const bounds = boundsOf(placeArtwork(bounded, resolveCanvas(settings)).footprint);
    expect(bounds.minX).toBeGreaterThanOrEqual(0); expect(bounds.maxY).toBeLessThanOrEqual(400.000001);
    expect(convertInputMode(settings, 'ratio').artwork).toEqual(settings.artwork);
    expect(validateSettings({ ...settings, artwork: { ...settings.artwork!, widthRatio: Infinity } })).toContain('삽입 SVG의 벡터 데이터나 배치 값이 올바르지 않습니다. 파일을 다시 불러와 주세요.');
  });
  // 캔버스 비율 변경으로 제한된 실제 배치를 결과 설정에도 기록한다.
  it('좁은 캔버스에 맞춘 SVG 크기를 결과 설정과 출력에 일치시킨다', async () => {
    const settings = input(); settings.height = 100; settings.markers.enabled = false;
    const result = await generatePattern(settings);
    expect(result.settings.artwork!.widthRatio).toBeCloseTo(1 / 6);
    expect(settings.artwork!.widthRatio).toBe(.3);
    const bounds = boundsOf(result.shapes.filter(shape => shape.kind === 'artwork').flatMap(shape => shape.paths));
    expect(bounds.maxY).toBeLessThanOrEqual(100.000001);
  }, 30000);
  // 저장과 SVG 출력에 삽입한 도형 및 배치를 빠짐없이 보존한다.
  it('벡터 출력과 브라우저 보관에 그림의 색상·좌표·이름을 보존한다', async () => {
    const settings = input(), result = await generatePattern(settings);
    const output = new DOMParser().parseFromString(exportSvg(result), 'image/svg+xml');
    expect(output.querySelector('parsererror')).toBeNull();
    expect(output.querySelectorAll('g[id^="imported-artwork-"]')).toHaveLength(1);
    expect(output.querySelectorAll('image,script,foreignObject')).toHaveLength(0);
    expect(JSON.parse(output.querySelector('metadata')!.textContent!).settings.artwork).toEqual(settings.artwork);
    saveWorkspace(settings, [result]);
    expect(loadWorkspace()?.results[0].settings.artwork).toEqual(settings.artwork);
  }, 30000);
});

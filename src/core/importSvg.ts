import svgpath from 'svgpath';
import colorString from 'color-string';
import { EndType, inflatePathsD, JoinType } from 'clipper2-ts';
import { boundsOf, normalizePaths } from './geometry';
import { validArtwork } from './artwork';
import type { Point, Polygon, SvgArtwork } from './types';

type Paint = Record<string, string>;
interface CssRule { selector: string; declarations: Paint; priority: number }
const PROPERTIES = ['fill', 'stroke', 'color', 'fill-rule', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'fill-opacity', 'stroke-opacity', 'opacity', 'display', 'visibility', 'clip-path', 'mask', 'filter', 'vector-effect', 'marker-start', 'marker-mid', 'marker-end', 'paint-order', 'mix-blend-mode'];
const BASE: Paint = { fill: '#000000', stroke: 'none', color: '#000000', 'fill-rule': 'nonzero', 'stroke-width': '1', 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', 'stroke-miterlimit': '4' };

/** 지원하는 스타일만 해석하고 외부 참조 및 효과를 실행하지 않는다. */
function declarations(text: string): Paint {
  const values: Paint = {};
  for (const declaration of text.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator < 0) continue;
    const key = declaration.slice(0, separator).trim().toLowerCase(), value = declaration.slice(separator + 1).trim();
    if (key === 'transform' || /!important/i.test(value)) throw new Error('CSS 변환과 우선순위 스타일은 지원하지 않습니다. 변환을 적용한 일반 SVG로 저장해 주세요.');
    if (PROPERTIES.includes(key)) values[key] = value;
  }
  return values;
}

/** 일러스트 파일의 단순 클래스·아이디·태그 스타일을 순서대로 읽는다. */
function readCss(root: Element): CssRule[] {
  const rules: CssRule[] = [];
  for (const style of root.querySelectorAll('style')) {
    const text = (style.textContent ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (/@|url\s*\(/i.test(text)) throw new Error('외부 스타일과 참조 효과는 지원하지 않습니다. 단색 벡터로 저장해 주세요.');
    const matches = [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    if (text.replace(/([^{}]+)\{([^{}]*)\}/g, '').trim()) throw new Error('SVG의 스타일 규칙을 해석할 수 없습니다.');
    for (const match of matches) for (const selector of match[1].split(',').map(value => value.trim())) {
      if (!/^(?:[a-zA-Z][\w-]*)?(?:[.#][\w-]+)*$/.test(selector) || !selector) throw new Error('복잡한 CSS 선택자는 지원하지 않습니다. 스타일을 도형 속성으로 변환해 주세요.');
      rules.push({ selector, declarations: declarations(match[2]), priority: (selector.match(/#/g)?.length ?? 0) * 100 + (selector.match(/\./g)?.length ?? 0) * 10 + (/^[a-z]/i.test(selector) ? 1 : 0) });
    }
  }
  return rules.sort((a, b) => a.priority - b.priority);
}

/** 길이를 숫자 또는 픽셀로 읽으며 모호한 상대 단위는 거부한다. */
function number(value: string | null | undefined, fallback = 0): number {
  if (value == null || value === '') return fallback;
  if (!/^[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?(?:px)?$/i.test(value.trim())) throw new Error('SVG 도형 좌표는 숫자 또는 px 단위여야 합니다.');
  const result = Number.parseFloat(value);
  if (!Number.isFinite(result) || Math.abs(result) > 1e8) throw new Error('SVG 좌표가 지원 범위를 벗어났습니다.');
  return result;
}

/** 단색 채움의 색상과 불투명도를 검증해 안전한 육자리 색상으로 만든다. */
function color(value: string, opacity = '1'): string | null {
  if (value === 'none' || Number(opacity) === 0) return null;
  const parsed = colorString.get.rgb(value);
  if (!parsed || !Number.isFinite(Number(opacity))) throw new Error('단색 채움만 지원합니다. 그라데이션·패턴·특수 색상은 단색으로 변환해 주세요.');
  if (parsed[3] === 0) return null;
  if (parsed[3] !== 1 || Number(opacity) !== 1) throw new Error('반투명 SVG는 불투명한 벡터로 변환해 주세요.');
  return `#${parsed.slice(0, 3).map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

/** 기본 SVG 도형을 곡선을 유지한 경로 문자열로 바꾼다. */
function shapePath(element: Element): string {
  const tag = element.localName;
  /** 해당 도형의 수치 속성을 읽는다. */
  const attr = (name: string, fallback = 0) => number(element.getAttribute(name), fallback);
  if (tag === 'path') return element.getAttribute('d') ?? '';
  if (tag === 'polygon' || tag === 'polyline') {
    const values = (element.getAttribute('points') ?? '').trim().split(/[\s,]+/).filter(Boolean).map(value => number(value));
    if (values.length % 2) throw new Error('다각형의 좌표 쌍이 올바르지 않습니다.');
    return values.length ? `M${values.join(' ')}${tag === 'polygon' ? 'Z' : ''}` : '';
  }
  if (tag === 'line') return `M${attr('x1')} ${attr('y1')}L${attr('x2')} ${attr('y2')}`;
  if (tag === 'circle' || tag === 'ellipse') {
    const x = attr('cx'), y = attr('cy'), rx = attr(tag === 'circle' ? 'r' : 'rx'), ry = tag === 'circle' ? rx : attr('ry');
    if (rx < 0 || ry < 0) throw new Error('원의 반지름은 음수일 수 없습니다.');
    return rx && ry ? `M${x - rx} ${y}A${rx} ${ry} 0 1 0 ${x + rx} ${y}A${rx} ${ry} 0 1 0 ${x - rx} ${y}Z` : '';
  }
  if (tag === 'rect') {
    const x = attr('x'), y = attr('y'), w = attr('width'), h = attr('height');
    const rx = Math.min(w / 2, attr('rx', attr('ry'))), ry = Math.min(h / 2, attr('ry', attr('rx')));
    if ([w, h, rx, ry].some(value => value < 0)) throw new Error('사각형 크기는 음수일 수 없습니다.');
    if (!w || !h) return '';
    if (!rx || !ry) return `M${x} ${y}h${w}v${h}h${-w}Z`;
    return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
  }
  throw new Error(`지원하지 않는 SVG 요소입니다: ${tag}. 문자·효과를 윤곽선으로 변환해 주세요.`);
}

/** 곡선을 상대 오차 기준으로 세분화하고 독립된 하위 경로와 닫힘을 보존한다. */
function flatten(data: string): { points: Polygon; closed: boolean }[] {
  const parsed = svgpath(data);
  if ((parsed as unknown as { err?: string }).err) throw new Error('SVG 경로 문법이 올바르지 않습니다.');
  const result: { points: Polygon; closed: boolean }[] = [];
  let current: Polygon = [], count = 0;
  /** 점 개수와 유한 좌표를 제한하여 과도한 원고를 거부한다. */
  const append = (point: Point) => {
    if (![point.x, point.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e8) || ++count > 40000) throw new Error('SVG 경로가 너무 복잡하거나 좌표 범위가 큽니다. 경로를 단순화해 주세요.');
    current.push(point);
  };
  /** 곡선의 제어점과 끝점의 차이를 이용해 재귀적으로 정밀도를 확보한다. */
  const cubic = (a: Point, b: Point, c: Point, d: Point, tolerance: number, depth = 0): void => {
    const flat = Math.max(Math.hypot(b.x - (2 * a.x + d.x) / 3, b.y - (2 * a.y + d.y) / 3), Math.hypot(c.x - (a.x + 2 * d.x) / 3, c.y - (a.y + 2 * d.y) / 3));
    if (flat <= tolerance || depth >= 16) { append(d); return; }
    /** 두 제어점의 중점을 계산한다. */
    const mid = (p: Point, q: Point): Point => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    const ab = mid(a, b), bc = mid(b, c), cd = mid(c, d), abc = mid(ab, bc), bcd = mid(bc, cd), center = mid(abc, bcd);
    cubic(a, ab, abc, center, tolerance, depth + 1); cubic(center, bcd, cd, d, tolerance, depth + 1);
  };
  parsed.abs().unshort().unarc().iterate((segment, _index, x, y) => {
    const values = segment.slice(1) as number[];
    if (values.some(value => !Number.isFinite(value))) throw new Error('SVG 경로에 유효하지 않은 좌표가 있습니다.');
    if (segment[0] === 'M') { current = []; result.push({ points: current, closed: false }); append({ x: segment[1], y: segment[2] }); }
    else if (segment[0] === 'L') append({ x: segment[1], y: segment[2] });
    else if (segment[0] === 'H') append({ x: segment[1], y });
    else if (segment[0] === 'V') append({ x, y: segment[1] });
    else if (segment[0] === 'Z') { if (result.length) result[result.length - 1].closed = true; }
    else if (segment[0] === 'C' || segment[0] === 'Q') {
      const a = { x, y };
      const b = segment[0] === 'C' ? { x: segment[1], y: segment[2] } : { x: x + 2 / 3 * (segment[1] - x), y: y + 2 / 3 * (segment[2] - y) };
      const d = segment[0] === 'C' ? { x: segment[5], y: segment[6] } : { x: segment[3], y: segment[4] };
      const c = segment[0] === 'C' ? { x: segment[3], y: segment[4] } : { x: d.x + 2 / 3 * (segment[1] - d.x), y: d.y + 2 / 3 * (segment[2] - d.y) };
      const extent = Math.max(Math.hypot(b.x - x, b.y - y), Math.hypot(c.x - x, c.y - y), Math.hypot(d.x - x, d.y - y));
      cubic(a, b, c, d, Math.max(1e-6, extent / 4000));
    }
  });
  return result.filter(path => path.points.length > 1);
}

/** 변환 목록을 검증하고 선을 면으로 만든 뒤에도 같은 행렬을 적용한다. */
function transformed(paths: Polygon[], transform: string): Polygon[] {
  if (!transform.trim()) return paths;
  const rest = transform.replace(/(?:matrix|translate|scale|rotate|skewX|skewY)\s*\(\s*[-+\d.eE,\s]+\)/g, '').replace(/[\s,]/g, '');
  if (rest) throw new Error('지원하지 않는 SVG 좌표 변환입니다.');
  return paths.map(path => {
    const result: Polygon = [];
    svgpath(`M${path.map(point => `${point.x} ${point.y}`).join('L')}`).transform(transform).abs().iterate(segment => {
      if (segment[0] === 'M' || segment[0] === 'L') result.push({ x: segment[1], y: segment[2] });
    });
    return result;
  });
}

/** SVG를 안전한 벡터로 읽고 채움 회피와 균형 간략화를 기본 설정으로 적용한다. */
export function importSvg(text: string, name: string): SvgArtwork {
  if (text.length > 2_000_000) throw new Error('SVG는 2MB 이하로 단순화해 주세요.');
  if (/<!ENTITY|<\?xml-stylesheet/i.test(text)) throw new Error('외부 엔티티나 스타일 참조가 있는 SVG는 불러올 수 없습니다.');
  const document = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = document.documentElement;
  if (root.localName !== 'svg' || document.querySelector('parsererror')) throw new Error('올바른 SVG 파일이 아닙니다.');
  const elements = [root, ...root.querySelectorAll('*')];
  if (elements.length > 3000) throw new Error('SVG 요소가 너무 많습니다. 3,000개 이하로 단순화해 주세요.');
  for (const element of elements) {
    if (['script', 'foreignObject', 'image', 'animate', 'animateTransform', 'set'].includes(element.localName)) throw new Error('스크립트·애니메이션·비트맵이 없는 벡터 SVG를 사용해 주세요.');
    for (const attr of element.attributes) if (/^on/i.test(attr.name) || (attr.localName === 'href' && !attr.value.startsWith('#'))) throw new Error('이벤트나 외부 참조가 있는 SVG는 지원하지 않습니다.');
  }
  const rules = readCss(root), parts: SvgArtwork['parts'] = [];
  let visits = 0, totalPoints = 0;
  /** 도형별 채움과 선을 정규화한 면으로 추가한다. */
  const add = (paths: Polygon[], fill: string | null, transform: string, rule: 'evenodd' | 'nonzero' = 'nonzero') => {
    if (!fill || !paths.length) return;
    const normalized = normalizePaths(transformed(paths, transform), rule);
    if (!normalized.length) return;
    totalPoints += normalized.reduce((sum, path) => sum + path.length, 0);
    if (totalPoints > 40000 || parts.length >= 500) throw new Error('SVG는 500개 채움 도형, 40,000개 좌표 이하로 단순화해 주세요.');
    parts.push({ color: fill, paths: normalized });
  };
  /** 그룹의 스타일과 변환을 상속하고 내부 참조만 제한적으로 확장한다. */
  const visit = (element: Element, inherited: Paint, parentTransform: string, depth = 0): void => {
    if (++visits > 5000 || depth > 32) throw new Error('SVG 참조가 순환하거나 너무 깊습니다.');
    if (['defs', 'style', 'title', 'desc', 'metadata'].includes(element.localName)) return;
    const style: Paint = { ...inherited, opacity: '1', display: 'inline' };
    for (const property of PROPERTIES) if (element.hasAttribute(property)) style[property] = element.getAttribute(property)!;
    for (const rule of rules) if (element.matches(rule.selector)) Object.assign(style, rule.declarations);
    Object.assign(style, declarations(element.getAttribute('style') ?? ''));
    for (const property of PROPERTIES) if (style[property] === 'inherit') style[property] = inherited[property];
    if (style.display === 'none' || Number(style.opacity) === 0) return;
    if (Number(style.opacity) !== 1) throw new Error('그룹 반투명 효과를 제거한 SVG를 사용해 주세요.');
    for (const property of ['paint-order', 'mix-blend-mode']) if (style[property] && style[property] !== 'normal') throw new Error('채움 순서와 혼합 효과를 일반 윤곽선으로 확장해 주세요.');
    for (const property of ['clip-path', 'mask', 'filter', 'vector-effect', 'marker-start', 'marker-mid', 'marker-end']) if (style[property] && style[property] !== 'none') throw new Error('클리핑·마스크·필터·선 효과를 일반 윤곽선으로 확장해 주세요.');
    const transform = `${parentTransform} ${element.getAttribute('transform') ?? ''}`;
    if (element.localName === 'g' || element === root) { for (const child of element.children) visit(child, style, transform, depth + 1); return; }
    if (element.localName === 'use') {
      const href = element.getAttribute('href') ?? element.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      const reference = href?.startsWith('#') ? document.getElementById(href.slice(1)) : null;
      if (!reference || !['g', 'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'use'].includes(reference.localName)) throw new Error('내부 도형 참조를 찾을 수 없습니다. 심볼을 일반 경로로 확장해 주세요.');
      visit(reference, style, `${transform} translate(${number(element.getAttribute('x'))} ${number(element.getAttribute('y'))})`, depth + 1); return;
    }
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return;
    const data = shapePath(element);
    if (!data.trim()) return;
    const paths = flatten(data);
    const fill = color(style.fill === 'currentColor' ? style.color : style.fill, style['fill-opacity']);
    const stroke = color(style.stroke === 'currentColor' ? style.color : style.stroke, style['stroke-opacity']);
    if (!['evenodd', 'nonzero'].includes(style['fill-rule'])) throw new Error('지원하지 않는 SVG 채움 규칙입니다.');
    add(paths.filter(path => path.points.length >= 3).map(path => path.points), fill, transform, style['fill-rule'] as 'evenodd' | 'nonzero');
    if (stroke) {
      if (style['stroke-dasharray'] && style['stroke-dasharray'] !== 'none') throw new Error('점선은 윤곽선으로 확장해 주세요.');
      const width = number(style['stroke-width'], 1), miter = number(style['stroke-miterlimit'], 4);
      if (width < 0 || miter < 1) throw new Error('SVG 선 굵기나 모서리 제한이 올바르지 않습니다.');
      const join = ({ miter: JoinType.Miter, round: JoinType.Round, bevel: JoinType.Bevel } as Record<string, JoinType>)[style['stroke-linejoin']];
      const end = ({ butt: EndType.Butt, round: EndType.Round, square: EndType.Square } as Record<string, EndType>)[style['stroke-linecap']];
      if (join === undefined || end === undefined) throw new Error('지원하지 않는 선 끝 또는 모서리 모양입니다.');
      if (width) for (const path of paths) add(inflatePathsD([path.points], width / 2, join, path.closed ? EndType.Joined : end, miter, 6, Math.max(1e-6, width / 1000)), stroke, transform);
    }
  };
  visit(root, BASE, '');
  if (!parts.length) throw new Error('SVG에 표시할 벡터 도형이 없습니다.');
  const bounds = boundsOf(parts.flatMap(part => part.paths)), width = bounds.maxX - bounds.minX, height = bounds.maxY - bounds.minY;
  const artwork: SvgArtwork = { name: name.slice(0, 200), aspect: height / width, parts: parts.map(part => ({ ...part, paths: part.paths.map(path => path.map(point => ({ x: (point.x - bounds.minX) / width, y: (point.y - bounds.minY) / width }))) })), x: 0.5, y: 0.5, widthRatio: 0.22, avoidance: 'outline', contourMode: 'simplify', contourTolerance: .001 };
  if (!validArtwork(artwork)) throw new Error('SVG의 크기 비율이나 벡터 데이터가 지원 범위를 벗어났습니다.');
  return artwork;
}

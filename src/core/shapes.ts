import { angularStrokePaths, boundsOf, normalizePaths, pathsArea, rectangle, strokePaths, subtractPaths, transformPaths } from './geometry';
import type { PatternSettings, PatternShape, Polygon, ShapeKind } from './types';
import { chooseColor } from './colors';

/** 양수 비중의 도형만 선택하며 이전 시안의 누락된 계단 비중은 제외한다. */
function chooseKind(settings: PatternSettings, random: () => number): ShapeKind {
  const entries = Object.entries(settings.weights).filter(([, weight]) => (weight ?? 0) > 0) as [ShapeKind, number][];
  let cursor = random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [kind, weight] of entries) { cursor -= weight; if (cursor < 0) return kind; }
  return 'polygon';
}

/** 크기와 간격에 따른 곡선 현 오차를 제한하되 꼭짓점 수를 유한하게 유지한다. */
function curveSegments(radius: number, sweep: number, gap: number): number {
  const tolerance = Math.max(0.000001, Math.min(radius * 0.002, Math.max(radius * 0.0002, gap * 0.05)));
  return Math.min(192, Math.max(16, Math.ceil(sweep / (2 * Math.acos(Math.max(-1, 1 - tolerance / radius))))));
}

/** 타원을 닫힌 벡터 외곽선으로 근사한다. */
function ellipse(rx: number, ry: number, cy: number, count: number): Polygon {
  return Array.from({ length: count }, (_, index) => { const angle = index / count * Math.PI * 2; return { x: rx * Math.cos(angle), y: cy + ry * Math.sin(angle) }; });
}
/** 도형군별 비중을 지키며 계단의 단수와 각 도형의 크기·형태·회전을 바꾼다. */
export function createShape(settings: PatternSettings, random: () => number, size: number, x: number, y: number, id: number): PatternShape {
  const kind = chooseKind(settings, random), radius = size / 2, squash = 0.55 + random() * 0.45;
  let paths: Polygon[];
  if (kind === 'stair') {
    const count = 2 + Math.floor(random() * 4), solid = random() < 0.5;
    const thickness = size * (0.08 + random() * 0.06);
    const halfWidth = radius - thickness / 2, halfHeight = radius * squash - thickness / 2;
    const widths = Array.from({ length: count }, () => 0.7 + random() * 0.6);
    const heights = Array.from({ length: count }, () => 0.7 + random() * 0.6);
    const widthSum = widths.reduce((sum, value) => sum + value, 0), heightSum = heights.reduce((sum, value) => sum + value, 0);
    let stepX = -halfWidth, stepY = halfHeight;
    const steps: Polygon = [{ x: stepX, y: stepY }];
    for (let index = 0; index < count; index++) {
      stepY -= heights[index] / heightSum * halfHeight * 2;
      steps.push({ x: stepX, y: stepY });
      stepX += widths[index] / widthSum * halfWidth * 2;
      steps.push({ x: stepX, y: stepY });
    }
    paths = solid ? [[...steps, { x: halfWidth, y: halfHeight }]] : angularStrokePaths([steps], thickness);
    // 좌우 방향도 바꿔 같은 단수의 계단이 반복되지 않도록 한다.
    if (random() < 0.5) paths = paths.map(path => path.map(point => ({ x: -point.x, y: point.y })));
  } else if (kind === 'triangle' || kind === 'polygon') {
    const count = kind === 'triangle' ? 3 : settings.vertexMin + Math.floor(random() * (settings.vertexMax - settings.vertexMin + 1));
    const concave = kind === 'polygon' && random() < settings.concaveRatio;
    paths = [Array.from({ length: count }, (_, index) => {
      const angle = (index + random() * 0.35) / count * Math.PI * 2;
      const r = radius * (concave && index % 2 ? 0.3 + random() * 0.2 : 0.7 + random() * 0.3);
      return { x: Math.cos(angle) * r, y: Math.sin(angle) * r * squash };
    })];
  } else if (kind === 'frame') {
    const thickness = size * (0.12 + random() * 0.1);
    const variant = random();
    if (variant < 0.35) paths = strokePaths([[{ x: -radius * 0.8, y: radius * squash * 0.7 }, { x: -radius * 0.1, y: -radius * squash * 0.8 }, { x: radius * 0.8, y: radius * squash * 0.7 }, { x: radius * 0.15, y: radius * squash * 0.7 }]], thickness);
    else if (variant < 0.65) paths = strokePaths([[{ x: -radius * 0.8, y: -radius * squash * 0.6 }, { x: -radius * 0.3, y: radius * squash * 0.6 }, { x: radius * 0.2, y: -radius * squash * 0.1 }, { x: radius * 0.8, y: radius * squash * 0.4 }]], thickness);
    else paths = [[{ x: -radius, y: -radius * squash }, { x: radius, y: -radius * squash }, { x: radius, y: -radius * squash + thickness }, { x: -radius + thickness, y: -radius * squash + thickness }, { x: -radius + thickness, y: radius * squash - thickness }, { x: radius * 0.55, y: radius * squash - thickness }, { x: radius * 0.55, y: radius * squash }, { x: -radius, y: radius * squash }]];
  } else if (kind === 'arc') {
    // 동그란 점도 원 비중을 따르도록 원·원호 도형군에 포함한다.
    if (random() < 0.2) paths = [ellipse(radius * 0.7, radius * 0.7, 0, curveSegments(radius, Math.PI * 2, settings.gap))];
    else {
      const sweep = Math.PI * (0.8 + random() * 0.9), inner = radius * (0.48 + random() * 0.25), count = curveSegments(radius, sweep, settings.gap);
      const outer = Array.from({ length: count + 1 }, (_, i) => ({ x: radius * Math.cos(i / count * sweep), y: radius * Math.sin(i / count * sweep) * squash }));
      const hole = Array.from({ length: count + 1 }, (_, i) => ({ x: inner * Math.cos((count - i) / count * sweep), y: inner * Math.sin((count - i) / count * sweep) * squash }));
      paths = [[...outer, ...hole]];
    }
  } else if (kind === 'symbol') {
    const thickness = size * (0.13 + random() * 0.12);
    const variant = random();
    if (variant < 0.5) paths = [...rectangle(-radius, -thickness / 2, size, thickness), ...rectangle(-thickness / 2, -radius * squash, thickness, size * squash)];
    else {
      const count = 3 + Math.floor(random() * 3), pitch = size * squash / count;
      paths = Array.from({ length: count }, (_, index) => rectangle(-radius, -size * squash / 2 + index * pitch, size * (0.72 + random() * 0.28), pitch * 0.42)[0]);
    }
  } else {
    const count = curveSegments(radius, Math.PI * 2, settings.gap);
    const outer = [Array.from({ length: count }, (_, i) => { const angle = i / count * Math.PI * 2; return { x: radius * Math.cos(angle), y: radius * 0.3 * Math.sin(angle) + (i < count / 2 ? size * 0.22 : -size * 0.22) }; })];
    paths = subtractPaths(outer, [ellipse(radius * 0.77, radius * 0.17, -size * 0.22, count)]);
  }
  const rotation = settings.rotationStep > 0 ? Math.floor(random() * 360 / settings.rotationStep) * settings.rotationStep : random() * 360;
  paths = normalizePaths(transformPaths(normalizePaths(paths), x, y, rotation * Math.PI / 180));
  const colorSample = random();
  return { id: `shape-${id}`, kind, colorSample, color: chooseColor(settings, colorSample), paths, fillRule: 'nonzero', bounds: boundsOf(paths), area: pathsArea(paths) };
}

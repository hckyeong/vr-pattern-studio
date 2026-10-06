import { validateSettings } from './settings';
import type { PatternResult, PatternSettings } from './types';

const KEY = 'vr-pattern-studio.workspace.v1';
interface Workspace { settings: PatternSettings; results: PatternResult[] }

/** 저장된 결과가 화면에 표시할 수 있는 유한한 벡터 좌표인지 확인한다. */
function isResult(value: unknown): value is PatternResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as PatternResult;
  if (!result.canvas || !result.settings || validateSettings(result.settings).length || !Array.isArray(result.shapes) || result.shapes.length > 10000) return false;
  if (![result.canvas.width, result.canvas.height].every(number => Number.isFinite(number) && number > 0)) return false;
  if (!Number.isFinite(result.whiteRatio) || !Array.isArray(result.warnings)) return false;
  return result.shapes.every(shape => shape && /^#[0-9a-f]{3,8}$/i.test(shape.color)
    && ['evenodd', 'nonzero'].includes(shape.fillRule) && Array.isArray(shape.paths)
    && [...shape.paths, ...(shape.footprint || []), ...(shape.bleedPaths || [])].every(path => Array.isArray(path) && path.length < 100000
      && path.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y))));
}

/** 내부 저장소에서 검증한 최근 작업을 불러온다. */
export function loadWorkspace(): Workspace | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Workspace;
    if (!value?.settings || validateSettings(value.settings).length || !Array.isArray(value.results)) return null;
    return { settings: value.settings, results: value.results.filter(isResult).slice(0, 8) };
  } catch { return null; }
}

/** 저장 용량 안에 들어가는 최근 결과와 설정을 보관한다. */
export function saveWorkspace(settings: PatternSettings, results: PatternResult[]): void {
  const retained: PatternResult[] = [];
  let characters = 0;
  for (const result of results.slice(0, 8)) {
    const points = result.shapes.reduce((sum, shape) => sum + shape.paths.reduce((count, path) => count + path.length, 0), 0);
    if (points > 30000) break;
    const length = JSON.stringify(result).length;
    if (characters + length > 1_500_000) break;
    characters += length;
    retained.push(result);
  }
  try {
    localStorage.setItem(KEY, JSON.stringify({ settings, results: retained }));
  } catch {
    throw new Error('브라우저 저장 공간을 사용할 수 없습니다. 필요한 시안을 SVG로 저장해 주세요.');
  }
}

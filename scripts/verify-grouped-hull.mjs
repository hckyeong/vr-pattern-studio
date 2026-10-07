import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = path.join(root, 'tmp/grouped-hull');
const output = path.join(root, 'output/svg-performance/grouped-hull');
await mkdir(temporary, { recursive: true });
await mkdir(output, { recursive: true });
const entry = path.join(temporary, 'entry.ts');
// 현재 앱의 실제 가져오기·배치·계산 모듈만 묶어 긴 생성 벤치마크 없이 검증한다.
const exports = { importSvg: 'importSvg', artwork: 'placeArtwork', preparedArtwork: 'createArtworkPreparationCache', settings: 'DEFAULT_SETTINGS, resolveCanvas', geometry: 'subtractPaths' };
await writeFile(entry, Object.entries(exports).map(([file, names]) => `export { ${names} } from ${JSON.stringify(path.join(root, `src/core/${file}.ts`).replaceAll('\\', '/'))};`).join('\n'), 'utf8');
await build({ configFile: false, logLevel: 'error', build: { ssr: entry, outDir: temporary, emptyOutDir: false, minify: false, rolldownOptions: { output: { entryFileNames: 'engine.mjs' } } } });
const engine = await import(pathToFileURL(path.join(temporary, 'engine.mjs')).href);
const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;
const canvas = engine.resolveCanvas(engine.DEFAULT_SETTINGS), rows = [];

try {
  for (const name of ['불국사', '신라 금관', '고분과 꽃나무']) {
    const source = engine.importSvg(await readFile(path.join(root, `output/svg-performance/logos/${name}.svg`), 'utf8'), `${name}.svg`);
    // 가져오기 기본값과 무관하게 기존 볼록 껍질 검증의 최외곽 원본을 유지한다.
    Object.assign(source, { avoidance: 'silhouette', contourMode: 'simplify', contourTolerance: 0 });
    const original = engine.placeArtwork(source, canvas), before = structuredClone(source);
    for (const hullMergeRatio of [0, .02, .05]) {
      const artwork = { ...source, contourMode: 'grouped-hull', hullMergeRatio };
      const cache = engine.createArtworkPreparationCache();
      const started = performance.now(), prepared = cache.prepare(artwork, canvas);
      const preparationMs = performance.now() - started;
      assert.deepEqual({ shapes: prepared.shapes, footprint: prepared.footprint, inkArea: prepared.inkArea }, original);
      assert.deepEqual(engine.subtractPaths(original.footprint, prepared.collision.paths), []);
      assert.equal(prepared.simplification.method, 'grouped-hull');
      assert.equal(prepared.simplification.applied, true);
      assert(prepared.simplification.simplifiedSegments < prepared.simplification.originalSegments);
      const warmStarted = performance.now(), warm = cache.prepare(structuredClone(artwork), canvas);
      const cachedMs = performance.now() - warmStarted;
      assert.equal(warm.collision, prepared.collision);
      rows.push({ name, hullMergeRatio, preparationMs, cachedMs, ...prepared.simplification, outputUnchanged: true, coversOriginal: true });
      console.log(JSON.stringify(rows.at(-1)));
    }
    assert.deepEqual(source, before);
  }
  await writeFile(path.join(output, 'verification.json'), JSON.stringify({ generatedAt: new Date().toISOString(), canvas, measurement: '조건별 1회 전처리 측정이며 전체 생성 시간이나 반복 벤치마크가 아님', rows }, null, 2), 'utf8');
} finally {
  dom.window.close();
}

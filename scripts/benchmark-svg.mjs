import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { JSDOM } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselineCommit = '6a531ec112047a5893f84017fb99a3f70ca93ead';
const temporary = path.join(root, 'tmp', 'svg-performance');
const output = path.join(root, 'output', 'svg-performance');
const seeds = Number(process.env.VR_BENCH_SEEDS ?? 5);
const repeats = Number(process.env.VR_BENCH_REPEATS ?? 5);
const selected = (process.env.VR_BENCH_CASES ?? 'none,curve500,concave,holes').split(',');
assert(Number.isInteger(seeds) && seeds > 0 && Number.isInteger(repeats) && repeats > 0);
await mkdir(temporary, { recursive: true });
await mkdir(output, { recursive: true });

/** 기준 커밋의 소스만 임시 폴더에 읽어 재현 가능한 비교본을 준비한다. */
async function baselineSources() {
  const git = ['-c', `safe.directory=${root.replaceAll('\\', '/')}`];
  const paths = execFileSync('git', [...git, 'ls-tree', '-r', '--name-only', baselineCommit, 'src/core', 'src/data'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  const directory = path.join(temporary, 'baseline');
  for (const source of paths) {
    const destination = path.resolve(directory, source);
    assert(destination.startsWith(directory + path.sep));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, execFileSync('git', [...git, 'show', `${baselineCommit}:${source}`], { cwd: root, maxBuffer: 4 * 1024 * 1024 }));
  }
  return directory;
}

/** 웹앱과 같은 변환기로 비교용 엔진을 묶되 실제 배포 폴더는 건드리지 않는다. */
async function engine(directory, name, optimized) {
  const entry = path.join(temporary, `${name}-entry.ts`);
  const core = path.join(directory, 'src/core').replaceAll('\\', '/');
  await writeFile(entry, `export { generatePattern } from ${JSON.stringify(`${core}/generator.ts`)};\nexport { DEFAULT_SETTINGS, resolveCanvas } from ${JSON.stringify(`${core}/settings.ts`)};\nexport { importSvg } from ${JSON.stringify(`${core}/importSvg.ts`)};\nexport { placeArtwork } from ${JSON.stringify(`${core}/artwork.ts`)};\nexport { pathsConflict, subtractPaths } from ${JSON.stringify(`${core}/geometry.ts`)};\nexport { exportSvg } from ${JSON.stringify(`${core}/svg.ts`)};\n${optimized ? `export { createArtworkPreparationCache } from ${JSON.stringify(`${core}/preparedArtwork.ts`)};\n` : ''}`, 'utf8');
  const destination = path.join(temporary, name);
  await build({ configFile: false, logLevel: 'error', build: { ssr: entry, outDir: destination, emptyOutDir: false, minify: false, rolldownOptions: { output: { entryFileNames: 'engine.mjs' } } } });
  return import(pathToFileURL(path.join(destination, 'engine.mjs')).href + `?t=${Date.now()}`);
}

/** 선분 수를 조절하면서 오목한 곡선형 외곽을 가진 유효한 입력을 만든다. */
function curvedArtwork(count) {
  const points = Array.from({ length: count }, (_, index) => {
    const angle = index * Math.PI * 2 / count;
    const radius = .39 + .06 * Math.sin(angle * 7);
    return { x: .5 + radius * Math.cos(angle), y: .5 + radius * Math.sin(angle) };
  });
  return { name: `곡선-${count}.svg`, aspect: 1, parts: [{ color: '#222222', paths: [points] }], x: .5, y: .5, widthRatio: .3, avoidance: 'silhouette' };
}

/** 측정 시간과 기능 버전만 제외하고 원본 모드의 결과 전체를 해시로 비교한다. */
function resultHash(result) {
  const { elapsedMs, version, ...stable } = result;
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

/** 정렬된 시간 표본에서 중앙값과 상위 지연을 요약한다. */
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { count: sorted.length, medianMs: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2, p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], minMs: sorted[0], maxMs: sorted.at(-1) };
}

/** 실행 중단에도 완료된 측정과 일치 검증 기록을 남긴다. */
async function saveReport(report, filename) {
  await writeFile(path.join(output, filename), JSON.stringify(report, null, 2), 'utf8');
}

const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;
const baseline = await engine(await baselineSources(), 'before', false);
const optimized = await engine(root, 'after', true);
const concave = optimized.importSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H30V70H100V100H0Z"/><rect x="130" y="10" width="20" height="80"/></svg>', '오목.svg');
const holes = optimized.importSvg('<svg xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M0 0H100V100H0Z M20 20H80V80H20Z"/><rect fill="white" x="5" y="40" width="15" height="20"/></svg>', '구멍.svg');
const fixtures = { none: null, curve500: curvedArtwork(500), curve5000: curvedArtwork(5000), curve20000: curvedArtwork(20000), concave, holes };
const logoNames = { bulguksa: '불국사', crown: '신라 금관', tombs: '고분과 꽃나무' };
for (const name of selected) if (Object.hasOwn(logoNames, name)) {
  fixtures[name] = optimized.importSvg(await readFile(path.join(output, 'logos', `${logoNames[name]}.svg`), 'utf8'), `${logoNames[name]}.svg`);
}
const modes = (process.env.VR_BENCH_MODES ?? 'baseline,indexed,cached,combined').split(',');
assert(modes.every(mode => ['baseline', 'indexed', 'cached', 'combined', 'simplified'].includes(mode)) && modes.includes('baseline'));
const tolerance = Number(process.env.VR_BENCH_TOLERANCE ?? .001);
assert(Number.isFinite(tolerance) && tolerance >= 0 && tolerance <= .005);
const report = { baselineCommit, generatedAt: new Date().toISOString(), node: process.version, cpu: os.cpus()[0]?.model, seeds, repeats, modes, tolerance, description: '엔진 호출 전체 시간이며 UI와 메시지 복제는 제외한다. 기준 비교는 시간·기능 버전만 제외한다. 간략화 모드는 다른 배치를 허용하며 원본 로고 간격과 출력 보존을 별도로 검사한다.', cases: [], complete: false };
const filename = process.env.VR_BENCH_REPORT ?? 'benchmark.json';
assert(path.basename(filename) === filename);

for (const caseName of selected) {
  assert(Object.hasOwn(fixtures, caseName), `알 수 없는 사례: ${caseName}`);
  const settings = structuredClone(optimized.DEFAULT_SETTINGS);
  // 가져오기 기본값이 바뀌어도 기존 성능 비교의 최외곽·원본 조건은 유지한다.
  if (fixtures[caseName]) settings.artwork = { ...fixtures[caseName], avoidance: 'silhouette', contourMode: 'simplify', contourTolerance: 0 };
  if (process.env.VR_BENCH_DENSITY) settings.whiteRatio = Number(process.env.VR_BENCH_DENSITY);
  const cacheByMode = { cached: optimized.createArtworkPreparationCache(), combined: optimized.createArtworkPreparationCache(), simplified: optimized.createArtworkPreparationCache() };
  const item = { name: caseName, inputPoints: settings.artwork?.parts.flatMap(part => part.paths).reduce((sum, polygon) => sum + polygon.length, 0) ?? 0, footprintPoints: settings.artwork ? optimized.placeArtwork(settings.artwork, optimized.resolveCanvas(settings)).footprint.reduce((sum, polygon) => sum + polygon.length, 0) : 0, samples: [], preparation: [], summary: {}, exactModesIdentical: true };
  report.cases.push(item);
  await saveReport(report, filename);
  console.log(`측정 시작: ${caseName}, 보호 윤곽 ${item.footprintPoints}선분`);
  if (settings.artwork) {
    item.simplification = [];
    for (const contourTolerance of [.00025, .001, .0025]) {
      const start = performance.now();
      const prepared = optimized.createArtworkPreparationCache().prepare({ ...settings.artwork, contourTolerance }, optimized.resolveCanvas(settings));
      item.simplification.push({ contourTolerance, ...prepared.simplification, preparationMs: performance.now() - start });
    }
    console.log(JSON.stringify({ case: caseName, simplification: item.simplification }));
  }
  if (process.env.VR_BENCH_PREPARE_ONLY === '1') { await saveReport(report, filename); continue; }
  // 각 구현의 예열은 측정 표본에서 제외하고 반복 캐시도 별도로 시작한다.
  for (const mode of modes) {
    const context = mode === 'cached' ? { artworkCache: optimized.createArtworkPreparationCache(), usePreparedCollision: false } : undefined;
    const input = mode === 'simplified' && settings.artwork ? { ...settings, artwork: { ...settings.artwork, contourTolerance: tolerance } } : settings;
    await (mode === 'baseline' ? baseline : optimized).generatePattern(input, undefined, context);
  }
  for (let seed = 0; seed < seeds; seed++) for (let repeat = 0; repeat < repeats; repeat++) {
    const input = { ...settings, seed: `성능-${seed}` };
    let expected;
    const sample = { seed, repeat, modes: {} };
    item.samples.push(sample);
    // 실행 순서를 순환해 특정 구현에만 예열과 GC 순서가 유리하지 않게 한다.
    const order = modes.slice((seed + repeat) % modes.length).concat(modes.slice(0, (seed + repeat) % modes.length));
    const hashes = [];
    for (const mode of order) {
      globalThis.gc?.();
      const cache = cacheByMode[mode];
      const before = cache?.getStats();
      const start = performance.now();
      const actualInput = mode === 'simplified' && input.artwork ? { ...input, artwork: { ...input.artwork, contourTolerance: tolerance } } : input;
      const result = await (mode === 'baseline' ? baseline : optimized).generatePattern(actualInput, undefined, cache ? { artworkCache: cache, usePreparedCollision: mode !== 'cached' } : undefined);
      const elapsed = performance.now() - start;
      const hash = resultHash(result);
      if (mode !== 'simplified') hashes.push(hash); if (mode === 'baseline') expected = hash;
      let clearanceVerified = false;
      if (mode === 'simplified' && input.artwork) {
        const original = baseline.placeArtwork(input.artwork, result.canvas);
        assert.deepEqual(result.shapes.filter(shape => shape.kind === 'artwork'), original.shapes);
        for (const shape of result.shapes.filter(shape => shape.kind !== 'artwork')) assert(!baseline.pathsConflict(shape.footprint ?? shape.paths, original.footprint, input.gap), `${caseName}: 원본 로고와 최소 간격 위반`);
        clearanceVerified = true;
        if (seed === 0 && repeat === 0) await writeFile(path.join(output, `${caseName}-simplified.svg`), optimized.exportSvg(result), 'utf8');
      }
      sample.modes[mode] = { elapsedMs: elapsed, engineMs: result.elapsedMs, shapes: result.shapes.length, attempts: result.attempts, heapBytes: process.memoryUsage().heapUsed, version: result.version, hash, clearanceVerified, cacheBefore: before, cacheAfter: cache?.getStats() };
      if (Object.hasOwn(logoNames, caseName) || item.footprintPoints >= 5000) console.log(`진행: ${caseName}, 시드 ${seed}, ${mode}, ${(elapsed / 1000).toFixed(2)}초`);
    }
    assert(hashes.every(hash => hash === expected), `${caseName} 시드 ${seed}: 기존 결과와 불일치`);
    await saveReport(report, filename);
  }
  for (const mode of modes) item.summary[mode] = summary(item.samples.map(sample => sample.modes[mode].elapsedMs));
  if (settings.artwork) {
    const cache = optimized.createArtworkPreparationCache();
    for (const name of ['cold', 'warm', 'moved', 'resized', 'cleared']) {
      if (name === 'cleared') cache.clear();
      const artwork = { ...settings.artwork, ...(name === 'moved' ? { x: .4 } : {}), ...(name === 'resized' ? { widthRatio: .2 } : {}) };
      const start = performance.now();
      const prepared = cache.prepare(artwork, optimized.resolveCanvas(settings));
      const elapsedMs = performance.now() - start;
      const reference = baseline.placeArtwork(artwork, optimized.resolveCanvas(settings));
      assert.deepEqual({ shapes: prepared.shapes, footprint: prepared.footprint, inkArea: prepared.inkArea }, reference);
      item.preparation.push({ name, elapsedMs, stats: cache.getStats() });
    }
  }
  await saveReport(report, filename);
  console.log(JSON.stringify({ case: caseName, points: item.footprintPoints, summary: item.summary, exactModesIdentical: true }));
}
report.complete = true;
await saveReport(report, filename);
dom.window.close();
console.log(`성능 기록 저장: ${path.join(output, filename)}`);

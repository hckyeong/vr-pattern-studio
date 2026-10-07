import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { JSDOM } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'output/svg-performance');
const temporary = path.join(root, 'tmp/svg-performance');
const timeoutMs = Number(process.env.VR_BENCH_TIMEOUT_MS ?? 180000);
const seeds = Number(process.env.VR_BENCH_SEEDS ?? 5);
const reportName = process.env.VR_BENCH_REPORT ?? 'benchmark-logos-final.json';
const selectedModes = (process.env.VR_BENCH_MODES ?? 'simplified,combined,baseline').split(',');
const tolerances = { simplified: .001, fast: .0025 };
assert(Number.isInteger(timeoutMs) && timeoutMs > 0 && Number.isInteger(seeds) && seeds > 0);
assert(path.basename(reportName) === reportName && selectedModes.every(mode => ['baseline', 'combined', 'simplified', 'fast'].includes(mode)));
// 실제 코드를 다시 묶고 3단계의 포함 관계·선분 감소 검증 기록을 함께 갱신한다.
execFileSync(process.execPath, ['scripts/benchmark-svg.mjs'], { cwd: root, stdio: 'inherit', env: { ...process.env, VR_BENCH_CASES: 'bulguksa,crown,tombs', VR_BENCH_MODES: 'baseline,combined,simplified', VR_BENCH_PREPARE_ONLY: '1', VR_BENCH_REPORT: 'logo-preparation-check.json' } });
const baselineUrl = pathToFileURL(path.join(temporary, 'before/engine.mjs')).href;
const optimizedUrl = pathToFileURL(path.join(temporary, 'after/engine.mjs')).href;
const baseline = await import(baselineUrl);
const optimized = await import(optimizedUrl);
const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;
const wrapper = path.join(temporary, 'measurement-worker.mjs');
await writeFile(wrapper, `import { parentPort, workerData } from 'node:worker_threads';
const engine = await import(workerData.url);
const cache = engine.createArtworkPreparationCache?.();
// 준비된 별도 스레드에서 엔진 실행 구간만 재고 요청 사이 캐시는 유지한다.
parentPort.on('message', async input => {
  try {
    const cacheBefore = cache?.getStats();
    const start = performance.now();
    const result = await engine.generatePattern(input, undefined, cache ? { artworkCache: cache } : undefined);
    parentPort.postMessage({ type: 'result', result, elapsedMs: performance.now() - start, cacheBefore, cacheAfter: cache?.getStats(), heapBytes: process.memoryUsage().heapUsed });
  } catch (error) { parentPort.postMessage({ type: 'error', message: error.stack ?? String(error) }); }
});
parentPort.postMessage({ type: 'ready' });
`, 'utf8');

/** 엔진 로딩을 측정에서 제외하고 재사용할 스레드를 준비한다. */
function createMeasurementWorker(mode) {
  const worker = new Worker(pathToFileURL(wrapper), { workerData: { url: mode === 'baseline' ? baselineUrl : optimizedUrl }, execArgv: [] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); void worker.terminate(); reject(new Error('측정 워커 준비 시간 초과')); }, 10000);
    /** 준비 이벤트의 구독과 제한 시간을 정리한다. */
    function cleanup() { clearTimeout(timer); worker.off('message', message); worker.off('error', error); }
    /** 엔진 준비 완료 뒤 실제 측정을 허용한다. */
    function message(value) { if (value.type === 'ready') { cleanup(); resolve(worker); } }
    /** 준비 실패를 측정 오류로 전달한다. */
    function error(caught) { cleanup(); reject(caught); }
    worker.on('message', message); worker.on('error', error);
  });
}

/** 응답을 즉시 기록하고 제한 시간을 넘은 계산 스레드만 종료한다. */
function measure(worker, settings) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(async () => { cleanup(); await worker.terminate(); resolve({ status: 'timeout', limitMs: timeoutMs }); }, timeoutMs);
    /** 완료 또는 종료한 요청의 이벤트를 정리한다. */
    function cleanup() { clearTimeout(timer); worker.off('message', message); worker.off('error', error); worker.off('exit', exit); }
    /** 측정 응답에서 엔진 오류와 정상 결과를 구분한다. */
    function message(value) { cleanup(); if (value.type === 'error') reject(new Error(value.message)); else resolve({ status: 'completed', ...value }); }
    /** 스레드 오류를 검증 실패로 전달한다. */
    function error(caught) { cleanup(); reject(caught); }
    /** 응답 없이 스레드가 끝나면 결과 누락으로 처리한다. */
    function exit(code) { cleanup(); reject(new Error(`측정 워커가 응답 없이 종료됨: ${code}`)); }
    worker.on('message', message); worker.on('error', error); worker.on('exit', exit);
    worker.postMessage(settings);
  });
}

/** 시간과 기능 버전만 제외한 전체 결과의 해시를 만든다. */
function resultHash(result) { const { elapsedMs, version, ...rest } = result; return createHash('sha256').update(JSON.stringify(rest)).digest('hex'); }

/** 완료된 표본만 요약하고 시간 초과를 임의의 완료 시간으로 바꾸지 않는다. */
function summarize(samples) {
  const values = samples.filter(value => value.status === 'completed').map(value => value.elapsedMs).sort((a, b) => a - b);
  return { completed: values.length, timedOut: samples.filter(value => value.status === 'timeout').length, medianMs: values.length ? values[Math.floor(values.length / 2)] : null, minMs: values[0] ?? null, maxMs: values.at(-1) ?? null };
}

/** 부분 결과도 저장해 긴 기준 실행이 끝나지 않아도 측정 기록을 보존한다. */
async function save(report) { await writeFile(path.join(output, reportName), JSON.stringify(report, null, 2), 'utf8'); }

const report = { generatedAt: new Date().toISOString(), baselineCommit: '6a531ec112047a5893f84017fb99a3f70ca93ead', node: process.version, cpu: os.cpus()[0]?.model, timeoutMs, seeds, modes: selectedModes, tolerances, method: '구성별 별도 스레드, 가져오기·메시지 복제 제외한 엔진 실행 시간. 첫 시드는 새 캐시, 이후 시드는 같은 캐시. 별도 예열 없이 첫 생성도 포함. 시간 초과 구성은 해당 입력의 추가 반복 생략. 기본 회피는 silhouette, 로고 너비22%, 작업10000×4300mm, 여백58%, 간격35mm.', cases: [], complete: false };
const names = { bulguksa: '불국사', crown: '신라 금관', tombs: '고분과 꽃나무' };
try {
  for (const [key, name] of Object.entries(names)) {
    const settings = structuredClone(optimized.DEFAULT_SETTINGS);
    settings.artwork = optimized.importSvg(await readFile(path.join(output, 'logos', `${name}.svg`), 'utf8'), `${name}.svg`);
    // 앱의 가져오기 기본값 대신 기존 로고 비교에 명시된 원본 최외곽 조건을 사용한다.
    Object.assign(settings.artwork, { avoidance: 'silhouette', contourMode: 'simplify', contourTolerance: 0 });
    const original = baseline.placeArtwork(settings.artwork, optimized.resolveCanvas(settings));
    const item = { key, name, inputPoints: settings.artwork.parts.flatMap(part => part.paths).reduce((count, polygon) => count + polygon.length, 0), footprintPoints: original.footprint.reduce((count, polygon) => count + polygon.length, 0), samples: [], summary: {}, exactMatches: 0, exactComparisons: 0, allCompletedClearancesValid: true };
    report.cases.push(item); await save(report);
    const modes = selectedModes;
    const workers = new Map();
    const timedOut = new Set();
    try {
      for (const mode of modes) workers.set(mode, await createMeasurementWorker(mode));
      for (let seed = 0; seed < seeds; seed++) {
        const row = { seed, modes: {} };
        item.samples.push(row);
        const order = modes.slice(seed % modes.length).concat(modes.slice(0, seed % modes.length));
        for (const mode of order) {
          if (timedOut.has(mode)) { row.modes[mode] = { status: 'skippedAfterTimeout' }; continue; }
          const input = { ...settings, seed: `성능-${seed}`, ...(tolerances[mode] ? { artwork: { ...settings.artwork, contourTolerance: tolerances[mode] } } : {}) };
          console.log(`측정 시작: ${name}, 시드 ${seed}, ${mode}`);
          const measured = await measure(workers.get(mode), input);
          if (measured.status === 'timeout') {
            row.modes[mode] = measured; timedOut.add(mode);
            console.log(`시간 초과: ${name}, ${mode}, ${timeoutMs / 1000}초. 해당 구성의 추가 반복 생략`);
          } else {
            const { result } = measured;
            assert.deepEqual(result.shapes.filter(shape => shape.kind === 'artwork'), original.shapes);
            for (const shape of result.shapes.filter(shape => shape.kind !== 'artwork')) assert(!baseline.pathsConflict(shape.footprint ?? shape.paths, original.footprint, input.gap), `${name}: 원본 로고와 최소 간격 위반`);
            row.modes[mode] = { status: 'completed', elapsedMs: measured.elapsedMs, engineMs: result.elapsedMs, version: result.version, hash: resultHash(result), shapes: result.shapes.length, attempts: result.attempts, whiteRatio: result.whiteRatio, cacheBefore: measured.cacheBefore, cacheAfter: measured.cacheAfter, heapBytes: measured.heapBytes, clearanceVerified: true, originalArtworkPreserved: true };
            if (seed === 0 && mode !== 'baseline') await writeFile(path.join(output, `${key}-${mode}.svg`), optimized.exportSvg(result), 'utf8');
            console.log(`완료: ${name}, 시드 ${seed}, ${mode}, ${(measured.elapsedMs / 1000).toFixed(2)}초, 원본 간격 통과`);
          }
          await save(report);
        }
        if (row.modes.baseline?.status === 'completed' && row.modes.combined?.status === 'completed') {
          item.exactComparisons++;
          assert.equal(row.modes.baseline.hash, row.modes.combined.hash, `${name}: 정확 모드 기준 결과 불일치`);
          item.exactMatches++;
        }
      }
      for (const mode of modes) item.summary[mode] = summarize(item.samples.map(sample => sample.modes[mode]));
      console.log(JSON.stringify({ case: name, summary: item.summary, exactMatches: item.exactMatches }));
      await save(report);
    } finally { for (const worker of workers.values()) await worker.terminate(); }
  }
  report.complete = true;
} finally { await save(report); dom.window.close(); }

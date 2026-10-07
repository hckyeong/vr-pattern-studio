import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = path.join(root, 'tmp/svg-worker-verification');
const output = path.join(root, 'output/svg-performance');
await mkdir(temporary, { recursive: true });
await mkdir(output, { recursive: true });
await build({ configFile: false, logLevel: 'error', build: { ssr: path.join(root, 'src/workers/generator.worker.ts'), outDir: temporary, emptyOutDir: false, minify: false, rolldownOptions: { output: { entryFileNames: 'worker.mjs' } } } });
const wrapper = path.join(temporary, 'worker-thread.mjs');
await writeFile(wrapper, `import { parentPort } from 'node:worker_threads';
// 실제 생성 워커에 브라우저와 같은 복제 메시지 경계를 제공한다.
globalThis.self = { postMessage: message => parentPort.postMessage(message) };
await import('./worker.mjs');
parentPort.on('message', data => self.onmessage({ data }));
parentPort.postMessage({ type: 'ready' });
`, 'utf8');
const baseline = await import(pathToFileURL(path.join(root, 'tmp/svg-performance/before/engine.mjs')).href);
const settings = structuredClone(baseline.DEFAULT_SETTINGS);
Object.assign(settings, { width: 600, height: 400, minSize: 35, maxSize: 100, gap: 4, whiteRatio: .65 });
Object.assign(settings.markers, { count: 2, side: 18 });
settings.artwork = { name: '워커.svg', aspect: 1, x: .5, y: .5, widthRatio: .4, avoidance: 'silhouette', parts: [{ color: '#222222', paths: [[{ x: 0, y: 0 }, { x: .3, y: 0 }, { x: .3, y: .7 }, { x: 1, y: .7 }, { x: 1, y: 1 }, { x: 0, y: 1 }]] }] };

/** 워커 응답이나 오류를 제한 시간 안에 한 번만 기다린다. */
function response(worker, matches) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('워커 응답 시간 초과')); }, 30000);
    /** 완료된 요청의 이벤트 구독과 제한 시간을 정리한다. */
    function cleanup() { clearTimeout(timer); worker.off('message', message); worker.off('error', error); }
    /** 현재 요청의 완료 응답만 수신한다. */
    function message(value) { if (matches(value)) { cleanup(); resolve(value); } }
    /** 실행 오류는 검증 실패로 전달한다. */
    function error(caught) { cleanup(); reject(caught); }
    worker.on('message', message); worker.on('error', error);
  });
}

/** 시간과 기능 버전만 제외하고 실제 워커 출력과 기준 엔진 결과를 비교한다. */
function stable(result) { const { elapsedMs, version, ...rest } = result; return rest; }

const worker = new Worker(pathToFileURL(wrapper));
const evidence = { runtime: 'Node 별도 스레드의 실제 생성 워커와 구조화 복제', sequentialRequests: 0, matchingResults: 0, termination: false, complete: false };
try {
  await response(worker, value => value.type === 'ready');
  for (let requestId = 1; requestId <= 4; requestId++) {
    const input = { ...settings, seed: `워커-${requestId}` };
    const pending = response(worker, value => value.requestId === requestId && (value.type === 'result' || value.type === 'error'));
    worker.postMessage({ requestId, settings: input });
    const message = await pending;
    assert.equal(message.type, 'result', message.message);
    const reference = await baseline.generatePattern(input);
    assert.deepEqual(stable(message.value), stable(reference));
    evidence.sequentialRequests++; evidence.matchingResults++;
  }
  const firstProgress = response(worker, value => value.requestId === 5 && value.type === 'progress');
  worker.postMessage({ requestId: 5, settings: { ...settings, width: 10000, height: 4300, minSize: 15, maxSize: 40, gap: 1 } });
  await firstProgress;
  const started = performance.now();
  await worker.terminate();
  evidence.termination = true;
  evidence.terminationMs = performance.now() - started;
  evidence.complete = true;
} finally {
  await worker.terminate();
  await writeFile(path.join(output, 'worker-runtime.json'), JSON.stringify(evidence, null, 2), 'utf8');
}
console.log(JSON.stringify(evidence));

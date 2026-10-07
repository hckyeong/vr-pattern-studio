import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const before = await import(pathToFileURL(path.join(root, 'tmp/svg-performance/before/engine.mjs')).href);
const after = await import(pathToFileURL(path.join(root, 'tmp/svg-performance/after/engine.mjs')).href);
const canvas = after.resolveCanvas(after.DEFAULT_SETTINGS);

/** 여러 채움과 흰 덧칠을 가진 SVG의 전처리 비용을 재현한다. */
function multipartArtwork() {
  const parts = [];
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
    const left = x / 20, top = y / 20, size = .045;
    parts.push({ color: '#222222', paths: [[{ x: left, y: top }, { x: left + size, y: top }, { x: left + size, y: top + size }, { x: left, y: top + size }]] });
  }
  for (let index = 0; index < 20; index++) {
    const left = index / 20 + .01, top = .01;
    parts.push({ color: '#ffffff', paths: [[{ x: left, y: top }, { x: left + .02, y: top }, { x: left + .02, y: top + .02 }, { x: left, y: top + .02 }]] });
  }
  return { name: '복합-420도형.svg', aspect: 1, parts, x: .5, y: .5, widthRatio: .3, avoidance: 'silhouette' };
}

/** 첫 준비와 반복 준비를 같은 원본에 대해 비교한다. */
function measure(artwork, repetitions) {
  const samples = [];
  for (let iteration = 0; iteration < repetitions; iteration++) {
    globalThis.gc?.();
    const cache = after.createArtworkPreparationCache();
    let start = performance.now();
    const reference = before.placeArtwork(artwork, canvas);
    const baselineMs = performance.now() - start;
    start = performance.now();
    const cold = cache.prepare(artwork, canvas);
    const coldMs = performance.now() - start;
    start = performance.now();
    const warm = cache.prepare(artwork, canvas);
    const warmMs = performance.now() - start;
    for (const value of [cold, warm]) assert.deepEqual({ shapes: value.shapes, footprint: value.footprint, inkArea: value.inkArea }, reference);
    samples.push({ baselineMs, coldMs, warmMs, stats: cache.getStats() });
  }
  return samples;
}

/** 시간 표본의 중앙값을 계산한다. */
function median(values) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; }

const artwork = multipartArtwork();
// 최초 실행의 자바스크립트 예열 시간은 반복 비교에서 제외한다.
measure(artwork, 1);
const samples = measure(artwork, 25);
const cache = after.createArtworkPreparationCache();
const memory = [];
for (let round = 0; round < 60; round++) {
  const changed = structuredClone(artwork);
  changed.parts[0].paths[0][0].x = round / 100000;
  cache.prepare(changed, canvas);
  globalThis.gc?.();
  const stats = cache.getStats();
  assert(stats.artworkCount <= 2 && stats.retainedSegmentCount <= 80000);
  if (round % 5 === 0 || round === 59) memory.push({ round, heapBytes: process.memoryUsage().heapUsed, stats });
}
const report = { generatedAt: new Date().toISOString(), inputParts: artwork.parts.length, samples, summary: { baselineMs: median(samples.map(value => value.baselineMs)), coldMs: median(samples.map(value => value.coldMs)), warmMs: median(samples.map(value => value.warmMs)) }, memory, identical: true };
await writeFile(path.join(root, 'output/svg-performance/preparation.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ summary: report.summary, memoryStart: memory[2], memoryEnd: memory.at(-1), identical: report.identical }));

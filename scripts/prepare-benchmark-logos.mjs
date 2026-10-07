import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'output/imagegen/gyeongju-cultural-heritage-gti/svg-simplified');
const output = path.join(root, 'output/svg-performance/logos');
const entries = [
  ['불국사', 'exec-66a2f9a3-60eb-4f7c-aabf-ade1a5b8ac7f.svg'],
  ['신라 금관', 'exec-6df8f608-c913-451c-8a88-ede960716414.svg'],
  ['고분과 꽃나무', 'exec-9aa46e48-0b32-4a42-9bb7-cc27586aa2ed.svg'],
];
const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;
const temporary = path.join(root, 'tmp/svg-logo-input');
await mkdir(temporary, { recursive: true });
const entry = path.join(temporary, 'entry.ts');
await writeFile(entry, `export { importSvg } from ${JSON.stringify(path.join(root, 'src/core/importSvg.ts').replaceAll('\\', '/'))};\n`, 'utf8');
// 다른 벤치마크의 실행 이력 없이 현재 앱의 실제 파서로 입력을 검증한다.
await build({ configFile: false, logLevel: 'error', build: { ssr: entry, outDir: temporary, emptyOutDir: false, minify: false, rolldownOptions: { output: { entryFileNames: 'parser.mjs' } } } });
const { importSvg } = await import(pathToFileURL(path.join(temporary, 'parser.mjs')).href);
await mkdir(output, { recursive: true });
const report = [];

// 앱의 입력 상한에 맞게 기존에 변환한 투명 벡터를 계산 전후의 동일한 입력으로 사용한다.
for (const [name, filename] of entries) {
  const original = await readFile(path.join(source, filename), 'utf8');
  const document = new dom.window.DOMParser().parseFromString(original, 'image/svg+xml');
  assert.equal(document.querySelector('parsererror'), null);
  assert.equal(document.querySelector('image,script,foreignObject'), null);
  const background = document.querySelector('rect#background');
  if (background) {
    assert.equal(background.getAttribute('fill'), '#ffffff');
    background.remove();
  }
  assert.equal(document.querySelector('rect'), null);
  // 경로 데이터는 수정하지 않고 이름과 벤치마크 입력의 출처만 기록한다.
  const title = document.querySelector('title') ?? document.documentElement.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'title'));
  const description = document.querySelector('desc') ?? document.documentElement.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'desc'));
  title.textContent = name;
  description.textContent = '이미지에서 기존에 변환한 투명 배경 벡터이다. 이 벤치마크에서는 입력 경로를 그대로 유지하고 충돌 계산용 윤곽의 간략화 여부만 비교한다. 기존 벡터 변환 오차는 원본 이미지 기준 0.08픽셀이다.';
  const vector = new dom.window.XMLSerializer().serializeToString(document);
  const destination = path.join(output, `${name}.svg`);
  await writeFile(destination, vector, 'utf8');
  const artwork = importSvg(vector, `${name}.svg`);
  report.push({ name, source: path.relative(root, path.join(source, filename)), file: path.relative(root, destination), sourceHash: createHash('sha256').update(original).digest('hex'), hash: createHash('sha256').update(vector).digest('hex'), parts: artwork.parts.length, inputPoints: artwork.parts.flatMap(part => part.paths).reduce((sum, polygon) => sum + polygon.length, 0), transparentBackground: true, keptInputPaths: true, priorVectorizationTolerancePx: 0.08, bytes: Buffer.byteLength(vector) });
  console.log(JSON.stringify(report.at(-1)));
}
await writeFile(path.join(output, 'inputs.json'), JSON.stringify(report, null, 2), 'utf8');
dom.window.close();

// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { Preview } from '../src/ui/Preview';
import { DEFAULT_SETTINGS, resolveCanvas } from '../src/core/settings';
import { rectangle } from '../src/core/geometry';
import type { PatternResult, PatternSettings, SvgArtwork } from '../src/core/types';

const state = vi.hoisted(() => ({ initial: null as unknown, requests: [] as PatternSettings[] }));
vi.mock('../src/core/storage', () => ({ loadWorkspace: () => state.initial, saveWorkspace: vi.fn() }));
vi.mock('../src/core/workerClient', () => ({
  disposeGenerationWorker: vi.fn(),
  /** 화면 검증에서는 워커 결과를 비동기로 돌려주고 요청한 설정을 기록한다. */
  runGeneration: (settings: PatternSettings, _progress: unknown, complete: (value: PatternResult) => void) => {
    state.requests.push(structuredClone(settings));
    queueMicrotask(() => complete({ version: '검증', settings: structuredClone(settings), canvas: { width: settings.width, height: settings.height, physicalWidthMm: settings.width, physicalHeightMm: settings.height, lengthUnit: 'mm' }, shapes: [], whiteRatio: .8, targetReached: true, warnings: [], attempts: 0, elapsedMs: 0 }));
    return { cancel: vi.fn() };
  },
}));

let host: HTMLDivElement, root: Root;

/** 화면 조작에 사용할 독립적인 정사각형 원고를 만든다. */
function artwork(name: string, x = .5): SvgArtwork {
  return { name, aspect: 1, x, y: .5, widthRatio: .2, avoidance: 'silhouette', parts: [{ color: '#000000', paths: rectangle(0, 0, 1, 1) }] };
}

/** 생성 계산 없이 편집 화면을 열 수 있는 완료 시안을 만든다. */
function result(settings: PatternSettings): PatternResult {
  return { version: '검증', settings, canvas: resolveCanvas(settings), shapes: [], whiteRatio: .8, targetReached: true, warnings: [], attempts: 0, elapsedMs: 0 };
}

/** 조작 좌표계와 읽기 완료 상태를 매 검증마다 초기화한다. */
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('ResizeObserver', class {
    /** 화면 크기는 고정된 테스트 뷰포트에서 초기 측정한다. */
    observe() {}
    /** 테스트 해제 시 관찰 리소스를 정리한다. */
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  const settings = { ...structuredClone(DEFAULT_SETTINGS), width: 1000, height: 600, artwork: artwork('기존.svg') };
  state.initial = { settings, results: [result(settings)] }; state.requests = [];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});

/** 각 테스트의 컴포넌트와 전역 대역을 제거한다. */
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** 표시 문구가 일치하는 버튼을 찾아 클릭한다. */
async function clickText(text: string) {
  const button = Array.from(host.querySelectorAll('button')).find(button => button.textContent === text);
  expect(button).toBeTruthy(); await act(async () => button!.click());
}

/** 파일 추가 또는 교체 이벤트로 SVG의 비동기 읽기를 진행한다. */
async function upload(contents: string[], label = 'SVG 파일 추가') {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  const files = contents.map((text, index) => {
    const file = new File([text], `추가${index + 1}.svg`, { type: 'image/svg+xml' });
    Object.defineProperty(file, 'text', { value: async () => text }); return file;
  });
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
}

/** 화면 포인터 이벤트를 전달해 실제 드래그 처리와 상태 갱신을 실행한다. */
async function pointer(target: Element, type: string, x: number, y: number, shiftKey = false) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, shiftKey });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  await act(async () => { target.dispatchEvent(event); });
}

describe('복수 SVG 설정 화면', () => {
  it('추가·교체에 기본 회피 옵션을 적용하고 기존 그림과 교체 위치를 유지한다', async () => {
    await act(async () => root.render(<App />));
    expect(host.querySelector('input[aria-label="SVG 파일 추가"]')?.hasAttribute('multiple')).toBe(true);
    await upload(['<svg><rect width="10" height="20"/></svg>', '<svg><circle cx="5" cy="5" r="5"/></svg>']);
    const next = state.requests.at(-1)!;
    expect(next.artwork).toBeUndefined(); expect(next.artworks?.map(item => item.name)).toEqual(['기존.svg', '추가1.svg', '추가2.svg']);
    expect(host.querySelectorAll('.artwork-list li')).toHaveLength(3);
    expect(host.querySelector('.artwork-select[aria-pressed="true"]')?.textContent).toContain('추가1.svg');
    for (const item of next.artworks!.slice(1)) expect(item).toMatchObject({ avoidance: 'outline', contourMode: 'simplify', contourTolerance: .001 });
    expect(next.artworks![0].avoidance).toBe('silhouette');
    await act(async () => host.querySelector<HTMLButtonElement>('.artwork-select')!.click());
    await upload(['<svg><rect width="10" height="10"/></svg>'], '선택한 SVG 교체');
    expect(state.requests.at(-1)?.artworks?.[0]).toMatchObject({ avoidance: 'outline', contourMode: 'simplify', contourTolerance: .001, x: next.artworks![0].x, y: next.artworks![0].y, widthRatio: next.artworks![0].widthRatio });
  });

  it('선택한 파일 중 하나가 잘못되면 일부만 추가하지 않고 기존 원고를 유지한다', async () => {
    await act(async () => root.render(<App />));
    await upload(['<svg><rect width="10" height="20"/></svg>', '<svg><script>alert(1)</script></svg>']);
    expect(state.requests).toHaveLength(0);
    expect(host.querySelectorAll('.artwork-list li')).toHaveLength(1);
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('선택한 그림만 회전·삭제하고 다른 그림의 설정을 유지한다', async () => {
    const settings = { ...structuredClone(DEFAULT_SETTINGS), width: 1000, height: 600, artworks: [artwork('첫째.svg', .25), artwork('둘째.svg', .75)] };
    state.initial = { settings, results: [result(settings)] };
    await act(async () => root.render(<App />));
    await act(async () => (host.querySelectorAll<HTMLButtonElement>('.artwork-select')[1]).click());
    await clickText('+15°');
    expect(state.requests.at(-1)?.artworks?.[0]).toEqual(settings.artworks[0]);
    expect(state.requests.at(-1)?.artworks?.[1].rotation).toBe(15);
    expect(host.querySelector<HTMLInputElement>('input[aria-label="SVG 회전 각도"]')?.value).toBe('15');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="2번 SVG 삭제"]')!.click());
    expect(state.requests.at(-1)?.artworks).toEqual([settings.artworks[0]]);
  });

  it('수동 모드에서는 회전 즉시 저장을 막고 재생성 완료 후 다시 허용한다', async () => {
    await act(async () => root.render(<App />));
    expect(host.querySelector('.artwork-handle.selected')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('.artwork-select')!.click());
    const toggle = Array.from(host.querySelectorAll('label')).find(label => label.textContent === '이동 후 자동 재배치')!.querySelector<HTMLInputElement>('input')!;
    await act(async () => toggle.click());
    await clickText('+15°'); expect(state.requests).toHaveLength(0);
    const save = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '벡터 저장')!;
    expect(save.disabled).toBe(true);
    await clickText('패턴 생성'); expect(state.requests.at(-1)?.artworks?.[0].rotation).toBe(15);
    expect(save.disabled).toBe(false);
  });
});

describe('캔버스 SVG 선택과 회전 손잡이', () => {
  it('두 번째 그림만 드래그하고 회전 후 크기 조절 축도 함께 회전한다', async () => {
    const committed = vi.fn(), changed = vi.fn();
    const initial = [artwork('첫째.svg', .3), artwork('둘째.svg', .7)];
    const settings = { ...structuredClone(DEFAULT_SETTINGS), width: 1000, height: 600, artworks: initial };
    /** 미선택 상태부터 선택·직접 조작·선택 해제까지 부모 상태에 반영한다. */
    function Harness() {
      const [items, setItems] = useState(initial), [selected, setSelected] = useState(-1);
      return <Preview result={result(settings)} artworks={items} selectedArtwork={selected} onArtworkSelect={setSelected} onArtworkChange={(item, index) => { changed(item, index); setItems(previous => previous.map((old, position) => position === index ? item : old)); }} onArtworkCommit={committed} />;
    }
    await act(async () => root.render(<Harness />));
    expect(host.querySelector('.artwork-handle-label, [data-rotate], [data-resize]')).toBeNull();
    const second = host.querySelector('[data-artwork-handle="1"]')!, preview = host.querySelector('.preview')!;
    await pointer(second, 'pointerdown', 536.8, 300);
    await pointer(preview, 'pointermove', 571, 300);
    await pointer(preview, 'pointerup', 571, 300);
    expect(committed.mock.lastCall![1]).toBe(1); expect(committed.mock.lastCall![0].x).toBeCloseTo(.75);
    expect(host.querySelectorAll('.artwork-handle-label')).toHaveLength(1);
    expect(host.querySelector('.artwork-handle-label')?.textContent).toContain('둘째.svg');
    expect(host.querySelector('[data-artwork-handle="0"]')?.getAttribute('aria-pressed')).toBe('false');
    const rotate = host.querySelector('[data-rotate]')!;
    await pointer(rotate, 'pointerdown', 571, 186.6);
    await pointer(preview, 'pointermove', 684.4, 300, true);
    await pointer(preview, 'pointerup', 684.4, 300);
    expect(committed.mock.lastCall![0].rotation).toBeCloseTo(90);
    await pointer(host.querySelector('[data-resize]')!, 'pointerdown', 502.6, 368.4);
    await pointer(preview, 'pointermove', 468.4, 402.6);
    await pointer(preview, 'pointerup', 468.4, 402.6);
    expect(committed.mock.lastCall![0].widthRatio).toBeCloseTo(.3);
    expect(committed.mock.lastCall![0].rotation).toBeCloseTo(90);
    expect(changed.mock.calls.every(call => call[1] === 1)).toBe(true);
    await pointer(preview, 'pointerdown', 20, 20);
    await pointer(preview, 'pointerup', 20, 20);
    expect(host.querySelector('.artwork-handle.selected, .artwork-handle-label, [data-rotate], [data-resize]')).toBeNull();
    expect(committed).toHaveBeenCalledTimes(3);
  });
});

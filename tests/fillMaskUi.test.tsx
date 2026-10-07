// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { DEFAULT_SETTINGS, resolveCanvas } from '../src/core/settings';
import { rectangle } from '../src/core/geometry';
import type { FillMask, PatternResult, PatternSettings } from '../src/core/types';

const state = vi.hoisted(() => ({ initial: null as unknown, requests: [] as PatternSettings[], complete: null as null | ((result: PatternResult) => void), read: vi.fn() }));
vi.mock('../src/core/storage', () => ({ loadWorkspace: () => state.initial, saveWorkspace: vi.fn() }));
vi.mock('../src/core/importMask', () => ({ importMask: state.read }));
vi.mock('../src/core/workerClient', () => ({
  disposeGenerationWorker: vi.fn(),
  /** 생성 완료를 직접 전달하는 대역으로 저장 대기 상태를 검사한다. */
  runGeneration: (settings: PatternSettings, _progress: unknown, complete: (result: PatternResult) => void) => {
    state.requests.push(structuredClone(settings)); state.complete = complete; return { cancel: vi.fn() };
  },
}));
let host: HTMLDivElement, root: Root;
const mask: FillMask = { name: '영역.png', aspect: .5, width: 4, height: 2, threshold: 200, fit: 'contain', paths: rectangle(0,0,.5,1) };

/** 결과를 직접 만들어 생성 대기와 완료의 화면 동작만 독립적으로 검사한다. */
function result(settings: PatternSettings): PatternResult {
  return { version: '검증', settings, canvas: resolveCanvas(settings), shapes: [], whiteRatio: .7, targetReached: true, attempts: 0, warnings: [], elapsedMs: 1 };
}

/** 캔버스와 이미지 디코딩을 분리한 편집 화면을 매 검증마다 초기화한다. */
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('ResizeObserver', class {
    /** 크기가 고정된 검증 화면의 관찰을 시작한다. */
    observe() {}
    /** 화면 해제 시 관찰을 종료한다. */
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  state.initial = { settings: structuredClone(DEFAULT_SETTINGS), results: [result(structuredClone(DEFAULT_SETTINGS))] };
  state.requests = []; state.complete = null; state.read.mockReset().mockResolvedValue(structuredClone(mask));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<App />));
});

/** 컴포넌트와 브라우저 대역을 정리해 다음 검증에 상태가 남지 않게 한다. */
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** 파일 입력의 변경 이벤트를 통해 실제 앱의 비동기 가져오기를 시작한다. */
async function upload() {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="채울 영역 이미지"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['사진'], '영역.png', { type: 'image/png' })] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}

/** 현재 요청한 시안의 완료를 앱에 전달한다. */
async function finish() { await act(async () => state.complete!(result(state.requests.at(-1)!))); }

/** 화면 문구가 일치하는 버튼을 조회한다. */
function button(label: string): HTMLButtonElement { return Array.from(host.querySelectorAll('button')).find(item => item.textContent === label)!; }

describe('흑백 사진 채움 영역 화면', () => {
  it('불러오기·맞춤 변경·제거를 재생성과 저장 대기에 연결한다', async () => {
    await upload(); expect(state.requests.at(-1)?.fillMask).toEqual(mask);
    expect(host.querySelector('.mask-thumbnail')).not.toBeNull(); expect(button('벡터 저장').disabled).toBe(true);
    await finish(); expect(button('벡터 저장').disabled).toBe(false); expect(host.textContent).toContain('흰 영역 내 여백');
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="채움 영역 맞춤"]')!;
    await act(async () => { select.value = 'stretch'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(state.requests.at(-1)?.fillMask?.fit).toBe('stretch'); await finish();
    await act(async () => button('채움 영역 제거').click()); expect(state.requests.at(-1)?.fillMask).toBeUndefined();
    await finish(); expect(host.querySelector('.mask-thumbnail')).toBeNull(); expect(button('벡터 저장').disabled).toBe(false);
  });

  it('이미지 오류면 이전 채움 영역과 완료 시안을 보존한다', async () => {
    await upload(); await finish(); state.read.mockRejectedValueOnce(new Error('채울 흰색 영역이 없습니다.'));
    await upload(); expect(state.requests).toHaveLength(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('흰색 영역이 없습니다');
    expect(host.querySelector('.mask-thumbnail')).not.toBeNull(); expect(button('벡터 저장').disabled).toBe(false);
  });

  it('읽는 중 다른 시안을 선택하면 늦게 도착한 이미지를 적용하지 않는다', async () => {
    let resolve!: (value: FillMask) => void;
    state.read.mockReturnValueOnce(new Promise<FillMask>(done => { resolve = done; }));
    await upload(); expect(button('벡터 저장').disabled).toBe(true);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="시안 1 선택"]')!.click());
    await act(async () => resolve(mask));
    expect(state.requests).toHaveLength(0); expect(host.querySelector('.mask-thumbnail')).toBeNull(); expect(button('벡터 저장').disabled).toBe(false);
  });
});

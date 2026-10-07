import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, resolveCanvas } from '../src/core/settings';
import type { GenerationProgress, PatternResult, WorkerRequest } from '../src/core/types';

interface WorkerScopeDouble {
  onmessage: ((event: { data: unknown }) => Promise<void>) | null;
  postMessage: ReturnType<typeof vi.fn>;
}

const state = vi.hoisted(() => ({
  generate: vi.fn(),
  /** 모듈을 새로 만들 때마다 독립적인 캐시 객체를 제공한다. */
  createCache: vi.fn(() => ({ entries: [] as unknown[] })),
}));
vi.mock('../src/core/generator', () => ({ generatePattern: state.generate }));
vi.mock('../src/core/preparedArtwork', () => ({ createArtworkPreparationCache: state.createCache }));

let scope: WorkerScopeDouble;
const progress: GenerationProgress = { progress: 0.5, phase: '배치 중', placed: 5, whiteRatio: 0.8 };

/** 워커 메시지 검증에 사용할 독립적인 결과를 만든다. */
function resultOf(): PatternResult {
  const settings = structuredClone(DEFAULT_SETTINGS);
  return { version: '검증', settings, canvas: resolveCanvas(settings), shapes: [], whiteRatio: 0.8, targetReached: true, attempts: 5, warnings: [], elapsedMs: 1 };
}

/** 워커 모듈과 전역 통신 객체를 검증마다 독립적으로 초기화한다. */
beforeEach(async () => {
  vi.resetModules();
  state.generate.mockReset().mockResolvedValue(resultOf());
  state.createCache.mockClear();
  scope = { onmessage: null, postMessage: vi.fn() };
  vi.stubGlobal('self', scope);
  await import('../src/workers/generator.worker');
});

/** 가짜 워커 전역 객체를 제거해 다른 검증에 영향을 주지 않는다. */
afterEach(() => vi.unstubAllGlobals());

/** 검증용 요청 메시지를 모듈에 전달한다. */
async function request(requestId: number): Promise<void> {
  const data: WorkerRequest = { requestId, settings: structuredClone(DEFAULT_SETTINGS) };
  await scope.onmessage!({ data });
}

describe('재사용 생성 워커의 요청 처리', () => {
  it('정상 완료한 두 요청에 같은 모듈 캐시를 전달한다', async () => {
    await request(1); await request(2);
    expect(state.createCache).toHaveBeenCalledOnce();
    expect(state.generate).toHaveBeenCalledTimes(2);
    const cache = state.createCache.mock.results[0].value;
    expect(state.generate.mock.calls[0][2]).toEqual({ artworkCache: cache });
    expect(state.generate.mock.calls[1][2].artworkCache).toBe(cache);
    expect(scope.postMessage.mock.calls.map(([message]) => message.requestId)).toEqual([1, 2]);
  });

  it('진행 메시지와 결과 메시지에 요청 식별자를 보존한다', async () => {
    const result = resultOf();
    /** 생성 중 진행 콜백과 최종 결과를 순서대로 재현한다. */
    state.generate.mockImplementationOnce(async (_settings, onProgress: (value: GenerationProgress) => void) => {
      onProgress(progress);
      return result;
    });
    await request(23);
    expect(scope.postMessage.mock.calls).toEqual([
      [{ requestId: 23, type: 'progress', value: progress }],
      [{ requestId: 23, type: 'result', value: result }],
    ]);
  });

  it('생성이 대기 중일 때 두 번째 요청으로 동시 생성을 시작하지 않는다', async () => {
    let complete!: (result: PatternResult) => void;
    /** 첫 생성의 완료 시점을 명시적으로 제어한다. */
    state.generate.mockImplementationOnce(() => new Promise<PatternResult>(resolve => { complete = resolve; }));
    const first = request(1);
    await request(2);
    expect(state.generate).toHaveBeenCalledOnce();
    expect(scope.postMessage).toHaveBeenCalledWith({ requestId: 2, type: 'error', message: '이미 패턴 생성 작업이 진행 중입니다. 현재 작업이 끝난 뒤 다시 시도해 주세요.' });
    complete(resultOf());
    await first;
    await request(3);
    expect(state.generate).toHaveBeenCalledTimes(2);
    expect(scope.postMessage.mock.calls.at(-1)![0]).toMatchObject({ requestId: 3, type: 'result' });
  });

  it('설정 검증의 구체적인 오류를 반환하고 다음 요청은 실행한다', async () => {
    await scope.onmessage!({ data: { requestId: 4, settings: { ...DEFAULT_SETTINGS, width: 0 } } });
    expect(state.generate).not.toHaveBeenCalled();
    expect(scope.postMessage.mock.calls[0][0]).toMatchObject({ requestId: 4, type: 'error' });
    expect(scope.postMessage.mock.calls[0][0].message).toContain('가로');
    await request(5);
    expect(state.generate).toHaveBeenCalledOnce();
  });

  it('생성기 예외의 구체적인 메시지를 보존하고 실행 상태를 해제한다', async () => {
    state.generate.mockRejectedValueOnce(new Error('마커를 배치할 수 없습니다.'));
    await request(6);
    expect(scope.postMessage).toHaveBeenCalledWith({ requestId: 6, type: 'error', message: '마커를 배치할 수 없습니다.' });
    await request(7);
    expect(state.generate).toHaveBeenCalledTimes(2);
    expect(scope.postMessage.mock.calls.at(-1)![0]).toMatchObject({ requestId: 7, type: 'result' });
  });

  it.each([null, [], {}, { requestId: 0, settings: DEFAULT_SETTINGS }, { requestId: -1, settings: DEFAULT_SETTINGS }, { requestId: 1.5, settings: DEFAULT_SETTINGS }, { requestId: '1', settings: DEFAULT_SETTINGS }, { requestId: 1 }])('잘못된 요청 봉투는 생성하지 않고 오류를 보낸다: %j', async data => {
    await scope.onmessage!({ data });
    expect(state.generate).not.toHaveBeenCalled();
    expect(scope.postMessage).toHaveBeenCalledWith({ requestId: 0, type: 'error', message: '패턴 생성 요청의 형식이나 작업 번호가 올바르지 않습니다.' });
  });

  it('설정이 없는 요청도 구체적인 검증 오류로 처리한다', async () => {
    await scope.onmessage!({ data: { requestId: 8, settings: null } });
    expect(state.generate).not.toHaveBeenCalled();
    expect(scope.postMessage).toHaveBeenCalledWith({ requestId: 8, type: 'error', message: '설정 형식이 올바르지 않습니다.' });
  });
});

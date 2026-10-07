import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disposeGenerationWorker, runGeneration } from '../src/core/workerClient';
import { DEFAULT_SETTINGS, resolveCanvas } from '../src/core/settings';
import type { GenerationProgress, PatternResult, WorkerRequest, WorkerResponse } from '../src/core/types';

interface WorkerDouble {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { preventDefault(): void; message?: string }) => void) | null;
  onmessageerror: (() => void) | null;
  terminate: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
}
const state = vi.hoisted(() => ({ instances: [] as WorkerDouble[], constructorFails: false, sendFails: false }));
vi.mock('../src/workers/generator.worker?worker&inline', () => ({
  default: class {
    onmessage = null;
    onerror = null;
    onmessageerror = null;
    terminate = vi.fn();
    // 시작 메시지를 전달하지 못하는 브라우저 오류를 재현한다.
    postMessage = vi.fn(() => { if (state.sendFails) throw new Error('전달 실패'); });
    /** 워커 생성 실패 또는 정상 실행 객체를 재현한다. */
    constructor() { if (state.constructorFails) throw new Error('시작 실패'); state.instances.push(this); }
  },
}));

/** 검증 간 가짜 워커의 실패 조건과 인스턴스를 격리한다. */
beforeEach(() => { disposeGenerationWorker(); state.instances.length = 0; state.constructorFails = false; state.sendFails = false; });
/** 검증 뒤에는 완료한 워커까지 해제해 다음 검증에 캐시가 남지 않게 한다. */
afterEach(() => disposeGenerationWorker());

const progress: GenerationProgress = { progress: 0.5, phase: '배치 중', placed: 5, whiteRatio: 0.8 };
type ResponsePayload =
  | { type: 'progress'; value: GenerationProgress }
  | { type: 'result'; value: PatternResult }
  | { type: 'error'; message: string };

/** 워커가 마지막으로 전달받은 요청의 식별자를 읽는다. */
function requestOf(worker: WorkerDouble): WorkerRequest {
  return worker.postMessage.mock.calls.at(-1)![0] as WorkerRequest;
}

/** 정상 생성 완료 메시지에 사용할 결과를 만든다. */
function resultOf(seed = DEFAULT_SETTINGS.seed): PatternResult {
  const settings = { ...DEFAULT_SETTINGS, seed };
  return { version: '검증', settings, canvas: resolveCanvas(settings), shapes: [], whiteRatio: 0.8, targetReached: true, attempts: 5, warnings: [], elapsedMs: 1 };
}

/** 가짜 워커에서 지정한 요청 번호의 응답을 전달한다. */
function respond(worker: WorkerDouble, payload: ResponsePayload, requestId = requestOf(worker).requestId): void {
  const data: WorkerResponse = { requestId, ...payload };
  worker.onmessage?.({ data });
}

describe('생성 워커의 오류와 종료 처리', () => {
  // 실제 작업 오류는 입력 문제와 실행 문제를 구분하여 전달한다.
  it('작업자가 반환한 구체적인 오류를 보존하고 워커를 해제한다', () => {
    const error = vi.fn();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), vi.fn(), error);
    const worker = state.instances[0];
    respond(worker, { type: 'error', message: '마커를 배치할 수 없습니다.' });
    expect(error).toHaveBeenCalledWith('마커를 배치할 수 없습니다.');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
  });
  // 실행 파일 누락처럼 입력값과 관계없는 오류에 재입력을 요구하지 않는다.
  it('브라우저 실행 실패를 한 번만 알리고 진행 상태를 끝낸다', () => {
    const error = vi.fn();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), vi.fn(), error);
    const worker = state.instances[0], handler = worker.onerror!, preventDefault = vi.fn();
    handler({ preventDefault }); handler({ preventDefault });
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0]).toContain('생성기를 실행');
    expect(error.mock.calls[0][0]).not.toContain('입력값');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  // 생성자 예외가 화면의 생성 중 상태를 무한히 유지하지 않아야 한다.
  it('워커 생성자가 실패해도 예외를 밖으로 던지지 않고 오류를 알린다', async () => {
    state.constructorFails = true; const error = vi.fn();
    expect(() => runGeneration(DEFAULT_SETTINGS, vi.fn(), vi.fn(), error)).not.toThrow();
    await Promise.resolve();
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0]).toContain('시작하지 못했습니다');
  });
  // 데이터 복제나 전달 실패도 만들어진 워커를 해제한다.
  it('초기 메시지 전달에 실패하면 워커를 종료하고 오류를 알린다', async () => {
    state.sendFails = true; const error = vi.fn();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), vi.fn(), error);
    expect(state.instances[0].terminate).toHaveBeenCalledOnce();
    expect(state.instances[0].onmessage).toBeNull();
    await Promise.resolve();
    expect(error).toHaveBeenCalledOnce();
    expect(state.instances[0].terminate).toHaveBeenCalledOnce();
  });
  // 브라우저가 결과 메시지를 복원하지 못해도 작업이 끝나야 한다.
  it('결과 수신 실패 시 오류를 전달한다', () => {
    const error = vi.fn(); runGeneration(DEFAULT_SETTINGS, vi.fn(), vi.fn(), error);
    state.instances[0].onmessageerror?.();
    expect(error).toHaveBeenCalledWith('생성 결과를 읽지 못했습니다. 다시 생성해 주세요.');
  });
  // 취소한 작업의 뒤늦은 실패는 새 작업에 영향을 주지 않는다.
  it('실패 알림 전에 취소한 작업은 오류를 전달하지 않는다', async () => {
    state.constructorFails = true; const error = vi.fn();
    const job = runGeneration(DEFAULT_SETTINGS, vi.fn(), vi.fn(), error); job.cancel();
    await Promise.resolve();
    expect(error).not.toHaveBeenCalled();
  });
});

describe('생성 워커의 재사용과 작업 식별', () => {
  it('정상 완료 뒤 다음 생성에 같은 워커를 재사용하고 요청 번호를 바꾼다', () => {
    const first = vi.fn(), second = vi.fn(), error = vi.fn();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), first, error);
    const worker = state.instances[0], request = requestOf(worker), result = resultOf();
    expect(request.settings).toBe(DEFAULT_SETTINGS);
    respond(worker, { type: 'result', value: result });
    expect(first).toHaveBeenCalledWith(result);
    expect(worker.terminate).not.toHaveBeenCalled();
    runGeneration({ ...DEFAULT_SETTINGS, seed: '두 번째' }, vi.fn(), second, error);
    expect(state.instances).toHaveLength(1);
    expect(requestOf(worker).requestId).not.toBe(request.requestId);
    const next = resultOf('두 번째');
    respond(worker, { type: 'result', value: next });
    expect(second).toHaveBeenCalledWith(next);
    expect(error).not.toHaveBeenCalled();
  });

  it('취소하면 즉시 종료하고 다음 생성에는 새 워커를 만든다', () => {
    const job = runGeneration(DEFAULT_SETTINGS, vi.fn(), vi.fn(), vi.fn());
    const worker = state.instances[0];
    job.cancel(); job.cancel();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), vi.fn(), vi.fn());
    expect(state.instances).toHaveLength(2);
  });

  it('실행 중인 작업을 새 요청이 대체하면 이전 워커를 종료한다', () => {
    const firstResult = vi.fn(), firstError = vi.fn();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), firstResult, firstError);
    const worker = state.instances[0], handler = worker.onmessage!, request = requestOf(worker);
    const nextResult = vi.fn();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), nextResult, vi.fn());
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(state.instances).toHaveLength(2);
    handler({ data: { requestId: request.requestId, type: 'result', value: resultOf() } });
    expect(firstResult).not.toHaveBeenCalled();
    expect(firstError).not.toHaveBeenCalled();
    expect(nextResult).not.toHaveBeenCalled();
    respond(state.instances[1], { type: 'result', value: resultOf() });
    expect(nextResult).toHaveBeenCalledOnce();
  });

  it('재사용한 워커의 이전 요청 응답은 다음 작업에 전달하지 않는다', () => {
    const firstResult = vi.fn();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), firstResult, vi.fn());
    const worker = state.instances[0], oldId = requestOf(worker).requestId;
    respond(worker, { type: 'result', value: resultOf() });
    const nextProgress = vi.fn(), nextResult = vi.fn(), nextError = vi.fn();
    runGeneration(DEFAULT_SETTINGS, nextProgress, nextResult, nextError);
    respond(worker, { type: 'progress', value: progress }, oldId);
    respond(worker, { type: 'result', value: resultOf() }, oldId);
    respond(worker, { type: 'error', message: '이전 작업 오류' }, oldId);
    worker.onmessage?.({ data: { requestId: oldId, type: '알 수 없는 이전 응답' } });
    expect(nextProgress).not.toHaveBeenCalled();
    expect(nextResult).not.toHaveBeenCalled();
    expect(nextError).not.toHaveBeenCalled();
    expect(worker.terminate).not.toHaveBeenCalled();
    respond(worker, { type: 'progress', value: progress });
    respond(worker, { type: 'result', value: resultOf() });
    expect(nextProgress).toHaveBeenCalledWith(progress);
    expect(nextResult).toHaveBeenCalledOnce();
    expect(firstResult).toHaveBeenCalledOnce();
  });

  it('완료한 작업의 취소는 대기 중인 워커와 다음 작업에 영향을 주지 않는다', () => {
    const job = runGeneration(DEFAULT_SETTINGS, vi.fn(), vi.fn(), vi.fn());
    const worker = state.instances[0];
    respond(worker, { type: 'result', value: resultOf() });
    job.cancel();
    expect(worker.terminate).not.toHaveBeenCalled();
    const nextResult = vi.fn();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), nextResult, vi.fn());
    job.cancel();
    expect(state.instances).toHaveLength(1);
    expect(worker.terminate).not.toHaveBeenCalled();
    respond(worker, { type: 'result', value: resultOf() });
    expect(nextResult).toHaveBeenCalledOnce();
  });

  it('취소한 작업의 뒤늦은 취소와 이벤트는 새 워커에 영향을 주지 않는다', () => {
    const oldError = vi.fn(), job = runGeneration(DEFAULT_SETTINGS, vi.fn(), vi.fn(), oldError);
    const worker = state.instances[0], message = worker.onmessage!, error = worker.onerror!, messageerror = worker.onmessageerror!;
    job.cancel();
    const nextError = vi.fn();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), vi.fn(), nextError);
    const nextWorker = state.instances[1];
    job.cancel();
    message({ data: null }); error({ preventDefault: vi.fn() }); messageerror();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(nextWorker.terminate).not.toHaveBeenCalled();
    expect(oldError).not.toHaveBeenCalled();
    expect(nextError).not.toHaveBeenCalled();
  });

  it('결과 콜백에서 시작하는 다음 생성은 같은 워커에서 완료된다', () => {
    const nextResult = vi.fn(), nextError = vi.fn();
    const job = runGeneration(DEFAULT_SETTINGS, vi.fn(), () => {
      runGeneration(DEFAULT_SETTINGS, vi.fn(), nextResult, nextError);
    }, vi.fn());
    const worker = state.instances[0], oldId = requestOf(worker).requestId;
    respond(worker, { type: 'result', value: resultOf() });
    expect(state.instances).toHaveLength(1);
    expect(requestOf(worker).requestId).not.toBe(oldId);
    job.cancel();
    respond(worker, { type: 'result', value: resultOf() });
    expect(nextResult).toHaveBeenCalledOnce();
    expect(nextError).not.toHaveBeenCalled();
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it('오류 콜백에서 새 생성을 시작해도 새 작업을 해제하지 않는다', () => {
    const nextResult = vi.fn(), nextError = vi.fn();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), vi.fn(), () => {
      runGeneration(DEFAULT_SETTINGS, vi.fn(), nextResult, nextError);
    });
    const worker = state.instances[0];
    respond(worker, { type: 'error', message: '배치 실패' });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(state.instances).toHaveLength(2);
    respond(state.instances[1], { type: 'result', value: resultOf() });
    expect(nextResult).toHaveBeenCalledOnce();
    expect(nextError).not.toHaveBeenCalled();
  });

  it('초기 전달 실패 콜백에서도 새 작업을 정상적으로 시작한다', async () => {
    state.sendFails = true;
    const nextResult = vi.fn(), nextError = vi.fn();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), vi.fn(), () => {
      state.sendFails = false;
      runGeneration(DEFAULT_SETTINGS, vi.fn(), nextResult, nextError);
    });
    await Promise.resolve();
    expect(state.instances).toHaveLength(2);
    expect(state.instances[0].terminate).toHaveBeenCalledOnce();
    respond(state.instances[1], { type: 'result', value: resultOf() });
    expect(nextResult).toHaveBeenCalledOnce();
    expect(nextError).not.toHaveBeenCalled();
  });

  it('대기 중 발생한 실행 오류는 완료한 콜백을 호출하지 않고 워커를 폐기한다', () => {
    const result = vi.fn(), error = vi.fn();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), result, error);
    const worker = state.instances[0];
    respond(worker, { type: 'result', value: resultOf() });
    worker.onerror?.({ preventDefault: vi.fn(), message: '대기 중 오류' });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(result).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), vi.fn(), vi.fn());
    expect(state.instances).toHaveLength(2);
  });

  it('대기 중 수신 오류가 발생하면 다음 생성에 새 워커를 만든다', () => {
    const error = vi.fn();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), vi.fn(), error);
    const worker = state.instances[0];
    respond(worker, { type: 'result', value: resultOf() });
    worker.onmessageerror?.();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), vi.fn(), vi.fn());
    expect(state.instances).toHaveLength(2);
  });

  it('완료한 워커와 실행 중인 워커는 명시적 해제 뒤 다시 생성된다', () => {
    const result = vi.fn(), error = vi.fn();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), result, error);
    const worker = state.instances[0];
    respond(worker, { type: 'result', value: resultOf() });
    disposeGenerationWorker(); disposeGenerationWorker();
    expect(worker.terminate).toHaveBeenCalledOnce();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), result, error);
    const nextWorker = state.instances[1], handler = nextWorker.onmessage!;
    disposeGenerationWorker();
    expect(nextWorker.terminate).toHaveBeenCalledOnce();
    handler({ data: { requestId: requestOf(nextWorker).requestId, type: 'result', value: resultOf() } });
    expect(result).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), vi.fn(), vi.fn());
    expect(state.instances).toHaveLength(3);
  });

  it('명시적 해제 뒤에는 예약된 시작 오류를 전달하지 않는다', async () => {
    state.constructorFails = true;
    const error = vi.fn();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), vi.fn(), error);
    disposeGenerationWorker();
    await Promise.resolve();
    expect(error).not.toHaveBeenCalled();
  });

  it('이전 시작 실패 알림은 이미 시작한 새 작업을 방해하지 않는다', async () => {
    state.constructorFails = true;
    const oldError = vi.fn();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), vi.fn(), oldError);
    state.constructorFails = false;
    const nextResult = vi.fn();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), nextResult, vi.fn());
    await Promise.resolve();
    expect(oldError).not.toHaveBeenCalled();
    respond(state.instances[0], { type: 'result', value: resultOf() });
    expect(nextResult).toHaveBeenCalledOnce();
  });

  it('실행 오류의 구체적인 브라우저 메시지도 보존한다', () => {
    const error = vi.fn();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), vi.fn(), error);
    state.instances[0].onerror?.({ preventDefault: vi.fn(), message: '메모리 부족' });
    expect(error.mock.calls[0][0]).toContain('메모리 부족');
  });

  it('잘못된 응답은 예외를 던지지 않고 종료와 오류로 처리한다', () => {
    const error = vi.fn();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), vi.fn(), error);
    const worker = state.instances[0];
    expect(() => worker.onmessage?.({ data: null })).not.toThrow();
    expect(error.mock.calls[0][0]).toContain('메시지 형식');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});

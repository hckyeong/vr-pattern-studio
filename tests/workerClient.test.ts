import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runGeneration } from '../src/core/workerClient';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import type { WorkerResponse } from '../src/core/types';

interface WorkerDouble {
  onmessage: ((event: { data: WorkerResponse }) => void) | null;
  onerror: ((event: { preventDefault(): void }) => void) | null;
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
beforeEach(() => { state.instances.length = 0; state.constructorFails = false; state.sendFails = false; });

describe('생성 워커의 오류와 종료 처리', () => {
  // 실제 작업 오류는 입력 문제와 실행 문제를 구분하여 전달한다.
  it('작업자가 반환한 구체적인 오류를 보존하고 워커를 해제한다', () => {
    const error = vi.fn();
    runGeneration(DEFAULT_SETTINGS, vi.fn(), vi.fn(), error);
    const worker = state.instances[0];
    worker.onmessage?.({ data: { type: 'error', message: '마커를 배치할 수 없습니다.' } });
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

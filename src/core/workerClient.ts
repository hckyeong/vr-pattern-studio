import type { GenerationProgress, PatternResult, PatternSettings, WorkerRequest, WorkerResponse } from './types';
import GeneratorWorker from '../workers/generator.worker?worker&inline';

interface GenerationCallbacks {
  onProgress: (progress: GenerationProgress) => void;
  onResult: (result: PatternResult) => void;
  onError: (message: string) => void;
}

interface GenerationJob {
  requestId: number;
  callbacks: GenerationCallbacks | null;
}

let generationWorker: Worker | null = null;
let activeJob: GenerationJob | null = null;
let requestSequence = 0;

/** 완료한 작업의 콜백 참조를 해제하고 다음 생성이 시작될 수 있게 한다. */
function finishJob(job: GenerationJob): GenerationCallbacks | null {
  const callbacks = job.callbacks;
  job.callbacks = null;
  if (activeJob === job) activeJob = null;
  return callbacks;
}

/** 지정한 현재 워커의 이벤트 처리기와 준비 캐시를 함께 해제한다. */
function terminateWorker(worker: Worker): void {
  if (generationWorker !== worker) return;
  generationWorker = null;
  worker.onmessage = null;
  worker.onerror = null;
  worker.onmessageerror = null;
  worker.terminate();
}

/** 현재 워커의 실패 상태를 정리한 뒤 실행 중인 작업에만 오류를 알린다. */
function failWorker(worker: Worker, message: string): void {
  if (generationWorker !== worker) return;
  const callbacks = activeJob ? finishJob(activeJob) : null;
  terminateWorker(worker);
  callbacks?.onError(message);
}

/** 메시지의 식별자와 응답 분기를 확인해 잘못된 데이터 접근을 막는다. */
function validResponse(value: unknown): value is WorkerResponse {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<WorkerResponse>;
  if (!Number.isSafeInteger(message.requestId) || message.requestId! < 1) return false;
  if (message.type === 'error') return typeof message.message === 'string';
  if (message.type !== 'progress' && message.type !== 'result') return false;
  return !!message.value && typeof message.value === 'object';
}

/** 화면 번들에 포함된 워커를 만들고 현재 워커와 요청의 응답만 처리한다. */
function createWorker(): Worker {
  const worker = new GeneratorWorker();
  generationWorker = worker;
  /** 이전 워커나 이전 요청의 응답은 새 작업에 전달하지 않는다. */
  worker.onmessage = (event: MessageEvent<unknown>) => {
    if (generationWorker !== worker || !activeJob) return;
    const message = event.data;
    const requestId = message && typeof message === 'object' && 'requestId' in message ? message.requestId : null;
    if (typeof requestId === 'number' && Number.isSafeInteger(requestId) && requestId > 0 && requestId !== activeJob.requestId) return;
    if (!validResponse(message)) {
      failWorker(worker, '생성 결과의 메시지 형식이 올바르지 않습니다. 다시 생성해 주세요.');
      return;
    }
    const job = activeJob;
    if (message.requestId !== job.requestId) return;
    if (message.type === 'progress') job.callbacks?.onProgress(message.value);
    else if (message.type === 'result') finishJob(job)?.onResult(message.value);
    else failWorker(worker, message.message);
  };
  /** 실행 중 또는 대기 중 발생한 워커 오류는 재사용할 워커를 폐기한다. */
  worker.onerror = event => {
    if (generationWorker !== worker) return;
    event.preventDefault();
    const detail = event.message ? `\n${event.message}` : '';
    failWorker(worker, `패턴 생성기를 실행하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.${detail}`);
  };
  /** 역직렬화에 실패한 워커는 종료하고 실행 중인 작업에 오류를 알린다. */
  worker.onmessageerror = () => failWorker(worker, '생성 결과를 읽지 못했습니다. 다시 생성해 주세요.');
  return worker;
}

/** 실행 중인 작업과 대기 중인 워커를 모두 해제하고 늦은 시작 오류도 무효화한다. */
export function disposeGenerationWorker(): void {
  requestSequence++;
  if (activeJob) finishJob(activeJob);
  if (generationWorker) terminateWorker(generationWorker);
}

/** 완료한 워커를 재사용하고 취소·실패·작업 교체 시에는 연산과 준비 캐시를 해제한다. */
export function runGeneration(
  settings: PatternSettings,
  onProgress: (progress: GenerationProgress) => void,
  onResult: (result: PatternResult) => void,
  onError: (message: string) => void,
): { cancel(): void } {
  if (activeJob) disposeGenerationWorker();
  const job: GenerationJob = { requestId: ++requestSequence, callbacks: { onProgress, onResult, onError } };
  activeJob = job;
  let pendingError: ((message: string) => void) | null = null;
  try {
    const worker = generationWorker ?? createWorker();
    const request: WorkerRequest = { requestId: job.requestId, settings };
    worker.postMessage(request);
  } catch (caught) {
    pendingError = finishJob(job)?.onError ?? null;
    if (generationWorker) terminateWorker(generationWorker);
    const detail = caught instanceof Error && caught.message ? `\n${caught.message}` : '';
    /** 동기 시작 실패는 작업 객체 반환 뒤 알리되 취소·새 요청·해제 뒤에는 생략한다. */
    queueMicrotask(() => {
      const callback = pendingError;
      pendingError = null;
      if (requestSequence === job.requestId) callback?.(`패턴 생성기를 시작하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.${detail}`);
    });
  }
  /** 이 작업이 아직 실행 중일 때만 워커를 종료하고 예약된 실패 알림을 취소한다. */
  const cancel = () => {
    pendingError = null;
    if (activeJob !== job) return;
    finishJob(job);
    if (generationWorker) terminateWorker(generationWorker);
  };
  return { cancel };
}

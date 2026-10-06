import type { GenerationProgress, PatternResult, PatternSettings, WorkerResponse } from './types';
import GeneratorWorker from '../workers/generator.worker?worker&inline';

/** 화면과 같은 버전의 내장 워커를 시작하고 실패·취소 시 연산을 해제한다. */
export function runGeneration(
  settings: PatternSettings,
  onProgress: (progress: GenerationProgress) => void,
  onResult: (result: PatternResult) => void,
  onError: (message: string) => void,
): { cancel(): void } {
  let worker: Worker | null = null;
  let finished = false;
  // 워커와 이벤트 처리기를 해제한다.
  const stop = () => {
    finished = true;
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  };
  /** 시작과 실행 단계의 실패를 한 번만 전달해 생성 중 상태를 해제한다. */
  const fail = (message: string) => {
    if (finished) return;
    stop(); onError(message);
  };
  try {
    // 실행 코드를 화면 번들에 포함해 업데이트가 이전 워커 주소를 삭제해도 동작한다.
    worker = new GeneratorWorker();
    // 실행 중인 작업의 응답만 화면에 전달한다.
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (finished) return;
      const message = event.data;
      if (message.type === 'progress') onProgress(message.value);
      else if (message.type === 'result') { stop(); onResult(message.value); }
      else if (message.type === 'error') { stop(); onError(message.message); }
    };
    // 예기치 않은 워커 오류도 사용자에게 전달한다.
    worker.onerror = (event) => {
      if (finished) return;
      event.preventDefault();
      fail('패턴 생성기를 실행하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.');
    };
    // 결과 수신 실패도 생성이 끝나지 않는 상태로 남기지 않는다.
    worker.onmessageerror = () => fail('생성 결과를 읽지 못했습니다. 다시 생성해 주세요.');
    worker.postMessage(settings);
  } catch {
    // 생성자 또는 데이터 전달의 동기 실패도 취소 가능한 작업 객체를 반환한 뒤 알린다.
    queueMicrotask(() => fail('패턴 생성기를 시작하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.'));
  }
  return { cancel: stop };
}

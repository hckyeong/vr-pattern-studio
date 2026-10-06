import { generatePattern } from '../core/generator';
import { validateSettings } from '../core/settings';
import type { PatternSettings, WorkerResponse } from '../core/types';

/** 작업 진행과 결과를 주 화면으로 전달한다. */
function send(message: WorkerResponse): void {
  self.postMessage(message);
}

/** 워커에서 입력을 검증하고 독립적인 패턴 생성 작업을 수행한다. */
self.onmessage = async (event: MessageEvent<PatternSettings>) => {
  try {
    const errors = validateSettings(event.data);
    if (errors.length) throw new Error(errors.join('\n'));
    const result = await generatePattern(event.data, value => send({ type: 'progress', value }));
    send({ type: 'result', value: result });
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : '패턴을 생성하지 못했습니다.' });
  }
};

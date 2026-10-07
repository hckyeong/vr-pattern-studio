import { generatePattern } from '../core/generator';
import { createArtworkPreparationCache } from '../core/preparedArtwork';
import { MAX_ARTWORKS } from '../core/artwork';
import { validateSettings } from '../core/settings';
import type { WorkerRequest, WorkerResponse } from '../core/types';

const artworkCache = createArtworkPreparationCache({ maxArtworks: MAX_ARTWORKS });
let running = false;

/** 작업 진행과 결과를 주 화면으로 전달한다. */
function send(message: WorkerResponse): void {
  self.postMessage(message);
}

/** 워커의 요청 식별자와 설정 봉투를 확인한다. */
function validRequest(value: unknown): value is WorkerRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as Partial<WorkerRequest>;
  return Number.isSafeInteger(request.requestId) && request.requestId! > 0 && 'settings' in request;
}

/** 입력을 검증하고 준비 캐시를 재사용하며 한 번에 하나의 패턴만 생성한다. */
self.onmessage = async (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!validRequest(request)) {
    send({ requestId: 0, type: 'error', message: '패턴 생성 요청의 형식이나 작업 번호가 올바르지 않습니다.' });
    return;
  }
  const { requestId, settings } = request;
  if (running) {
    send({ requestId, type: 'error', message: '이미 패턴 생성 작업이 진행 중입니다. 현재 작업이 끝난 뒤 다시 시도해 주세요.' });
    return;
  }
  running = true;
  try {
    const errors = validateSettings(settings);
    if (errors.length) throw new Error(errors.join('\n'));
    const result = await generatePattern(settings, value => send({ requestId, type: 'progress', value }), { artworkCache });
    send({ requestId, type: 'result', value: result });
  } catch (error) {
    send({ requestId, type: 'error', message: error instanceof Error ? error.message : '패턴을 생성하지 못했습니다.' });
  } finally {
    running = false;
  }
};

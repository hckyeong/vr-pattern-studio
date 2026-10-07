import { MASK_RESOLUTION, MASK_THRESHOLD, maskFromPixels } from './fillMask';
import type { FillMask } from './types';

/** 로컬 사진을 제한된 분석 해상도로 읽고 원본 비트맵 대신 흰 영역 벡터만 반환한다. */
export async function importMask(file: File, threshold = MASK_THRESHOLD): Promise<FillMask> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('채울 영역은 PNG·JPG·WebP 이미지로 불러와 주세요.');
  if (!file.size || file.size > 16_000_000) throw new Error('이미지 파일은 16MB 이하로 선택해 주세요.');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('이미지를 읽을 수 없습니다. 정상적인 PNG·JPG·WebP 파일인지 확인해 주세요.'); }
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 64_000_000) throw new Error('이미지는 6,400만 픽셀 이하로 줄여 주세요.');
    const scale = Math.min(1, MASK_RESOLUTION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('이 브라우저에서 이미지의 흰색 영역을 읽을 수 없습니다.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { ...maskFromPixels(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, file.name, threshold), aspect: bitmap.height / bitmap.width };
  } finally { bitmap.close(); }
}

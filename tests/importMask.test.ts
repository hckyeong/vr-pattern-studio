// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importMask } from '../src/core/importMask';
import { pathsArea } from '../src/core/geometry';
import { loadWorkspace, saveWorkspace } from '../src/core/storage';
import { DEFAULT_SETTINGS } from '../src/core/settings';

/** 이미지 자원과 캔버스 대역을 정리한다. */
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('영역 이미지 가져오기', () => {
  it('긴 변을 제한하고 분석 결과만 저장한 뒤 디코딩 자원을 닫는다', async () => {
    const bitmap = { width: 2400, height: 1200, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    const drawImage = vi.fn(), getImageData = vi.fn().mockReturnValue({ data: new Uint8ClampedArray(512 * 256 * 4).fill(255) });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage, getImageData } as unknown as CanvasRenderingContext2D);
    const mask = await importMask(new File(['사진'], '흰영역.png', { type: 'image/png' }));
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 512, 256); expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(mask.width).toBe(512); expect(mask.height).toBe(256); expect(pathsArea(mask.paths)).toBe(1);
    const settings = { ...structuredClone(DEFAULT_SETTINGS), fillMask: mask };
    saveWorkspace(settings, []); expect(loadWorkspace()?.settings.fillMask).toEqual(mask);
    expect(JSON.stringify(loadWorkspace())).not.toContain('data:image');
  });

  it('SVG·초과 용량·깨진 사진을 거부한다', async () => {
    const decode = vi.fn().mockRejectedValue(new Error('디코딩 실패')); vi.stubGlobal('createImageBitmap', decode);
    await expect(importMask(new File(['<svg/>'], '입력.svg', { type: 'image/svg+xml' }))).rejects.toThrow('PNG');
    const oversized = new File(['사진'], '대형.png', { type: 'image/png' }); Object.defineProperty(oversized, 'size', { value: 16_000_001 });
    await expect(importMask(oversized)).rejects.toThrow('16MB'); expect(decode).not.toHaveBeenCalled();
    await expect(importMask(new File(['손상'], '손상.png', { type: 'image/png' }))).rejects.toThrow('이미지를 읽을 수 없습니다');
  });

  it('분석 크기의 반올림과 관계없이 원본 사진의 가로세로 비율을 유지한다', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 2000, height: 777, close: vi.fn() }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(512 * 199 * 4).fill(255) }) } as unknown as CanvasRenderingContext2D);
    const mask = await importMask(new File(['사진'], '원본비율.jpg', { type: 'image/jpeg' }));
    expect(mask.height).toBe(199); expect(mask.aspect).toBe(777 / 2000); expect(mask.aspect).not.toBe(mask.height / mask.width);
  });

  it('영역 분석 실패나 이미지 크기 초과 때도 디코딩 자원을 반환한다', async () => {
    const bitmap = { width: 10, height: 10, close: vi.fn() }; vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(importMask(new File(['사진'], '입력.png', { type: 'image/png' }))).rejects.toThrow('브라우저'); expect(bitmap.close).toHaveBeenCalledTimes(1);
    bitmap.width = 10000; bitmap.height = 10000;
    await expect(importMask(new File(['사진'], '입력.png', { type: 'image/png' }))).rejects.toThrow('6,400만'); expect(bitmap.close).toHaveBeenCalledTimes(2);
  });
});

import type { ChangeEvent } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { MASK_RESOLUTION, MASK_THRESHOLD } from '../core/fillMask';
import { pathsArea } from '../core/geometry';
import type { FillMask } from '../core/types';

interface Props {
  mask?: FillMask;
  importing: boolean;
  onUpload(event: ChangeEvent<HTMLInputElement>): void;
  onChange(mask?: FillMask): void;
}

/** 흑백 이미지의 흰 영역을 확인하고 비율 맞춤과 마스크 제거를 제공한다. */
export function FillMaskPanel({ mask, importing, onUpload, onChange }: Props) {
  const outline = mask?.paths.map(path => `M${path.map(point => `${point.x},${point.y * mask.aspect}`).join('L')}Z`).join('');
  return <div className="fill-mask-panel">
    <label className="svg-upload"><Upload size={16} /><span>{importing ? '흰색 영역 읽는 중…' : mask ? '영역 이미지 교체' : '흑백 이미지 불러오기'}</span><input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" aria-label="채울 영역 이미지" disabled={importing} onChange={onUpload} /></label>
    {mask && <>
      <svg className="mask-thumbnail" viewBox={`0 0 1 ${mask.aspect}`} role="img" aria-label="흰색 채움 영역 미리보기"><rect width={1} height={mask.aspect} fill="#20252a" /><path d={outline} fill="#fff" fillRule="nonzero" /></svg>
      <p className="field-hint mask-filename">{mask.name} · 흰색 {(pathsArea(mask.paths) * 100).toFixed(1)}%</p>
      <label className="field"><span>채움 영역 맞춤</span><select aria-label="채움 영역 맞춤" value={mask.fit} onChange={event => onChange({ ...mask, fit: event.target.value as FillMask['fit'] })}><option value="contain">이미지 비율 유지 · 중앙</option><option value="stretch">캔버스 전체 크기에 맞춤</option></select></label>
      <button className="secondary-button" disabled={importing} onClick={() => onChange(undefined)}><Trash2 size={14} />채움 영역 제거</button>
    </>}
    <p className="field-hint">흰색 부분에만 패턴을 만들고 경계에 걸친 도형은 잘라냅니다. 검정·투명 부분은 비웁니다. 마커는 흰 보호 여백까지 온전히 들어갈 때만 배치합니다.</p>
    <p className="field-hint">PNG·JPG·WebP, 최대 16MB. 밝기 {MASK_THRESHOLD}/255 이상을 흰 영역으로 읽으며 긴 변 {MASK_RESOLUTION}픽셀 기준으로 경계를 분석합니다. 원본 사진은 출력에 포함하지 않습니다.</p>
    {mask && <p className="field-hint">여백 비율은 흰색 영역을 기준으로 계산합니다. 삽입한 SVG는 원본을 유지하며, 사진 영역과 SVG 회피 조건을 함께 적용합니다.</p>}
  </div>;
}

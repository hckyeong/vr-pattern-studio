import type { ChangeEvent } from 'react';
import { Upload, Trash2, Move } from 'lucide-react';
import type { SvgArtwork } from '../core/types';

interface Props {
  artwork?: SvgArtwork;
  automatic: boolean;
  onAutomatic(value: boolean): void;
  onUpload(event: ChangeEvent<HTMLInputElement>): void;
  onChange(value: SvgArtwork): void;
  onCommit(value: SvgArtwork): void;
  onRemove(): void;
}

/** 사용자 SVG의 불러오기·비율·위치를 조절하고 재배치 방식을 안내한다. */
export function ArtworkPanel({ artwork, automatic, onAutomatic, onUpload, onChange, onCommit, onRemove }: Props) {
  return <div className="artwork-panel">
    <label className="svg-upload"><Upload size={16} /><span>{artwork ? '다른 SVG로 교체' : 'SVG 불러오기'}</span><input type="file" accept=".svg,image/svg+xml" aria-label="SVG 파일 불러오기" onChange={onUpload} /></label>
    {artwork ? <>
      <div className="artwork-file"><span title={artwork.name}>{artwork.name}</span><button title="삽입 SVG 제거" onClick={onRemove}><Trash2 size={15} /></button></div>
      <p className="artwork-hint"><Move size={15} />그림을 드래그하여 이동하고 오른쪽 아래 손잡이로 크기를 조절하세요.</p>
      <div className="field-row">{(['x', 'y'] as const).map((key, index) => <label className="field" key={key}><span>{index ? '세로 중심' : '가로 중심'}</span><div className="number-wrap"><input type="number" min={0} max={100} step={1} value={Number((artwork[key] * 100).toFixed(2))} onChange={event => onChange({ ...artwork, [key]: Number(event.target.value) / 100 })} onBlur={() => onCommit(artwork)} /><em>%</em></div></label>)}</div>
      <label className="field"><span>SVG 가로 크기 · 캔버스 대비</span><div className="number-wrap"><input type="number" min={0.1} max={100} step={1} value={Number((artwork.widthRatio * 100).toFixed(2))} onChange={event => onChange({ ...artwork, widthRatio: Number(event.target.value) / 100 })} onBlur={() => onCommit(artwork)} /><em>%</em></div></label>
      <label className="field"><span>패턴이 피할 영역</span><select value={artwork.avoidance} onChange={event => onCommit({ ...artwork, avoidance: event.target.value as SvgArtwork['avoidance'] })}><option value="silhouette">SVG 최외곽선 가까이 배치</option><option value="outline">채워진 도형만 피하기</option><option value="bounds">SVG 전체 사각 영역</option></select></label>
      <label className="toggle-row"><span>이동 후 자동 재배치</span><input type="checkbox" checked={automatic} onChange={event => onAutomatic(event.target.checked)} /></label>
      <p className="field-hint">최외곽선 모드는 도형 형태를 유지해 윤곽 가까이 배치하고 SVG 내부 구멍은 비웁니다. 보호 간격은 아래의 도형 간격을 따릅니다. 자동 재배치를 끄면 위치를 조절한 뒤 패턴 생성 버튼을 누르세요.</p>
    </> : <p className="field-hint">로고나 그림의 벡터 SVG를 넣으면 가장 바깥 윤곽을 따라 도형의 모양을 유지하며 패턴을 배치합니다.</p>}
  </div>;
}

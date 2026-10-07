import type { ChangeEvent } from 'react';
import { Upload, Trash2, Move } from 'lucide-react';
import type { SvgArtwork } from '../core/types';
import { DEFAULT_HULL_MERGE_RATIO } from '../core/groupedHull';
import { MAX_ARTWORKS } from '../core/artwork';

interface Props {
  artworks: SvgArtwork[];
  selectedIndex: number;
  onSelect(index: number): void;
  importing: boolean;
  automatic: boolean;
  onAutomatic(value: boolean): void;
  onUpload(event: ChangeEvent<HTMLInputElement>): void;
  onReplace(event: ChangeEvent<HTMLInputElement>): void;
  onChange(value: SvgArtwork): void;
  onCommit(value: SvgArtwork): void;
  onRemove(index: number): void;
}

/** 선택한 SVG의 배치·회전·계산 윤곽을 조절하고 미선택 상태에는 선택 방법을 안내한다. */
export function ArtworkPanel({ artworks, selectedIndex, onSelect, importing, automatic, onAutomatic, onUpload, onReplace, onChange, onCommit, onRemove }: Props) {
  const artwork = artworks[selectedIndex];
  return <div className="artwork-panel">
    <label className="svg-upload"><Upload size={16} /><span>{importing ? 'SVG 읽는 중…' : 'SVG 추가 · 여러 파일 선택'}</span><input type="file" multiple accept=".svg,image/svg+xml" aria-label="SVG 파일 추가" disabled={importing || artworks.length >= MAX_ARTWORKS} onChange={onUpload} /></label>
    {!!artworks.length && <ul className="artwork-list" aria-label="삽입 SVG 목록">{artworks.map((item, index) => <li key={index} className={index === selectedIndex ? 'selected' : ''}><button className="artwork-select" aria-pressed={index === selectedIndex} onClick={() => onSelect(index)} title={item.name}><b>{index + 1}</b><span>{item.name}</span></button><button className="artwork-remove" title={`${index + 1}번 SVG 삭제`} aria-label={`${index + 1}번 SVG 삭제`} onClick={() => onRemove(index)}><Trash2 size={14} /></button></li>)}</ul>}
    {artwork ? <>
      <label className="svg-upload svg-replace"><span>선택한 SVG만 교체</span><input type="file" accept=".svg,image/svg+xml" aria-label="선택한 SVG 교체" disabled={importing} onChange={onReplace} /></label>
      <p className="artwork-hint"><Move size={15} />그림이나 목록에서 선택하세요. 드래그로 이동하고 아래 손잡이로 크기, 위의 원형 손잡이로 회전을 조절합니다.</p>
      <div className="field-row">{(['x', 'y'] as const).map((key, index) => <label className="field" key={key}><span>{index ? '세로 중심' : '가로 중심'}</span><div className="number-wrap"><input type="number" min={0} max={100} step={1} value={Number((artwork[key] * 100).toFixed(2))} onChange={event => onChange({ ...artwork, [key]: Number(event.target.value) / 100 })} onBlur={() => onCommit(artwork)} /><em>%</em></div></label>)}</div>
      <label className="field"><span>SVG 가로 크기 · 캔버스 대비</span><div className="number-wrap"><input type="number" min={0.1} max={100} step={1} value={Number((artwork.widthRatio * 100).toFixed(2))} onChange={event => onChange({ ...artwork, widthRatio: Number(event.target.value) / 100 })} onBlur={() => onCommit(artwork)} /><em>%</em></div></label>
      <label className="field"><span>선택한 SVG 회전</span><div className="number-wrap"><input aria-label="SVG 회전 각도" type="number" min={0} max={360} step={1} value={Number((artwork.rotation ?? 0).toFixed(2))} onChange={event => onChange({ ...artwork, rotation: Number(event.target.value) })} onBlur={() => onCommit(artwork)} /><em>도</em></div></label>
      <div className="artwork-rotation-actions"><button onClick={() => onCommit({ ...artwork, rotation: (artwork.rotation ?? 0) - 15 })}>−15°</button><button onClick={() => onCommit({ ...artwork, rotation: 0 })}>회전 초기화</button><button onClick={() => onCommit({ ...artwork, rotation: (artwork.rotation ?? 0) + 15 })}>+15°</button></div>
      <label className="field"><span>패턴이 피할 영역</span><select value={artwork.avoidance} onChange={event => onCommit({ ...artwork, avoidance: event.target.value as SvgArtwork['avoidance'] })}><option value="silhouette">SVG 최외곽선 가까이 배치</option><option value="outline">채워진 도형만 피하기</option><option value="bounds">SVG 전체 사각 영역</option></select></label>
      <label className="field"><span>계산용 윤곽 간략화</span><select value={artwork.contourMode === 'grouped-hull' ? 'grouped-hull' : artwork.contourTolerance ?? 0} disabled={artwork.avoidance === 'bounds'} onChange={event => onCommit(event.target.value === 'grouped-hull' ? { ...artwork, contourMode: 'grouped-hull', hullMergeRatio: artwork.hullMergeRatio ?? DEFAULT_HULL_MERGE_RATIO } : { ...artwork, contourMode: 'simplify', contourTolerance: Number(event.target.value) })}><option value={0}>사용 안 함 · 원본 윤곽</option><option value={0.00025}>세밀 · 너비의 0.025%</option><option value={0.001}>균형 · 너비의 0.1%</option><option value={0.0025}>빠르게 · 너비의 0.25%</option><option value="grouped-hull">큰 덩어리별 볼록 껍질</option></select></label>
      {artwork.contourMode === 'grouped-hull' && artwork.avoidance !== 'bounds' && <label className="field"><span>덩어리 묶음 거리 · SVG 너비 대비</span><div className="number-wrap"><input aria-label="덩어리 묶음 거리" type="number" min={0} max={10} step={0.5} value={Number(((artwork.hullMergeRatio ?? DEFAULT_HULL_MERGE_RATIO) * 100).toFixed(3))} onChange={event => onChange({ ...artwork, hullMergeRatio: Number(event.target.value) / 100 })} onBlur={() => onCommit(artwork)} /><em>%</em></div></label>}
      <p className="field-hint">{artwork.avoidance === 'bounds' ? '사각 영역은 윤곽 간략화가 필요하지 않습니다.' : artwork.contourMode === 'grouped-hull' ? '가까운 조각들을 연결해 덩어리별로 감쌉니다. 묶음 거리를 높이면 더 크게 묶이며, 덩어리 안의 오목한 공간과 구멍에도 패턴이 들어가지 않습니다. 출력 SVG는 원본을 유지합니다.' : '출력 SVG는 원본을 유지합니다. 복잡한 윤곽만 계산용으로 줄이며, 패턴과 로고 사이 여백이 조금 넓어질 수 있습니다.'}</p>
      <label className="toggle-row"><span>이동 후 자동 재배치</span><input type="checkbox" checked={automatic} onChange={event => onAutomatic(event.target.checked)} /></label>
      <p className="field-hint">최외곽선 모드는 도형 형태를 유지해 윤곽 가까이 배치하고 SVG 내부 구멍은 비웁니다. 보호 간격은 아래의 도형 간격을 따릅니다. 자동 재배치를 끄면 위치를 조절한 뒤 패턴 생성 버튼을 누르세요.</p>
      <p className="field-hint">최대 {MAX_ARTWORKS}개를 삽입할 수 있습니다. 목록 아래쪽 SVG가 위에 그려집니다. 모든 SVG의 회피 영역에 패턴이 들어가지 않습니다.</p>
    </> : <p className="field-hint">{artworks.length ? '목록이나 그림을 선택하면 윤곽선과 편집 손잡이가 표시됩니다. 캔버스의 빈 곳을 누르면 선택이 해제됩니다.' : '로고나 그림의 벡터 SVG를 여러 개 넣고, 각각의 가장 바깥 윤곽을 따라 패턴을 배치할 수 있습니다.'}</p>}
  </div>;
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import type { PatternColors, PatternSettings } from '../core/types';
import { MAX_SWATCHES, normalizeHex, resolveColors, validColors } from '../core/colors';
import { importAse, MAX_ASE_BYTES } from '../core/ase';

/** 색 선택기와 직접 입력을 동기화하고 완성된 RGB 값만 적용한다. */
function ColorInput({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const invalid = normalizeHex(draft) === null;
  return <div className="color-input">
    <input type="color" aria-label={`${label} 선택`} value={value} onChange={event => { setDraft(event.target.value); onChange(event.target.value); }} />
    <input type="text" aria-label={`${label} HEX`} value={draft} maxLength={7} spellCheck={false} aria-invalid={invalid}
      onChange={event => { const text = event.target.value; setDraft(text); if (/^#?[\da-f]{6}$/i.test(text.trim())) onChange(normalizeHex(text)!); }}
      onBlur={() => { const color = normalizeHex(draft); if (color) { setDraft(color); onChange(color); } }} />
    {invalid && <span className="color-input-error">#RRGGBB로 입력해 주세요.</span>}
  </div>;
}

/** 도형·배경색 편집과 로컬 Adobe ASE 팔레트 가져오기를 제공한다. */
export function ColorPanel({ settings, busy, onChange }: { settings: PatternSettings; busy: boolean; onChange(colors: PatternColors): void }) {
  const colors = useMemo(() => resolveColors(settings), [settings.colors, settings.grayRatio]);
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, [colors, busy]);
  /** 색상 합계가 0이 되지 않는 유효한 변경만 현재 시안에 전달한다. */
  function apply(next: PatternColors) {
    if (!validColors(next)) { setError('한 색 이상의 비중을 0보다 크게 지정해 주세요.'); return; }
    setError(''); onChange(next);
  }
  /** 파일을 메모리에서 검증한 후 색상 목록을 한 번에 교체한다. */
  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    const token = ++request.current; setLoading(true); setError(''); setMessage('');
    try {
      if (file.size > MAX_ASE_BYTES) throw new Error('ASE 파일은 1MB 이하로 선택해 주세요.');
      const data = await file.arrayBuffer();
      if (token !== request.current) return;
      const imported = importAse(data);
      apply({ ...colors, swatches: imported.swatches });
      setMessage(`${file.name} · ${imported.swatches.length}색 적용. ${imported.notices.join(' ')}`);
    } catch (caught) {
      if (token === request.current) setError(caught instanceof Error ? caught.message : 'ASE 파일을 읽지 못했습니다.');
    } finally { setLoading(false); }
  }
  const total = colors.swatches.reduce((sum, swatch) => sum + swatch.weight, 0);
  return <fieldset className="color-panel" disabled={busy || loading}>
    <div className="color-panel-heading"><span>배경색</span><button type="button" title="기본 흑백 색상으로" onClick={() => { setMessage(''); apply(resolveColors({ grayRatio: settings.grayRatio })); }}><RotateCcw size={14} />흑백 복원</button></div>
    <ColorInput label="배경색" value={colors.background} onChange={background => apply({ ...colors, background })} />
    <div className="color-panel-heading"><span>도형 색상</span><span>비중</span></div>
    <div className="color-swatches">{colors.swatches.map((swatch, index) => <div className="color-swatch" key={index}>
      <div className="color-swatch-name" title={swatch.name}>{index + 1}. {swatch.name}</div>
      <div className="color-swatch-controls">
        <ColorInput label={`도형 색상 ${index + 1}`} value={swatch.color} onChange={color => apply({ ...colors, swatches: colors.swatches.map((item, position) => position === index ? { ...item, color } : item) })} />
        <label className="color-weight"><input type="number" aria-label={`색상 ${index + 1} 비중`} min={0} max={1000} step={1} value={Number(swatch.weight.toFixed(2))}
          onChange={event => apply({ ...colors, swatches: colors.swatches.map((item, position) => position === index ? { ...item, weight: Number(event.target.value) } : item) })} /><span>{Math.round(swatch.weight / total * 100)}%</span></label>
        <button type="button" className="color-remove" title={`색상 ${index + 1} 삭제`} disabled={colors.swatches.length === 1} onClick={() => apply({ ...colors, swatches: colors.swatches.filter((_, position) => position !== index) })}><Trash2 size={13} /></button>
      </div>
      <button type="button" className="color-background" onClick={() => apply({ ...colors, background: swatch.color })}>배경색으로 사용</button>
    </div>)}</div>
    <button type="button" className="secondary-button" disabled={colors.swatches.length >= MAX_SWATCHES} onClick={() => apply({ ...colors, swatches: [...colors.swatches, { name: `색상 ${colors.swatches.length + 1}`, color: '#cd653e', weight: total / colors.swatches.length }] })}><Plus size={14} />색상 추가</button>
    <p className="field-hint">색은 현재 시안에 즉시 반영됩니다. 비중 0인 색은 도형에 사용하지 않습니다. 마커와 삽입 SVG는 원래 색을 유지합니다.</p>
    <div className="ase-import"><a href="https://color.adobe.com/" target="_blank" rel="noopener noreferrer">Adobe Color 열기<ArrowUpRight size={13} /></a>
      <label className="svg-upload"><Upload size={15} />{loading ? '색상표 읽는 중' : 'ASE 팔레트 가져오기'}<input type="file" accept=".ase" aria-label="ASE 팔레트 파일" onChange={upload} /></label>
      <p className="field-hint">Adobe 색상표 · 최대 32색 / 1MB<br />RGB 색상으로 저장됩니다. 가져온 색 아래에서 배경색을 선택할 수 있습니다.</p>
    </div>
    {error && <p className="color-feedback color-error" role="alert">{error}</p>}
    {message && <p className="color-feedback" role="status">{message}</p>}
  </fieldset>;
}

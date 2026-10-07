import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, ChevronDown, CircleHelp, Command, Layers, LockKeyhole, RefreshCw, SlidersHorizontal, Sparkles, Trash2, UnlockKeyhole, X } from 'lucide-react';
import type { FillMask, GenerationProgress, PatternColors, PatternResult, PatternSettings, ShapeKind, SvgArtwork, Unit } from './core/types';
import { DEFAULT_SETTINGS, SHAPE_LABELS, cloneSettings, makeSeed, resolveCanvas, validateSettings } from './core/settings';
import { constrainArtwork, getArtworks, MAX_ARTWORKS, withArtworks } from './core/artwork';
import { importSvg } from './core/importSvg';
import { ArtworkPanel } from './ui/ArtworkPanel';
import { FillMaskPanel } from './ui/FillMaskPanel';
import { importMask } from './core/importMask';
import { ColorPanel } from './ui/ColorPanel';
import { recolorResult } from './core/colors';
import { disposeGenerationWorker, runGeneration } from './core/workerClient';
import { loadWorkspace, saveWorkspace } from './core/storage';
import { exportSvg, exportSheetMapSvg, getSvgFilename } from './core/svg';
import { createSheetRegions } from './core/sheets';
import { downloadSvg } from './core/download';
import { Preview } from './ui/Preview';
import { MarkerTable } from './ui/MarkerTable';
import { convertInputMode } from './ui/convertInputMode';
import './styles.css';

/** 입력값과 레이블을 일관된 숫자 필드로 표시한다. */
function NumberField({ label, value, onChange, suffix, min = 0, step = 1 }: { label: string; value: number; onChange: (n: number) => void; suffix?: string; min?: number; step?: number }) {
  return <label className="field"><span>{label}</span><div className="number-wrap"><input type="number" min={min} step={step} value={value} onChange={event => onChange(Number(event.target.value))} />{suffix && <em>{suffix}</em>}</div></label>;
}
/** 비율 설정을 한글 레이블과 함께 조정한다. */
function RangeField({ label, value, onChange, max = 1 }: { label: string; value: number; onChange: (n: number) => void; max?: number }) {
  return <label className="range-field"><span>{label}<b>{Math.round(value / max * 100)}<small>%</small></b></span><input type="range" min="0" max={max} step={max / 100} value={value} onChange={event => onChange(Number(event.target.value))} /></label>;
}
/** 접을 수 있는 설정 영역을 표시한다. */
function Section({ title, children, open = false, badge }: { title: string; children: React.ReactNode; open?: boolean; badge?: string }) {
  return <details className="settings-section" open={open}><summary>{title}{badge && <span className="badge">{badge}</span>}<ChevronDown size={15} /></summary><div className="section-body">{children}</div></details>;
}
/** 흰색 채움 영역과 SVG 편집, 패턴 생성·출력 및 로컬 작업 보관을 관리한다. */
export default function App() {
  const [initial] = useState(() => { try { return loadWorkspace(); } catch { return null; } });
  const [settings, setSettings] = useState<PatternSettings>(() => cloneSettings(initial?.settings ?? DEFAULT_SETTINGS));
  const [results, setResults] = useState<PatternResult[]>(initial?.results ?? []);
  const [selected, setSelected] = useState(0);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [locked, setLocked] = useState(true);
  const [sheet, setSheet] = useState(0);
  const [mobileSettings, setMobileSettings] = useState(false);
  const [automaticArtwork, setAutomaticArtwork] = useState(true);
  const [selectedArtwork, setSelectedArtwork] = useState(-1);
  const [importingArtwork, setImportingArtwork] = useState(false);
  const [importingMask, setImportingMask] = useState(false);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const artworks = useMemo(() => getArtworks(settings), [settings.artwork, settings.artworks]);
  const artworkIndex = selectedArtwork >= 0 && selectedArtwork < artworks.length ? selectedArtwork : -1;
  const job = useRef<{ cancel(): void } | null>(null);
  const epoch = useRef(0);
  const result = results[selected] ?? results[0] ?? null;
  const lengthUnit = settings.inputMode === 'ratio' ? '단위' : settings.unit;
  const dirty = !!result && JSON.stringify(settings) !== JSON.stringify(result.settings);
  const artworkDirty = JSON.stringify(artworks) !== JSON.stringify(result ? getArtworks(result.settings) : []);
  const maskDirty = JSON.stringify(settings.fillMask) !== JSON.stringify(result?.settings.fillMask);
  const outputBlocked = busy || importingMask || importingArtwork || artworkDirty || maskDirty;
  const regions = result ? createSheetRegions(result.canvas, result.settings) : [];
  /** 최상위 설정 하나를 갱신한다. */
  const change = <K extends keyof PatternSettings,>(key: K, value: PatternSettings[K]) => setSettings(previous => ({ ...previous, [key]: value }));
  /** 선택한 시안의 색만 즉시 갱신하고 미적용된 크기·배치 설정은 그대로 둔다. */
  function changeColors(colors: PatternColors) {
    if (busy) return;
    setSettings(previous => ({ ...previous, colors: structuredClone(colors) }));
    setResults(previous => previous.map(item => item === result ? recolorResult(item, colors) : item));
  }
  /** 유효하지 않은 비율 입력은 알림으로 표시하고 기존 입력 모드를 유지한다. */
  function changeInputMode(inputMode: PatternSettings['inputMode']) {
    try { setSettings(convertInputMode(settings, inputMode)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '크기 또는 비율을 확인해 주세요.'); }
  }
  /** 비율 잠금 상태를 반영해 캔버스 크기를 변경한다. */
  function changeSize(key: 'width' | 'height', value: number) {
    setSettings(previous => ({ ...previous, [key]: value, ...(locked && previous.width > 0 && previous.height > 0 ? key === 'width' ? { height: Number((value * previous.height / previous.width).toFixed(4)) } : { width: Number((value * previous.width / previous.height).toFixed(4)) } : {}) }));
  }
  /** 길이 입력들을 함께 변환해 단위 변경 전후 실측 크기를 보존한다. */
  function changeUnit(unit: Unit) {
    if (settings.unit === 'px' && settings.printWidthMm === null && unit !== 'px') {
      setNotice('픽셀의 실제 크기가 지정되지 않았습니다. 숫자를 유지해 단위를 변경했으니 실측 크기를 확인해 주세요.');
      change('unit', unit);
      return;
    }
    setSettings(previous => {
      const factors = { mm: 1, cm: 10, m: 1000, px: previous.unit === 'px' && previous.printWidthMm && previous.width ? previous.printWidthMm / previous.width : ({ mm: 1, cm: 10, m: 1000, px: 1 })[previous.unit] };
      const ratio = factors[previous.unit] / factors[unit];
      // 모든 길이를 동일한 비율로 환산한다.
      const convert = (value: number) => Number((value * ratio).toFixed(6));
      return { ...previous, unit, width: convert(previous.width), height: convert(previous.height), minSize: convert(previous.minSize), maxSize: convert(previous.maxSize), gap: convert(previous.gap), margin: convert(previous.margin), printWidthMm: unit === 'px' ? previous.width * factors[previous.unit] : previous.printWidthMm, markers: { ...previous.markers, side: convert(previous.markers.side) }, sheets: { ...previous.sheets, width: convert(previous.sheets.width), overlap: convert(previous.sheets.overlap), bleed: convert(previous.sheets.bleed) } };
    });
  }
  /** 진행 중인 이미지·SVG 읽기를 무효화하고 검증된 설정으로 시안을 생성한다. */
  function generate(count = 1, fresh = false, input = settings) {
    const snapshot = cloneSettings(input);
    if (fresh) snapshot.seed = makeSeed();
    const errors = validateSettings(snapshot);
    if (errors.length) { setError(errors.join(' ')); return; }
    job.current?.cancel(); const token = ++epoch.current;
    setSettings(snapshot); setBusy(true); setImportingArtwork(false); setImportingMask(false); setError(''); setProgress(null);
    let remaining = count;
    /** 현재 작업 번호가 유효할 때만 다음 시안을 시작한다. */
    const next = () => {
      if (token !== epoch.current) return;
      const current = cloneSettings(snapshot);
      if (remaining !== count) current.seed = makeSeed();
      job.current = runGeneration(current,
        value => { if (token === epoch.current) setProgress(value); },
        value => { if (token !== epoch.current) return; setResults(previous => [value, ...previous].slice(0, 8)); setSelected(0); remaining--; if (remaining > 0) next(); else { setSettings(previous => JSON.stringify(previous) === JSON.stringify(snapshot) ? cloneSettings(value.settings) : previous); setBusy(false); job.current = null; } },
        message => { if (token === epoch.current) { setError(message); setBusy(false); job.current = null; } });
    };
    next();
  }
  /** 생성과 파일 읽기를 취소하되 마지막으로 완성된 시안은 유지한다. */
  function cancel() { epoch.current++; job.current?.cancel(); job.current = null; setBusy(false); setImportingArtwork(false); setImportingMask(false); setProgress(null); }
  /** 채움 영역 변경을 검증하고 사진·SVG 조건을 함께 적용해 다시 생성한다. */
  function changeMask(mask?: FillMask) {
    cancel();
    const next = { ...settingsRef.current, fillMask: mask };
    if (!mask) delete next.fillMask;
    const errors = validateSettings(next);
    if (errors.length) { setError(errors.join(' ')); return; }
    setSettings(next); generate(1, false, next);
  }
  /** 비동기 이미지 읽기 완료 시 현재 작업에만 새 마스크를 적용한다. */
  async function uploadMask(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    cancel(); const token = epoch.current; setImportingMask(true); setError('');
    try {
      const mask = await importMask(file);
      if (token !== epoch.current) return;
      changeMask(mask); setNotice('흰색 영역을 읽었습니다. 경계에 맞춰 패턴을 잘라 배치합니다.');
    } catch (caught) { if (token === epoch.current) setError(caught instanceof Error ? caught.message : '흰색 채움 영역을 불러오지 못했습니다.'); }
    finally { if (token === epoch.current) setImportingMask(false); }
  }
  /** 선택한 SVG만 이동·확대·회전하며 진행 중인 오래된 작업을 무효화한다. */
  function changeArtwork(artwork: SvgArtwork, index = artworkIndex) {
    if (busy || importingArtwork || importingMask) cancel();
    setSettings(previous => withArtworks(previous, getArtworks(previous).map((item, position) => position === index ? constrainArtwork(artwork, resolveCanvas(previous)) : item)));
  }
  /** 선택한 SVG의 배치를 확정하고 모든 SVG를 피해 패턴을 다시 생성한다. */
  function commitArtwork(artwork: SvgArtwork, index = artworkIndex) {
    cancel();
    const current = settingsRef.current;
    const next = withArtworks(current, getArtworks(current).map((item, position) => position === index ? constrainArtwork(artwork, resolveCanvas(current)) : item));
    setSettings(next);
    if (automaticArtwork && JSON.stringify(next) !== JSON.stringify(result?.settings)) generate(1, false, next);
  }
  /** 파일 추가·교체 모두 가져오기 기본 옵션을 적용하고 교체할 때는 기존 배치를 유지한다. */
  async function uploadArtwork(event: React.ChangeEvent<HTMLInputElement>, replaceIndex?: number) {
    const files = Array.from(event.target.files ?? []); event.target.value = '';
    if (!files.length) return;
    cancel(); const token = epoch.current; setImportingArtwork(true);
    try {
      if (files.length + (replaceIndex === undefined ? getArtworks(settingsRef.current).length : 0) > MAX_ARTWORKS) throw new Error(`SVG는 최대 ${MAX_ARTWORKS}개까지 삽입할 수 있습니다.`);
      const imported: SvgArtwork[] = [];
      for (const file of files) {
        if (file.size > 2_000_000) throw new Error(`${file.name}: SVG 파일은 2MB 이하로 선택해 주세요.`);
        const text = await file.text();
        if (token !== epoch.current) return;
        imported.push(importSvg(text, file.name));
      }
      const current = settingsRef.current, previous = getArtworks(current), canvas = resolveCanvas(current);
      const nextArtworks = replaceIndex === undefined
        ? [...previous, ...imported.map((item, offset) => {
          const index = previous.length + offset;
          return constrainArtwork({ ...item, ...(previous.length + imported.length > 1 ? { x: .2 + (index % 4) * .2, y: .25 + Math.floor(index / 4) / 6 } : {}) }, canvas);
        })]
        : previous.map((item, index) => index === replaceIndex ? constrainArtwork({ ...imported[0], x: item.x, y: item.y, widthRatio: item.widthRatio, rotation: item.rotation }, canvas) : item);
      const next = withArtworks(current, nextArtworks), errors = validateSettings(next);
      if (errors.length) throw new Error(errors.join(' '));
      setSelectedArtwork(replaceIndex ?? previous.length);
      setSettings(next); setError(''); setNotice(`SVG ${imported.length}개를 ${replaceIndex === undefined ? '추가' : '교체'}했습니다. 목록이나 그림을 선택해 이동·회전할 수 있습니다.`);
      if (automaticArtwork) generate(1, false, next);
    } catch (caught) { if (token === epoch.current) setError(caught instanceof Error ? caught.message : 'SVG를 불러오지 못했습니다.'); }
    finally { if (token === epoch.current) setImportingArtwork(false); }
  }
  /** 그림 하나만 제거하고 삭제된 그림의 선택을 해제하며 다른 선택과 배치는 유지한다. */
  function removeArtwork(index: number) {
    cancel(); const next = withArtworks(settingsRef.current, getArtworks(settingsRef.current).filter((_, position) => position !== index));
    setSelectedArtwork(position => position === index ? -1 : position > index ? position - 1 : position);
    setSettings(next); if (automaticArtwork) generate(1, false, next);
  }
  /** 화면 해제와 엄격 모드 재실행 때 대기 워커까지 정리한다. */
  useEffect(() => { if (!initial?.results.length) generate(); return () => { epoch.current++; job.current?.cancel(); job.current = null; disposeGenerationWorker(); }; }, []);
  useEffect(() => { try { saveWorkspace(settings, results); } catch { setNotice('브라우저 저장 공간이 부족해 이번 작업을 보관하지 못했어요. 필요한 시안은 파일로 저장해 주세요.'); } }, [settings, results]);
  /** 영역·SVG 변경이 반영된 시안만 저장하고 출력 오류를 사용자에게 전달한다. */
  function save(kind: 'full' | 'sheet' | 'map') {
    if (!result || outputBlocked) return;
    try { const region = regions[Math.min(sheet, regions.length - 1)]; downloadSvg(kind === 'map' ? exportSheetMapSvg(result) : exportSvg(result, kind === 'sheet' ? { sheet: region } : undefined), kind === 'map' ? `패턴_시트배치도_${result.settings.seed}.svg` : getSvgFilename(result, kind === 'sheet' ? region : undefined)); } catch (caught) { setError(caught instanceof Error ? caught.message : '파일을 저장하지 못했어요.'); }
  }
  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#"><span className="brand-symbol"><Command size={21} /></span><strong>패턴 스튜디오<span>공간을 위한 생성형 그래픽</span></strong></a><div className="topbar-right"><span className="local-status"><i />이 브라우저에 자동 저장</span><button className="help-button" title="설정 후 패턴을 생성하고 벡터 파일로 저장하세요." onClick={() => setNotice('왼쪽에서 크기와 형태를 조정한 후 패턴을 생성하세요. 캔버스는 드래그로 이동하고 휠로 확대할 수 있습니다. 파일 저장은 선택한 시안의 설정을 기준으로 합니다.')}><CircleHelp size={18} /></button></div></header>
    <div className="workspace">
      {mobileSettings && <button className="settings-backdrop" aria-label="설정 패널 닫기" onClick={() => setMobileSettings(false)} />}
      <aside className={`sidebar ${mobileSettings ? 'mobile-open' : ''}`}><div className="sidebar-heading"><div><span className="eyebrow">나만의 패턴 만들기</span><h1>패턴 설정</h1></div><SlidersHorizontal className="desktop-settings-icon" size={19} /><button className="mobile-close" title="설정 닫기" onClick={() => setMobileSettings(false)}><X size={20} /></button></div>
        <div className="settings-scroll">
          <Section title="캔버스" open><div className="segmented"><button className={settings.inputMode === 'size' ? 'active' : ''} onClick={() => changeInputMode('size')}>직접 크기</button><button className={settings.inputMode === 'ratio' ? 'active' : ''} onClick={() => changeInputMode('ratio')}>화면 비율</button></div>
            {settings.inputMode === 'size' && <div className="field-row"><label className="field"><span>단위</span><select value={settings.unit} onChange={event => changeUnit(event.target.value as Unit)}><option value="mm">밀리미터 (mm)</option><option value="cm">센티미터 (cm)</option><option value="m">미터 (m)</option><option value="px">픽셀 (px)</option></select></label><button className={`lock-button ${locked ? 'active' : ''}`} title="가로세로 비율 잠금" aria-pressed={locked} onClick={() => setLocked(value => !value)}>{locked ? <LockKeyhole size={17} /> : <UnlockKeyhole size={17} />}</button></div>}
            {settings.inputMode === 'ratio' && <label className="field"><span>화면 비율</span><input value={settings.aspectRatio} list="aspect-options" onChange={event => change('aspectRatio', event.target.value)} /><datalist id="aspect-options"><option value="16:9" /><option value="21:9" /></datalist></label>}
            {settings.inputMode === 'size' && <div className="field-row"><NumberField label="가로" value={settings.width} suffix={lengthUnit} onChange={value => changeSize('width', value)} /><span className="multiply">×</span><NumberField label="세로" value={settings.height} suffix={lengthUnit} onChange={value => changeSize('height', value)} /></div>}
            {(settings.unit === 'px' || settings.inputMode === 'ratio') && <NumberField label="실제 인쇄 가로 (0은 미지정)" value={settings.printWidthMm ?? 0} suffix="mm" onChange={value => change('printWidthMm', value || null)} />}
            {settings.inputMode === 'ratio' && <p className="field-hint">비율 모드에서는 가로 10,000 작업 단위를 기준으로 생성합니다. 실측 인쇄 폭을 지정하면 실제 크기로 출력할 수 있습니다.</p>}
          </Section>
          <Section title="채울 영역 · 흑백 이미지" open badge={settings.fillMask ? '사용 중' : undefined}><FillMaskPanel mask={settings.fillMask} importing={importingMask} onUpload={uploadMask} onChange={changeMask} /></Section>
          <Section title="SVG 삽입" open badge={artworks.length ? `${artworks.length}개` : undefined}><ArtworkPanel artworks={artworks} selectedIndex={artworkIndex} onSelect={setSelectedArtwork} importing={importingArtwork} automatic={automaticArtwork} onAutomatic={setAutomaticArtwork} onUpload={uploadArtwork} onReplace={event => uploadArtwork(event, artworkIndex)} onChange={changeArtwork} onCommit={commitArtwork} onRemove={removeArtwork} /></Section>
          <Section title="색상 · 팔레트" open><ColorPanel key={`${selected}-${result?.settings.seed}`} settings={settings} busy={busy} onChange={changeColors} /></Section>
          <Section title="패턴 구성" open><RangeField label="여백 비율" value={settings.whiteRatio} onChange={value => change('whiteRatio', value)} /><div className="range-caption"><span>촘촘하게</span><span>여유롭게</span></div><div className="field-row"><NumberField label="최소 크기" value={settings.minSize} suffix={lengthUnit} onChange={value => change('minSize', value)} /><NumberField label="최대 크기" value={settings.maxSize} suffix={lengthUnit} onChange={value => change('maxSize', value)} /></div><div className="field-row"><NumberField label="도형 간격" value={settings.gap} suffix={lengthUnit} onChange={value => change('gap', value)} /><NumberField label="바깥 여백" value={settings.margin} suffix={lengthUnit} onChange={value => change('margin', value)} /></div><label className="toggle-row"><span>가장자리 도형 자르기</span><input type="checkbox" checked={!!settings.fillMask || settings.edgeCrop} disabled={!!settings.fillMask} onChange={event => change('edgeCrop', event.target.checked)} /></label></Section>
          <Section title="도형 믹스" open badge={`${Object.keys(SHAPE_LABELS).length}가지`}>{(Object.keys(SHAPE_LABELS) as ShapeKind[]).map(kind => <RangeField key={kind} label={SHAPE_LABELS[kind]} value={settings.weights[kind] ?? 0} max={100} onChange={value => change('weights', { ...settings.weights, [kind]: value })} />)}<p className="field-hint">각 도형의 상대적인 생성 비중입니다. 계단은 2~5단의 채움형·꺾인 선으로 생성됩니다.</p></Section>
          <Section title="세부 형태"><div className="field-row"><NumberField label="최소 꼭짓점" value={settings.vertexMin} min={3} onChange={value => change('vertexMin', value)} /><NumberField label="최대 꼭짓점" value={settings.vertexMax} min={3} onChange={value => change('vertexMax', value)} /></div><RangeField label="오목한 도형 비율" value={settings.concaveRatio} onChange={value => change('concaveRatio', value)} /><NumberField label="회전 각도 간격" value={settings.rotationStep} suffix="도" onChange={value => change('rotationStep', value)} /></Section>
          <Section title="추적 마커" badge={settings.markers.enabled ? '사용 중' : undefined}><label className="toggle-row"><span>추적 마커 포함</span><input type="checkbox" checked={settings.markers.enabled} onChange={event => change('markers', { ...settings.markers, enabled: event.target.checked })} /></label><label className="field"><span>마커 사전</span><select value={settings.markers.dictionary} onChange={event => change('markers', { ...settings.markers, dictionary: event.target.value as PatternSettings['markers']['dictionary'] })}>{['4x4_1000', '5x5_1000', '6x6_1000'].map(value => <option key={value} value={value}>{value.replace('_1000', ' · 1,000개')}</option>)}</select></label><div className="field-row"><NumberField label="마커 개수" value={settings.markers.count} onChange={value => change('markers', { ...settings.markers, count: value })} /><NumberField label="시작 번호" value={settings.markers.startId} onChange={value => change('markers', { ...settings.markers, startId: value })} /></div><NumberField label="마커 한 변" value={settings.markers.side} suffix={lengthUnit} onChange={value => change('markers', { ...settings.markers, side: value })} /><NumberField label="흰 보호 영역" value={settings.markers.quietZoneCells} suffix="칸" onChange={value => change('markers', { ...settings.markers, quietZoneCells: value })} /><label className="toggle-row"><span>마커 회전 허용</span><input type="checkbox" checked={settings.markers.rotate} onChange={event => change('markers', { ...settings.markers, rotate: event.target.checked })} /></label></Section>
          <Section title="분할 출력"><label className="toggle-row"><span>시트 나누기</span><input type="checkbox" checked={settings.sheets.enabled} onChange={event => change('sheets', { ...settings.sheets, enabled: event.target.checked })} /></label>{(['width', 'overlap', 'bleed'] as const).map((key, index) => <NumberField key={key} label={['시트 폭', '겹침 폭', '재단 여유'][index]} value={settings.sheets[key]} suffix={lengthUnit} onChange={value => change('sheets', { ...settings.sheets, [key]: value })} />)}<label className="field"><span>출력 배율</span><select value={settings.sheets.scale} onChange={event => change('sheets', { ...settings.sheets, scale: Number(event.target.value) as 1 | .1 })}><option value="1">실제 크기 · 1:1</option><option value="0.1">축소 출력 · 1:10</option></select></label></Section>
          <Section title="랜덤 시드"><label className="field"><span>같은 시드로 패턴 재현</span><div className="seed-row"><input value={settings.seed} onChange={event => change('seed', event.target.value)} /><button title="새 시드" onClick={() => change('seed', makeSeed())}><RefreshCw size={16} /></button></div></label></Section>
        </div><div className="generate-footer"><button className="primary-button" onClick={() => busy ? cancel() : generate()}>{busy ? <X size={17} /> : <Sparkles size={17} />}{busy ? '생성 취소' : '패턴 생성'}{!busy && <ArrowUpRight size={17} />}</button><button className="batch-button" disabled={busy} onClick={() => generate(4, true)}><Layers size={15} />한 번에 4가지 시안 만들기</button></div>
      </aside>
      <main className="main-stage"><div className="stage-heading"><div><div className="eyebrow">패턴 작업실 <span>/</span> 미리보기</div><h2>우연에서 시작되는 질서<span className="live-dot" /></h2></div><div className="stage-actions"><button className="secondary-button mobile-settings-button" onClick={() => setMobileSettings(value => !value)}><SlidersHorizontal size={16} />설정</button><button className="secondary-button" disabled={busy} onClick={() => generate(1, true)}><RefreshCw size={15} />새 시안</button><button className="dark-button" disabled={!result || outputBlocked} onClick={() => save('full')}><ArrowDownToLine size={16} />벡터 저장</button></div></div>
        {(error || notice) && <div className={error ? 'message error-message' : 'message'} role={error ? 'alert' : 'status'}><span>{error || notice}</span><button title="알림 닫기" onClick={() => { setError(''); setNotice(''); }}><X size={15} /></button></div>}
        <section className="canvas-card"><div className="canvas-topline"><span><i />{result ? '패턴 미리보기' : '캔버스 준비 중'}</span><span>{maskDirty ? '채움 영역 변경 · 재생성 완료 후 저장할 수 있습니다' : artworkDirty ? 'SVG 배치 변경 · 재배치 완료 후 저장할 수 있습니다' : dirty ? '설정이 변경되었어요 · 생성하면 반영됩니다' : '출력 가능한 벡터 원본'}</span></div><Preview result={result} fillMask={settings.fillMask ?? null} artworks={artworks} selectedArtwork={artworkIndex} onArtworkSelect={setSelectedArtwork} onArtworkChange={changeArtwork} onArtworkCommit={commitArtwork} />{busy && <div className="progress-strip"><span className="spinner" /><span>{progress?.phase ?? '패턴 생성 준비 중'}</span><progress value={progress?.progress ?? 0} max={1} /><b>{Math.round((progress?.progress ?? 0) * 100)}%</b></div>}<div className="canvas-bottomline"><span>{result ? `${Number(result.canvas.width.toFixed(2))} × ${Number(result.canvas.height.toFixed(2))} ${result.canvas.lengthUnit}` : '생성 후 크기가 표시됩니다'}</span><span>드래그하여 이동 · 스크롤하여 확대</span></div></section>
        <div className="result-summary"><div><span>{result?.settings.fillMask ? '흰 영역 내 여백' : '실제 여백'}</span><strong>{result ? `${(result.whiteRatio * 100).toFixed(1)}%` : '—'}</strong></div><div><span>생성 도형</span><strong>{result ? result.shapes.filter(shape => shape.kind !== 'marker' && shape.kind !== 'artwork').length.toLocaleString() : '—'}<small>개</small></strong></div><div><span>추적 마커</span><strong>{result ? result.shapes.filter(shape => shape.kind === 'marker').length : '—'}<small>개</small></strong></div><div className="summary-note"><span className="tiny-square" /><p>확대해도 선명하게.<br /><b>모든 패턴은 벡터로 완성됩니다.</b></p></div></div>
        {result && <MarkerTable result={result} />}
        {!!result?.warnings.length && <div className="warnings" role="status">{result.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
        <section className="gallery"><div className="gallery-heading"><h3>시안 보관함 <span>{results.length.toString().padStart(2, '0')}</span></h3><p>화면에 최근 8개 표시 · 자동 저장 개수는 용량에 따라 달라집니다</p></div><div className="gallery-grid">{results.map((item, index) => <div className={`gallery-item ${item === result ? 'selected' : ''}`} key={`${item.settings.seed}-${index}`}><button className="thumbnail-button" aria-label={`시안 ${index + 1} 선택`} onClick={() => { if (busy || importingArtwork || importingMask) cancel(); setSelected(index); setSettings(cloneSettings(item.settings)); setSelectedArtwork(-1); setSheet(0); }}><Preview result={item} small /><span className="thumbnail-number">{String(index + 1).padStart(2, '0')}</span></button><div className="thumbnail-footer"><span>{item === result ? '선택된 시안' : `시안 ${String(index + 1).padStart(2, '0')}`}</span><button title={`시안 ${index + 1} 삭제`} onClick={() => { setResults(previous => previous.filter((_, position) => position !== index)); setSelected(previous => previous === index ? 0 : previous > index ? previous - 1 : previous); }}><Trash2 size={13} /></button></div></div>)}{results.length < 4 && <button className="add-variation" disabled={busy} onClick={() => generate(1, true)}><Sparkles size={21} /><span>새로운 가능성</span><small>시안 추가하기</small></button>}</div></section>
        {result?.settings.sheets.enabled && <section className="export-panel"><div><h3>분할 출력</h3><p>선택한 시안의 출력 설정으로 저장합니다.</p></div><select aria-label="저장할 시트" value={sheet} onChange={event => setSheet(Number(event.target.value))}>{regions.map((region, index) => <option key={region.index} value={index}>시트 {index + 1} / {regions.length}</option>)}</select><button className="secondary-button" disabled={outputBlocked} onClick={() => save('sheet')}>선택 시트 저장</button><button className="secondary-button" disabled={outputBlocked} onClick={() => save('map')}>배치도 저장</button></section>}
        <footer className="stage-footer"><span>공간에 개성을, 시선에 기준을.</span><span>절차적 패턴 · 벡터 출력</span></footer>
      </main>
    </div>
  </div>;
}

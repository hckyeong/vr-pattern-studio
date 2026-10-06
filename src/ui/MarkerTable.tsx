import { ChevronDown } from 'lucide-react';
import type { PatternResult } from '../core/types';

/** 선택한 결과에 실제로 배치된 마커의 작업 좌표와 실측 크기를 표시한다. */
export function MarkerTable({ result }: { result: PatternResult }) {
  const markers = result.shapes.flatMap(shape => shape.marker ? [shape.marker] : []);
  if (!markers.length) return null;
  const physicalScale = result.canvas.physicalWidthMm === null ? null : result.canvas.physicalWidthMm / result.canvas.width;
  return <details className="marker-details"><summary>마커 배치 정보 <span>{markers.length}개</span><ChevronDown size={15} /></summary>
    <p>캔버스 왼쪽 위가 원점이며 좌표와 한 변의 단위는 {result.canvas.lengthUnit}입니다. 한 변은 흰 보호 영역을 제외한 마커 크기입니다.</p>
    <div className="marker-table-scroll"><table><thead><tr><th>번호</th><th>사전</th><th>중심 가로</th><th>중심 세로</th><th>한 변</th>{physicalScale !== null && <th>실측 한 변 (mm)</th>}<th>회전</th><th>시트</th></tr></thead><tbody>{markers.map(marker => <tr key={`${marker.dictionary}-${marker.id}`}><td>{marker.id}</td><td>{marker.dictionary}</td><td>{Number(marker.x.toFixed(3))}</td><td>{Number(marker.y.toFixed(3))}</td><td>{Number(marker.side.toFixed(3))}</td>{physicalScale !== null && <td>{Number((marker.side * physicalScale).toFixed(3))}</td>}<td>{marker.rotation}°</td><td>{marker.sheetIndex + 1}</td></tr>)}</tbody></table></div>
  </details>;
}

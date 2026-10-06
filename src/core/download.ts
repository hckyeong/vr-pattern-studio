/** UTF-8 SVG를 파일로 저장한 뒤 임시 브라우저 주소를 해제한다. */
export function downloadSvg(content: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'image/svg+xml;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-');
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

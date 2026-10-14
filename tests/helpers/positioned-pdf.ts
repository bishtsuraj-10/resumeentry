/** Small real PDF fixture, including URI annotations at the visible label. */
export function positionedPdf(lines: { text: string; x?: number; y?: number; url?: string }[]) {
  const objects: string[] = [];
  const add = (value: string) => { objects.push(value); return objects.length; };
  const escape = (value: string) => value.replace(/[()\\]/g, "\\$&");
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("<< /Type /Pages /Kids [4 0 R] /Count 1 >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  add("");
  const content = lines.map((line, i) => `BT /F1 10 Tf 1 0 0 1 ${line.x ?? 40} ${line.y ?? 790 - i * 20} Tm (${escape(line.text)}) Tj ET\n`).join("");
  const stream = add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`);
  const annotations = lines.flatMap((line, i) => {
    if (!line.url) return [];
    const x = line.x ?? 40, y = line.y ?? 790 - i * 20;
    return [add(`<< /Type /Annot /Subtype /Link /Rect [${x} ${y - 2} ${x + Math.max(20, line.text.length * 6)} ${y + 12}] /Border [0 0 0] /A << /S /URI /URI (${escape(line.url)}) >> >>`)];
  });
  objects[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${stream} 0 R /Annots [${annotations.map(id => `${id} 0 R`).join(" ")}] >>`;
  const chunks = [Buffer.from("%PDF-1.4\n")], offsets = [0];
  let size = chunks[0].length;
  objects.forEach((object, i) => { offsets.push(size); const chunk = Buffer.from(`${i + 1} 0 obj\n${object}\nendobj\n`); chunks.push(chunk); size += chunk.length; });
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

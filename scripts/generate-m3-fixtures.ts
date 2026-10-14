import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { corpus } from "../tests/fixtures/m3-corpus";
const require = createRequire(import.meta.url);
const canvas = require("@napi-rs/canvas") as {
  createCanvas(
    w: number,
    h: number,
  ): {
    getContext(type: "2d"): {
      fillStyle: string;
      font: string;
      fillRect(x: number, y: number, w: number, h: number): void;
      fillText(text: string, x: number, y: number): void;
    };
    toBuffer(type: "image/png" | "image/jpeg"): Buffer;
  };
};
const JSZip = require("jszip") as typeof import("jszip");
function pdf(pages: string[], image?: Buffer) {
  const objects: Buffer[] = [];
  const add = (s: string | Buffer) => {
    objects.push(typeof s === "string" ? Buffer.from(s) : s);
    return objects.length;
  };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const imageId = image
    ? add(
        Buffer.concat([
          Buffer.from(
            `<< /Type /XObject /Subtype /Image /Width 1400 /Height 1600 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`,
          ),
          image,
          Buffer.from("\nendstream"),
        ]),
      )
    : null;
  const pageIds: number[] = [];
  for (const text of pages) {
    let content = "";
    if (imageId && !text) content = "q 595 0 0 680 0 110 cm /Im0 Do Q\n";
    else
      text.split("\n").forEach((line, i) =>
        line.split("\t").forEach((cell, col) => {
          content += `BT /F1 11 Tf 1 0 0 1 ${40 + col * 280} ${800 - i * 20} Tm (${cell.replace(/[()\\]/g, "\\$&")}) Tj ET\n`;
        }),
      );
    const stream = add(
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
    );
    pageIds.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> ${imageId ? `/XObject << /Im0 ${imageId} 0 R >>` : ""} >> /Contents ${stream} 0 R >>`,
      ),
    );
  }
  objects[1] = Buffer.from(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
  );
  const chunks = [Buffer.from("%PDF-1.4\n")],
    offsets = [0];
  let offset = chunks[0].length;
  objects.forEach((object, i) => {
    offsets.push(offset);
    const chunk = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`),
      object,
      Buffer.from("\nendobj\n"),
    ]);
    chunks.push(chunk);
    offset += chunk.length;
  });
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((o) => String(o).padStart(10, "0") + " 00000 n \n")
        .join(
          "",
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`,
    ),
  );
  return Buffer.concat(chunks);
}
async function main() {
  const dir = "tests/fixtures/m3";
  await mkdir(dir, { recursive: true });
  const scan = corpus.find((c) => c.id === "scanned-transcript")!;
  const image = canvas.createCanvas(1400, 1600),
    ctx = image.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 1400, 1600);
  ctx.fillStyle = "black";
  ctx.font = "36px Arial";
  scan.text
    .split("\n")
    .forEach((line, i) => ctx.fillText(line, 80, 100 + i * 70));
  await writeFile(`${dir}/scan.png`, image.toBuffer("image/png"));
  const jpg = image.toBuffer("image/jpeg");
  await writeFile(`${dir}/scan.jpg`, jpg);
  await writeFile(`${dir}/scanned.pdf`, pdf([""], jpg));
  await writeFile(
    `${dir}/mixed.pdf`,
    pdf(
      [
        "ALEX MORGAN\nSoftware Engineer\nalex.morgan@example.com\n+91 98765 43210",
        "",
      ],
      jpg,
    ),
  );
  await writeFile(
    `${dir}/two-column.pdf`,
    pdf([corpus.find((c) => c.id === "two-column")!.text]),
  );
  await writeFile(
    `${dir}/multi-page.pdf`,
    pdf(corpus.find((c) => c.id === "multi-page")!.text.split("\f")),
  );
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  const p = (text: string) =>
    `<w:p><w:r><w:t>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</w:t></w:r></w:p>`;
  const body = corpus
    .find((c) => c.id === "table")!
    .text.split("\n")
    .map((line) =>
      line.includes("\t")
        ? `<w:tbl><w:tr>${line
            .split("\t")
            .map((cell) => `<w:tc>${p(cell)}</w:tc>`)
            .join("")}</w:tr></w:tbl>`
        : p(line),
    )
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  await writeFile(
    `${dir}/table.docx`,
    await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
  );
  console.log("Generated seven synthetic M3 document fixtures.");
}
void main().catch(() => {
  console.error("Fixture generation failed");
  process.exitCode = 1;
});

/**
 * Builds the three synthetic test CVs in all three supported formats:
 *   strong PM  -> PDF, weak SPM -> DOCX, ambiguous PM -> TXT
 * All people and contact details are fictional (example.com addresses).
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";

const SRC = "fixtures/src";

async function toPdf(src: string, out: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = 10;
  const margin = 50;
  const width = 595 - margin * 2;
  let page = doc.addPage([595, 842]);
  let y = 842 - margin;

  const lines = readFileSync(src, "utf8").split("\n");
  lines.forEach((line, i) => {
    const f = i === 0 || /^[A-Z &]+$/.test(line) ? bold : font;
    const words = line.split(" ");
    let current = "";
    const wrapped: string[] = [];
    for (const w of words) {
      const next = current ? `${current} ${w}` : w;
      if (f.widthOfTextAtSize(next, size) > width) {
        wrapped.push(current);
        current = w;
      } else current = next;
    }
    wrapped.push(current);
    for (const l of wrapped) {
      if (y < margin) {
        page = doc.addPage([595, 842]);
        y = 842 - margin;
      }
      page.drawText(l, { x: margin, y, size: i === 0 ? 16 : size, font: f });
      y -= i === 0 ? 22 : 14;
    }
  });
  writeFileSync(out, await doc.save());
}

async function main() {
  await toPdf(`${SRC}/strong_pm_neha_kulkarni.txt`, "fixtures/strong_pm_neha_kulkarni.pdf");
  // macOS textutil produces a real .docx
  execFileSync("textutil", ["-convert", "docx", "-output", "fixtures/weak_spm_karan_malhotra.docx", `${SRC}/weak_spm_karan_malhotra.txt`]);
  copyFileSync(`${SRC}/ambiguous_pm_farah_sayed.txt`, "fixtures/ambiguous_pm_farah_sayed.txt");
  console.log("fixtures written");
}

main();

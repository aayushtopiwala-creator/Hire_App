import mammoth from "mammoth";
import { getDocumentProxy } from "unpdf";

export const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".txt"] as const;

export class UnsupportedFileError extends Error {}

/** File bytes -> plain text. No AI involved. */
export async function extractText(buf: Buffer, fileName: string): Promise<string> {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf("."));
  let text: string;
  if (ext === ".pdf") text = await pdfToText(buf);
  else if (ext === ".docx") text = (await mammoth.extractRawText({ buffer: buf })).value;
  else if (ext === ".txt") text = buf.toString("utf8");
  else throw new UnsupportedFileError(`${fileName}: unsupported type (use PDF, DOCX or TXT)`);

  text = normalize(text);
  if (text.length < 50) {
    throw new UnsupportedFileError(
      `${fileName}: almost no text extracted — is it a scanned image? OCR is not supported.`,
    );
  }
  return text;
}

async function pdfToText(buf: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Rebuild line structure from pdf.js items so header lines (name, contact) stay separate.
    let line = "";
    const lines: string[] = [];
    for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
      if (typeof item.str !== "string") continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = "";
      }
    }
    if (line) lines.push(line);
    pages.push(lines.join("\n"));
  }
  return pages.join("\n\n");
}

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    // NUL and other C0 control chars (seen in a real designed PDF) are rejected by Postgres text/jsonb.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

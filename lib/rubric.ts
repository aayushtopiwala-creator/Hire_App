import { db } from "./supabase";
import type { Role } from "./types";

export interface RubricVersion {
  id: string;
  role: Role;
  content: string;
}

export async function latestRubric(role: Role): Promise<RubricVersion> {
  const { data, error } = await db()
    .from("rubric_versions")
    .select("id, role, content")
    .eq("role", role)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error) throw new Error(`No rubric for ${role}: ${error.message} — run npm run db:migrate`);
  return data;
}

/**
 * Names of real people referenced in the rubric's calibration notes, read from the rubric itself
 * ("Asha Verma (Head of Eng, Exceeds)" — an invented example) so a new rubric version needs no code change.
 */
export function referencedPeople(content: string): string[] {
  const names = new Set<string>(["Arjun"]);
  const re = /([A-Z][a-z]+) ([A-Z][a-z]+) \([^)]*\b(?:Exceeds|Meets|Below)\)/g;
  for (const m of content.matchAll(re)) {
    names.add(m[1]);
    names.add(m[2]);
  }
  return [...names];
}

// Sections that are authoring notes, not scoring instructions. The output format is enforced by responseSchema instead.
const DROP_SECTIONS = [/^WHAT CHANGED/, /^OUTPUT FORMAT/, /^REMAINING GAP/];

/**
 * The rubric as sent to Gemini: category descriptions + score anchors only.
 * Every sentence, bullet or " — " clause that names a real employee is removed; rubric.txt keeps the full version.
 */
export function scoringRubric(content: string): string {
  const people = referencedPeople(content);
  const mentions = (s: string) => people.some((p) => new RegExp(`\\b${p}\\b`).test(s));

  // rubric.txt layout: preamble, then repeated  =====\nHEADING\n=====\nbody
  const parts = content.split(/^=+$/m).map((b) => b.trim());
  const kept: string[] = [];

  // Preamble: title/roles/scale lines only; the "WHAT CHANGED" note after them is dropped.
  kept.push(parts[0].split(/\n\s*\n/)[0]);

  for (let i = 1; i + 1 < parts.length; i += 2) {
    const heading = parts[i];
    const body = parts[i + 1];
    if (DROP_SECTIONS.some((re) => re.test(heading))) continue;
    if (/^TOTAL/.test(heading)) {
      kept.push(heading);
      continue;
    }
    kept.push(`## ${heading}\n${cleanBody(body, mentions)}`);
  }

  const out = kept.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  const leaked = people.filter((p) => new RegExp(`\\b${p}\\b`).test(out));
  if (leaked.length) throw new Error(`scoringRubric: named people survived stripping (${leaked.length}) — refusing to send`);
  return out;
}

type Unit = { kind: "anchor" | "bullet" | "prose" | "blank"; indent: number; text: string };

function cleanBody(body: string, mentions: (s: string) => boolean): string {
  // Group lines into units: anchor items ("0 = ..."), bullets ("- ..."), prose paragraphs.
  // A line indented deeper than the unit that started it is a continuation of that unit.
  const units: Unit[] = [];
  for (const line of body.split("\n")) {
    const t = line.trim();
    const indent = line.length - line.trimStart().length;
    const last = units.at(-1);
    if (!t) units.push({ kind: "blank", indent, text: "" });
    else if (/^\d[\d.]*(?:–\d[\d.]*)? = /.test(t)) units.push({ kind: "anchor", indent, text: t });
    else if (/^- /.test(t)) units.push({ kind: "bullet", indent, text: t });
    else if (last && last.kind !== "blank" && (indent > last.indent || (last.kind === "prose" && indent === last.indent))) {
      last.text += " " + t;
    } else units.push({ kind: "prose", indent, text: t });
  }

  const out: string[] = [];
  for (const u of units) {
    if (u.kind === "blank") out.push("");
    else if (u.kind === "bullet") {
      if (!mentions(u.text)) out.push("  " + u.text);
    } else if (u.kind === "anchor") {
      // "1 = Surface touch — this is <name>'s level, ..." -> keep only clauses without names.
      out.push("  " + balanceParens(u.text.split(" — ").filter((c) => !mentions(c)).join(" — ")));
    } else {
      const sentences = u.text.split(/(?<=[.!?)])\s+(?=[A-Z"])/);
      const keep: string[] = [];
      let droppedPrev = false;
      for (const s of sentences) {
        // Drop sentences naming people, and a directly following sentence that refers back to them.
        const anaphoric = droppedPrev && /^(Neither|Both|They|Their|This|That|These|None)\b/.test(s);
        if (anaphoric) continue;
        if (!mentions(s)) {
          droppedPrev = false;
          keep.push(s);
          continue;
        }
        // Salvage the leading clause when only a trailing " — ..." or ": ..." aside names someone,
        // e.g. "Do not let a strong pedigree substitute ... — that's a bias risk worth naming to <name>."
        const lead = s.split(/ — |: /)[0];
        droppedPrev = true;
        if (lead !== s && !mentions(lead) && lead.length > 40) keep.push(lead.replace(/[,;]$/, "") + ".");
      }
      // A lead-in whose bullet list was removed ("...BEFORE their current specialty:") keeps its sentences —
      // they carry the rubric's own reasoning — and just ends in a full stop instead of a dangling colon.
      let text = keep.join(" ");
      if (text.endsWith(":") && !/anchors:$/i.test(text) && nextIsDropped(units, u, mentions)) text = text.slice(0, -1) + ".";
      if (text) out.push(text);
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function nextIsDropped(units: Unit[], u: Unit, mentions: (s: string) => boolean): boolean {
  const next = units[units.indexOf(u) + 1];
  return !next || (next.kind === "bullet" && mentions(next.text));
}

/** Dropping a trailing "— see <name>'s example)" clause can leave a "(" unclosed. */
function balanceParens(s: string): string {
  const open = (s.match(/\(/g) ?? []).length - (s.match(/\)/g) ?? []).length;
  return open > 0 ? s + ")".repeat(open) : s;
}

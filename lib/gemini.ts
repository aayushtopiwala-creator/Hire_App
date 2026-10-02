import { ApiError, GoogleGenAI, type Schema } from "@google/genai";
import { env } from "./env";
import { findPii, type PiiCheck } from "./pii";
import { db } from "./supabase";
import type { PersonalDetails } from "./types";

/**
 * The ONLY module that talks to Gemini. Every call:
 *   1. runs the PII guard on the exact payload — a leak blocks the call (fail closed),
 *   2. writes the exact payload to ai_calls before sending (audit trail),
 *   3. uses structured output (responseMimeType + responseSchema).
 */

export type Step = "classify" | "extract" | "score" | "draft";

export class PiiBlockedError extends Error {
  constructor(public check: PiiCheck) {
    super(`PII guard blocked the Gemini call: ${check.leaks.map((l) => l.kind).join(", ")}`);
  }
}

let client: GoogleGenAI | null = null;
const ai = () => (client ??= new GoogleGenAI({ apiKey: env.geminiApiKey() }));

// Resolved once per process; replaced only by the ListModels fallback below.
let resolvedModel: string | null = null;

function isModelNotFound(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (e instanceof ApiError && e.status === 404) || /not found|NOT_FOUND|is not supported for generateContent/i.test(msg);
}

function isTransient(e: unknown): boolean {
  return e instanceof ApiError ? [429, 500, 502, 503, 504].includes(e.status) : /fetch failed|ECONNRESET|ETIMEDOUT/.test(String(e));
}

/**
 * "Model not found" fallback: ask the API what this key can use and pick the newest
 * non-preview Flash model, rather than guessing a name.
 */
async function fallbackModel(): Promise<string> {
  const candidates: { name: string; version: number[] }[] = [];
  for await (const m of await ai().models.list()) {
    const name = (m.name ?? "").replace(/^models\//, "");
    if (!/^gemini-[\d.]+-flash$/.test(name)) continue; // plain "flash" only: skips -preview, -exp, -lite, -image, -tts, dated snapshots
    if (m.supportedActions && !m.supportedActions.includes("generateContent")) continue;
    candidates.push({ name, version: name.match(/^gemini-([\d.]+)/)![1].split(".").map(Number) });
  }
  candidates.sort((a, b) => b.version[0] - a.version[0] || (b.version[1] ?? 0) - (a.version[1] ?? 0));
  if (!candidates.length) throw new Error("ListModels returned no non-preview gemini-*-flash model for this key");
  return candidates[0].name;
}

export interface GenerateArgs {
  step: Step;
  candidateId: string;
  /** Used only to check for leaks — never sent. */
  personal: PersonalDetails;
  /** Fixed instructions + rubric. Checked for email/phone shapes. */
  systemInstruction: string;
  /** Candidate-derived content (redacted CV / profile JSON). Checked for all PII incl. the candidate's name. */
  contents: string;
  schema: Schema;
  temperature?: number;
}

export async function generateJson<T>(args: GenerateArgs): Promise<T> {
  const check = findPii(args.contents, args.personal, args.systemInstruction);
  // If we don't confidently know the name, we can't know it was redacted: fail closed until the founder confirms it.
  if (!args.personal.name || args.personal.name_confidence === "low") {
    check.ok = false;
    check.leaks.push({ kind: "name", sample: args.personal.name ? "low-confidence name — confirm it first" : "name not detected — enter it first" });
  }
  const model = resolvedModel ?? env.geminiModel();

  const { data: log, error: logErr } = await db()
    .from("ai_calls")
    .insert({
      candidate_id: args.candidateId,
      step: args.step,
      model,
      system_instruction: args.systemInstruction,
      contents: check.ok ? args.contents : "[withheld — PII guard blocked this call]",
      response_schema: args.schema,
      pii_check: check,
      status: check.ok ? "sent" : "blocked",
    })
    .select("id")
    .single();
  // No audit row, no call.
  if (logErr) throw new Error(`ai_calls audit insert failed: ${logErr.message}`);
  if (!check.ok) throw new PiiBlockedError(check);

  const started = Date.now();
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const useModel = resolvedModel ?? env.geminiModel();
    try {
      const res = await ai().models.generateContent({
        model: useModel,
        contents: args.contents,
        config: {
          systemInstruction: args.systemInstruction,
          responseMimeType: "application/json",
          responseSchema: args.schema,
          temperature: args.temperature ?? 0.2,
        },
      });
      const text = res.text ?? "";
      const parsed = JSON.parse(text) as T; // throws -> retried
      await db()
        .from("ai_calls")
        .update({ status: "ok", model: useModel, response_text: text, latency_ms: Date.now() - started })
        .eq("id", log.id);
      return parsed;
    } catch (e) {
      lastErr = e;
      if (isModelNotFound(e) && !resolvedModel) {
        resolvedModel = await fallbackModel();
        console.warn(`[gemini] model "${env.geminiModel()}" not found; falling back to "${resolvedModel}" from ListModels`);
        continue;
      }
      if (e instanceof SyntaxError || isTransient(e)) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      break;
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  await db().from("ai_calls").update({ status: "error", error: msg, latency_ms: Date.now() - started }).eq("id", log.id);
  throw new Error(`Gemini ${args.step} failed: ${msg}`);
}

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { LEVELS, TOPICS, type Level, type Topic } from "@/db/schema";
import { LEVEL_LABELS, TOPIC_LABELS, slots, type Blueprint } from "@/domain/blueprint";
import { errorSummary } from "@/lib/errmsg";

/**
 * ให้ Claude ออกข้อสอบจากเอกสารต้นทาง (spec §3) — **จุดเดียวที่คุยกับ Anthropic API**
 * โค้ดอื่นคุยกับ `ExamModel` · เทสต์แทนด้วยตัวปลอมที่ขอบนี้
 *
 * ★ ออก 5 ชุดในคำขอเดียว ไม่ใช่ 5 คำขอ — ให้ AI เห็นทุกชุดพร้อมกันจึงไม่ซ้ำข้ามชุด และจบในเวลาเดียวของ function
 * ★ ผลของ AI ไม่ถูกเชื่อตรง ๆ: ตรวจช่องหัวข้อ×ระดับครบตาม blueprint · 4 ตัวเลือกไม่ซ้ำ · มีที่มา (`checkForms`)
 *   แล้วผู้อนุมัติตรวจทุกข้ออีกชั้น (ADR-0004)
 */

export const EXAM_MODEL_ID = "claude-opus-5-5";

const QuestionSchema = z.object({
  topic: z.enum(TOPICS),
  level: z.enum(LEVELS),
  text: z.string(),
  choices: z.array(z.string()),
  correct_index: z.number().int(),
  source_ref: z.string(),
});

const FormsSchema = z.object({
  forms: z.array(z.object({ questions: z.array(QuestionSchema) })),
});

const SingleSchema = z.object({ question: QuestionSchema });

export interface GeneratedQuestion {
  topic: Topic;
  level: Level;
  text: string;
  choices: string[];
  correctIndex: number;
  sourceRef: string;
}

export interface SourceDocument {
  fileName: string;
  kind: string;
  /** PDF เท่านั้นในรุ่นนี้ (`aiReadable`) */
  pdf: Uint8Array;
}

export interface GenerateInput {
  setTitle: string;
  documents: SourceDocument[];
  blueprint: Blueprint;
  formCount: number;
}

export interface RegenerateInput {
  setTitle: string;
  documents: SourceDocument[];
  topic: Topic;
  level: Level;
  /** ข้อสอบอื่นในชุดเดียวกัน — ห้ามซ้ำ */
  avoid: string[];
  /** ข้อเดิมที่จะถูกแทน */
  replacing: string;
}

export type ModelResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface ExamModel {
  generateForms(input: GenerateInput): Promise<ModelResult<GeneratedQuestion[][]>>;
  regenerateQuestion(input: RegenerateInput): Promise<ModelResult<GeneratedQuestion>>;
}

// ── ตรวจผลของ AI ────────────────────────────────────────────────────────────

type RawQuestion = z.infer<typeof QuestionSchema>;

function toQuestion(q: RawQuestion): GeneratedQuestion {
  return {
    topic: q.topic,
    level: q.level,
    text: q.text.trim(),
    choices: q.choices.map((c) => c.trim()),
    correctIndex: q.correct_index,
    sourceRef: q.source_ref.trim(),
  };
}

/** ข้อเดียวถูกรูปไหม — ใช้ทั้งตอนออกทั้งชุดและออกใหม่ทีละข้อ */
export function checkQuestion(q: GeneratedQuestion): string | null {
  if (!q.text) return "คำถามว่าง";
  if (q.choices.length !== 4) return `ต้องมี 4 ตัวเลือก (ได้ ${q.choices.length})`;
  if (q.choices.some((c) => !c)) return "มีตัวเลือกว่าง";
  if (new Set(q.choices).size !== 4) return "ตัวเลือกซ้ำกัน";
  if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3) return "เฉลยไม่อยู่ใน 4 ตัวเลือก";
  if (!q.sourceRef) return "ไม่ได้ระบุที่มาในเอกสาร";
  return null;
}

function slotKey(s: { topic: string; level: string }) {
  return `${s.topic}:${s.level}`;
}

/** ทุกชุดต้องมีหัวข้อ×ระดับตรงกับ blueprint ครบทุกช่อง (ลำดับไม่สำคัญ) และคำถามไม่ซ้ำข้ามชุด */
export function checkForms(forms: GeneratedQuestion[][], blueprint: Blueprint, formCount: number): string | null {
  if (forms.length !== formCount) return `ต้องได้ ${formCount} ชุด (ได้ ${forms.length})`;
  const want = slots(blueprint).map(slotKey).sort().join("|");
  const seen = new Set<string>();
  for (const [i, form] of forms.entries()) {
    const got = form.map(slotKey).sort().join("|");
    if (got !== want) return `ชุดที่ ${i + 1}: หัวข้อ/ระดับไม่ตรงกับสัดส่วนที่ตั้งไว้`;
    for (const [j, q] of form.entries()) {
      const bad = checkQuestion(q);
      if (bad) return `ชุดที่ ${i + 1} ข้อ ${j + 1}: ${bad}`;
      const norm = q.text.trim().replace(/\s+/g, " ").toLowerCase();
      if (seen.has(norm)) return `ชุดที่ ${i + 1} ข้อ ${j + 1}: คำถามซ้ำกับชุดอื่น`;
      seen.add(norm);
    }
  }
  return null;
}

// ── Claude ──────────────────────────────────────────────────────────────────

const SYSTEM = `คุณออกข้อสอบปรนัยภาษาไทยให้พนักงานบริษัทเฟอร์นิเจอร์สำนักงาน Work Station
เพื่อวัดว่าเข้าใจเอกสารสินค้าหรือเอกสารการขายที่แนบมาจริง ไม่ใช่แค่ท่องจำ

กติกา:
- ทุกข้อต้องตอบได้จากเอกสารที่แนบเท่านั้น และต้องระบุที่มาใน source_ref ให้คนตรวจตามไปเปิดดูได้ เช่น "Signature.pdf หน้า 5"
- 4 ตัวเลือก ถูกข้อเดียว ตัวเลือกผิดต้องฟังดูเป็นไปได้ (เช่น ขนาดหรือราคาของรุ่นอื่นในเอกสารเดียวกัน) ไม่ใช่ผิดชัดจนเดาได้
- ตัวเลข ราคา ขนาด รหัสสินค้า ต้องตรงกับเอกสารทุกตัวอักษร
- ระดับ "จำ" = ถามข้อเท็จจริงในเอกสาร · "เข้าใจ" = เปรียบเทียบหรืออธิบายเหตุผล · "สถานการณ์" = ลูกค้าต้องการแบบนี้ ควรเสนออะไร
- ห้ามใช้ "ถูกทุกข้อ" หรือ "ไม่มีข้อใดถูก" และอย่าให้ตัวเลือกที่ถูกยาวกว่าตัวอื่นอย่างเห็นได้ชัด
- กระจายตำแหน่งเฉลยให้ไม่ซ้ำรูปแบบ`;

function slotLines(blueprint: Blueprint): string {
  return blueprint
    .map((c) => `- ${TOPIC_LABELS[c.topic]} (topic="${c.topic}") ระดับ${LEVEL_LABELS[c.level]} (level="${c.level}"): ${c.count} ข้อ`)
    .join("\n");
}

function documentBlocks(docs: SourceDocument[]): Anthropic.Beta.BetaContentBlockParam[] {
  return docs.map((d, i) => ({
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: Buffer.from(d.pdf).toString("base64") },
    title: d.fileName,
    // cache ที่เอกสารชิ้นสุดท้าย — การออกใหม่ทีละข้อของผู้อนุมัติอ่านเอกสารชุดเดิมซ้ำภายในไม่กี่นาที
    ...(i === docs.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
}

/**
 * ★ `fallbacks: "default"` — ถ้า Claude Opus 5.5 ปฏิเสธด้วยตัวกรองความปลอดภัย (ไม่น่าเกิดกับเอกสารสินค้า)
 *   API ส่งต่อให้โมเดลสำรองในคำขอเดียวกันเอง แทนที่จะจบเงียบ ๆ
 */
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

function refusalMessage(stopReason: string | null): string | null {
  if (stopReason === "refusal") return "AI ปฏิเสธการออกข้อสอบจากเอกสารนี้";
  if (stopReason === "max_tokens") return "AI ตอบยาวเกินกำหนด — ลองลดจำนวนเอกสาร";
  return null;
}

export function claudeExamModel(client?: Anthropic): ExamModel | null {
  if (!client && !process.env.ANTHROPIC_API_KEY) return null;
  const c = client ?? new Anthropic();

  return {
    async generateForms(input) {
      try {
        const stream = c.beta.messages.stream({
          model: EXAM_MODEL_ID,
          max_tokens: 64000,
          ...FALLBACK,
          thinking: { type: "adaptive" },
          output_config: { effort: "high", format: betaZodOutputFormat(FormsSchema) },
          system: SYSTEM,
          messages: [
            {
              role: "user",
              content: [
                ...documentBlocks(input.documents),
                {
                  type: "text",
                  text: `ชุดการเรียนรู้: ${input.setTitle}

ออกข้อสอบ ${input.formCount} ชุด ชุดละ ${slots(input.blueprint).length} ข้อ ทุกชุดใช้สัดส่วนเดียวกันนี้:
${slotLines(input.blueprint)}

คำถามห้ามซ้ำกันทั้งภายในชุดและข้ามชุด · แต่ละชุดควรครอบคลุมรุ่น/หัวข้อต่างกันในเอกสาร`,
                },
              ],
            },
          ],
        });
        const msg = await stream.finalMessage();
        const refused = refusalMessage(msg.stop_reason);
        if (refused) return { ok: false, error: refused };
        if (!msg.parsed_output) return { ok: false, error: "อ่านผลของ AI ไม่ได้" };
        return { ok: true, value: msg.parsed_output.forms.map((f) => f.questions.map(toQuestion)) };
      } catch (err) {
        return { ok: false, error: apiError(err) };
      }
    },

    async regenerateQuestion(input) {
      try {
        const msg = await c.beta.messages.parse({
          model: EXAM_MODEL_ID,
          max_tokens: 16000,
          ...FALLBACK,
          thinking: { type: "adaptive" },
          output_config: { effort: "high", format: betaZodOutputFormat(SingleSchema) },
          system: SYSTEM,
          messages: [
            {
              role: "user",
              content: [
                ...documentBlocks(input.documents),
                {
                  type: "text",
                  text: `ชุดการเรียนรู้: ${input.setTitle}

ออกข้อสอบใหม่ 1 ข้อ แทนข้อนี้: "${input.replacing}"
หัวข้อ ${TOPIC_LABELS[input.topic]} (topic="${input.topic}") ระดับ${LEVEL_LABELS[input.level]} (level="${input.level}")
ห้ามซ้ำกับข้อเดิมและข้อเหล่านี้:
${input.avoid.map((t) => `- ${t}`).join("\n")}`,
                },
              ],
            },
          ],
        });
        const refused = refusalMessage(msg.stop_reason);
        if (refused) return { ok: false, error: refused };
        if (!msg.parsed_output) return { ok: false, error: "อ่านผลของ AI ไม่ได้" };
        return { ok: true, value: toQuestion(msg.parsed_output.question) };
      } catch (err) {
        return { ok: false, error: apiError(err) };
      }
    },
  };
}

function apiError(err: unknown): string {
  console.log(JSON.stringify({ msg: "exam_model_failed", error: errorSummary(err) }));
  if (err instanceof Anthropic.RateLimitError) return "AI ถูกใช้งานหนักอยู่ ลองใหม่อีกสักครู่";
  if (err instanceof Anthropic.AuthenticationError) return "ตั้งค่า ANTHROPIC_API_KEY บนเซิร์ฟเวอร์ไม่ถูกต้อง";
  if (err instanceof Anthropic.BadRequestError) return `AI ไม่รับคำขอ: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `AI ตอบผิดพลาด (${err.status ?? "ไม่มีรหัส"})`;
  return "ติดต่อ AI ไม่ได้ ลองใหม่อีกครั้ง";
}

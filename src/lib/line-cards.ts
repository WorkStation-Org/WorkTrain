import { box, button, FLEX_ALT_TEXT_MAX, FLEX_COLOR, text, uriAction, type FlexComponent, type FlexMessage } from "@/lib/flex";
import { formatBangkok, formatThaiDay, relativeDue } from "@/lib/time";

/**
 * การ์ด LINE (Flex) ของ WorkTrain — ทุกข้อความที่ส่งผ่าน Work Bot (ADR-0024)
 *
 * ★ ทุกดอกมีคู่ `text` เสมอ: เก็บลง `notifications.text` · ใช้แทนเมื่อ Flex ไม่ผ่าน `checkFlexMessage()` (deliver.ts)
 *   และเป็นที่มาของ `altText` (บรรทัดแรก — ไม่มีลิงก์) ที่ขึ้นใน notification ของมือถือ
 * ★ ลิงก์ที่ไม่ใช่ https (เครื่อง dev) ไม่ใส่ในการ์ด — LINE ปฏิเสธทั้งดอก
 */

/** ข้อความหนึ่งดอก */
export interface LineMessage {
  text: string;
  flex: FlexMessage | null;
}

export function appUrl(path = "/"): string {
  return `${process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, "") ?? ""}${path}`;
}

/** สีแถบหัวการ์ด — บอกน้ำหนักของเรื่องก่อนอ่าน */
export type CardTone = "brand" | "warning" | "danger" | "success" | "neutral";

const TONE_BG: Record<CardTone, string> = {
  brand: FLEX_COLOR.brand,
  warning: FLEX_COLOR.warning,
  danger: FLEX_COLOR.danger,
  success: FLEX_COLOR.success,
  neutral: FLEX_COLOR.ink3,
};

export interface CardItem {
  title: string;
  /** แถว ป้าย · ค่า ใต้ชื่อ */
  rows?: readonly (readonly [string, string])[];
  /** แตะทั้งกล่องเพื่อเปิด */
  url?: string;
}

export interface CardSpec {
  tone: CardTone;
  /** บรรทัดเล็กเหนือหัวข้อ เช่น "WorkTrain · ชุดการเรียนรู้" */
  eyebrow: string;
  head: string;
  intro?: string;
  items?: readonly CardItem[];
  /** หน่วยของรายการ — ใช้ในบรรทัด "และอีก n ชุด" เมื่อเกิน `MAX_CARD_ITEMS` */
  unit?: string;
  /** บรรทัดท้ายการ์ด (หลังรายการ) */
  lines?: readonly string[];
  action?: { label: string; url: string };
}

/** รายการที่แสดงในการ์ดหนึ่งใบ — เกินนี้สรุปเป็น "และอีก n" (กัน Flex เกิน 30KB และอ่านง่ายบนมือถือ) */
export const MAX_CARD_ITEMS = 8;

const isHttps = (u: string | undefined): u is string => typeof u === "string" && u.startsWith("https://");
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function itemBox(item: CardItem, first: boolean): FlexComponent {
  const rows = (item.rows ?? [])
    .filter(([, v]) => v.trim().length > 0)
    .map(([label, value]) =>
      box(
        "horizontal",
        [
          text(label, { size: "xs", color: FLEX_COLOR.ink3, flex: 2 }),
          text(value, { size: "xs", color: FLEX_COLOR.ink2, flex: 5, wrap: true, align: "end" }),
        ],
        { margin: "xs" },
      ),
    );
  return box("vertical", [text(item.title, { size: "sm", weight: "bold", color: FLEX_COLOR.ink, wrap: true, maxLines: 3 }), ...rows], {
    backgroundColor: FLEX_COLOR.surface2,
    cornerRadius: "8px",
    paddingAll: "12px",
    margin: first ? "md" : "sm",
    ...(isHttps(item.url) ? { action: uriAction("เปิดชุด", item.url) } : {}),
  });
}

/** การ์ดหนึ่งใบ — `altText` มาจากบรรทัดแรกของข้อความล้วน */
export function card(spec: CardSpec, altText: string): FlexMessage {
  const items = spec.items ?? [];
  const shown = items.slice(0, MAX_CARD_ITEMS);
  const body: FlexComponent[] = [
    ...(spec.intro ? [text(spec.intro, { size: "sm", color: FLEX_COLOR.ink2, wrap: true })] : []),
    ...shown.map((it, i) => itemBox(it, i === 0 && Boolean(spec.intro))),
    ...(items.length > shown.length
      ? [text(`และอีก ${items.length - shown.length} ${spec.unit ?? "รายการ"}`, { size: "xs", color: FLEX_COLOR.ink3, margin: "sm" })]
      : []),
    ...(spec.lines ?? []).filter((l) => l.trim()).map((l) => text(l, { size: "sm", color: FLEX_COLOR.ink, wrap: true, margin: "md" })),
  ];
  const onTone = spec.tone === "brand" ? FLEX_COLOR.onBrandMuted : FLEX_COLOR.onBrand;
  return {
    type: "flex",
    altText: clip(altText.trim() || spec.head, FLEX_ALT_TEXT_MAX),
    contents: {
      type: "bubble",
      size: "mega",
      header: box(
        "vertical",
        [
          text(spec.eyebrow, { size: "xs", color: onTone }),
          text(spec.head, { size: "lg", weight: "bold", color: FLEX_COLOR.onBrand, wrap: true, margin: "xs" }),
        ],
        { backgroundColor: TONE_BG[spec.tone], paddingAll: "16px" },
      ),
      body: box("vertical", body.length ? body : [text(spec.head, { size: "sm", color: FLEX_COLOR.ink, wrap: true })], { paddingAll: "16px" }),
      ...(spec.action && isHttps(spec.action.url)
        ? {
            footer: box("vertical", [button(spec.action.label, spec.action.url, { style: "primary", color: FLEX_COLOR.brand, height: "sm" })], {
              paddingAll: "12px",
              paddingTop: "0px",
            }),
          }
        : {}),
    },
  };
}

/** ข้อความล้วน + การ์ด — `altText` = บรรทัดแรกของ `text` */
export function cardMessage(spec: CardSpec, plain: string): LineMessage {
  return { text: plain, flex: card(spec, plain.split("\n")[0] ?? spec.head) };
}

// ── การมอบและการเตือน (ถึงผู้เรียน) ─────────────────────────────────────────

const LEARN = "WorkTrain · ชุดการเรียนรู้";

/** การมอบหนึ่งรายการในข้อความ */
export interface DueItem {
  assignmentId: number;
  title: string;
  dueAt: Date;
}

const dueLabel = (due: Date, now: Date) => `${formatThaiDay(due, now)} · ${relativeDue(due, now)}`;
const dueItem = (d: DueItem, now: Date): CardItem => ({ title: d.title, rows: [["กำหนดส่ง", dueLabel(d.dueAt, now)]], url: appUrl(`/learn/${d.assignmentId}`) });
/** ปุ่มหลัก — เรื่องเดียวเปิดชุดนั้นตรง ๆ · หลายเรื่องเปิดรายการของฉัน */
const learnAction = (items: readonly DueItem[], label: string) => ({ label, url: items.length === 1 ? appUrl(`/learn/${items[0].assignmentId}`) : appUrl("/learn") });

export type DayZeroVariant = "assigned" | "reassigned" | "golive";

const DAY_ZERO = {
  assigned: { icon: "📚", head: "ชุดการเรียนรู้ใหม่", intro: "เรียนให้ครบแล้วสอบให้ผ่าน 80% ภายในกำหนดส่ง" },
  reassigned: { icon: "🔁", head: "ได้รับมอบอีกครั้ง", intro: "เรียนให้ครบแล้วสอบให้ผ่าน 80% ภายในกำหนดส่งใหม่" },
  golive: {
    icon: "📚",
    head: "ชุดการเรียนรู้ที่ต้องเรียน",
    intro: "WorkTrain เริ่มแจ้งทาง LINE แล้ว — ชุดที่คุณได้รับมอบไว้และยังสอบไม่ผ่าน เรียนให้ครบแล้วสอบให้ผ่าน 80%",
  },
} as const;

/** วันที่ 0 — ชุดใหม่ · ได้รับมอบอีกครั้ง · แจ้งซ้ำของช่วงทดสอบ (หลายชุดของคนเดียว = การ์ดเดียว) */
export function dayZeroMessage(variant: DayZeroVariant, items: readonly DueItem[], now: Date): LineMessage {
  const v = DAY_ZERO[variant];
  const plain =
    items.length === 1
      ? `${v.icon} ${v.head}: ${items[0].title}\nเรียนแล้วสอบให้ผ่าน 80% ภายใน ${formatBangkok(items[0].dueAt)}\n${appUrl()}`
      : [`${v.icon} ${v.head} ${items.length} ชุด — เรียนแล้วสอบให้ผ่าน 80%`, ...items.map((d) => `- ${d.title} · ภายใน ${formatBangkok(d.dueAt)}`), appUrl()].join("\n");
  return cardMessage(
    {
      tone: "brand",
      eyebrow: LEARN,
      head: items.length === 1 ? v.head : `${v.head} ${items.length} ชุด`,
      intro: v.intro,
      items: items.map((d) => dueItem(d, now)),
      unit: "ชุด",
      action: learnAction(items, "เริ่มเรียน"),
    },
    plain,
  );
}

/** ไม่ต้องเรียนแล้ว — หลุดเงื่อนไขผู้รับ (ADR-0017) */
export function endedMessage(titles: readonly string[]): LineMessage {
  const plain =
    titles.length === 1
      ? `📕 ชุดการเรียนรู้ ${titles[0]} ไม่ต้องเรียนแล้ว (คุณไม่อยู่ในกลุ่มผู้รับของชุดนี้แล้ว)`
      : [`📕 ไม่ต้องเรียนแล้ว ${titles.length} ชุด (คุณไม่อยู่ในกลุ่มผู้รับของชุดเหล่านี้แล้ว)`, ...titles.map((t) => `- ${t}`)].join("\n");
  return cardMessage(
    {
      tone: "neutral",
      eyebrow: LEARN,
      head: titles.length === 1 ? "ไม่ต้องเรียนแล้ว" : `ไม่ต้องเรียนแล้ว ${titles.length} ชุด`,
      intro: titles.length === 1 ? "คุณไม่อยู่ในกลุ่มผู้รับของชุดนี้แล้ว" : "คุณไม่อยู่ในกลุ่มผู้รับของชุดเหล่านี้แล้ว",
      items: titles.map((title) => ({ title })),
      unit: "ชุด",
      action: { label: "เปิด WorkTrain", url: appUrl("/learn") },
    },
    plain,
  );
}

/** เตือนวันที่ 3 — ยังไม่ได้เริ่ม */
export function notStartedMessage(items: readonly DueItem[], now: Date): LineMessage {
  const plain =
    items.length === 1
      ? `⏰ ยังไม่ได้เริ่มเรียน: ${items[0].title}\nกำหนดส่ง ${formatBangkok(items[0].dueAt)}\n${appUrl()}`
      : [`⏰ ยังไม่ได้เริ่มเรียน ${items.length} ชุด`, ...items.map((d) => `- ${d.title} · กำหนดส่ง ${formatBangkok(d.dueAt)}`), appUrl()].join("\n");
  return cardMessage(
    {
      tone: "warning",
      eyebrow: LEARN,
      head: items.length === 1 ? "ยังไม่ได้เริ่มเรียน" : `ยังไม่ได้เริ่มเรียน ${items.length} ชุด`,
      intro: "เริ่มวันนี้ยังทันกำหนดส่ง",
      items: items.map((d) => dueItem(d, now)),
      unit: "ชุด",
      action: learnAction(items, "เริ่มเรียน"),
    },
    plain,
  );
}

/** หนึ่งการมอบในข้อความถึงคนอื่น (กลุ่มประจำตัว · หัวหน้า) */
export interface PersonDueItem extends DueItem {
  /** ชื่อที่ใช้เรียก — ชื่อเล่นถ้ามี */
  person: string;
}

/** เตือนวันที่ 5 แบบตัวต่อตัว — ไม่มีกลุ่ม LINE ประจำตัว */
export function notPassedMessage(items: readonly PersonDueItem[], now: Date): LineMessage {
  const line = (d: PersonDueItem) => `- ${d.person} · ${d.title} · กำหนดส่ง ${formatBangkok(d.dueAt)}`;
  const plain = items.length === 1 ? `⚠️ ยังสอบไม่ผ่าน\n${line(items[0])}\n${appUrl()}` : [`⚠️ ยังสอบไม่ผ่าน (${items.length})`, ...items.map(line), appUrl()].join("\n");
  return cardMessage(
    {
      tone: "danger",
      eyebrow: LEARN,
      head: items.length === 1 ? "ยังสอบไม่ผ่าน" : `ยังสอบไม่ผ่าน ${items.length} ชุด`,
      intro: "ใกล้กำหนดส่งแล้ว — เรียนให้ครบแล้วสอบให้ผ่าน 80%",
      items: items.map((d) => dueItem(d, now)),
      unit: "ชุด",
      action: learnAction(items, "เปิดชุดการเรียนรู้"),
    },
    plain,
  );
}

/** เตือนวันที่ 5 เข้ากลุ่มประจำตัว (เจ้าตัว + หัวหน้า) — ไล่ชื่อคน ไม่มีลิงก์รายชุด (เปิดได้เฉพาะเจ้าของการมอบ) */
export function notPassedGroupMessage(items: readonly PersonDueItem[], now: Date): LineMessage {
  const plain = [`⚠️ ยังสอบไม่ผ่าน (${items.length})`, ...items.map((d) => `- ${d.person} · ${d.title} · กำหนดส่ง ${formatBangkok(d.dueAt)}`), appUrl()].join("\n");
  return cardMessage(
    {
      tone: "danger",
      eyebrow: LEARN,
      head: `ยังสอบไม่ผ่าน (${items.length})`,
      intro: "ใกล้กำหนดส่งแล้ว — เรียนให้ครบแล้วสอบให้ผ่าน 80%",
      items: items.map((d) => ({ title: d.person, rows: [["ชุด", d.title], ["กำหนดส่ง", dueLabel(d.dueAt, now)]] })),
      unit: "คน",
      action: { label: "เปิด WorkTrain", url: appUrl("/learn") },
    },
    plain,
  );
}

/** สรุปวันจันทร์ถึงหัวหน้า — ลูกทีมที่เลยกำหนดส่งและยังสอบไม่ผ่าน */
export function overdueMessage(items: readonly PersonDueItem[], now: Date): LineMessage {
  const plain = [`📋 ลูกทีมที่เลยกำหนดส่งและยังสอบไม่ผ่าน (${items.length})`, ...items.map((d) => `- ${d.person} · ${d.title}`)].join("\n");
  return cardMessage(
    {
      tone: "danger",
      eyebrow: "WorkTrain · สรุปวันจันทร์",
      head: `ลูกทีมเลยกำหนดส่ง (${items.length})`,
      intro: "เลยกำหนดส่งและยังสอบไม่ผ่าน",
      items: items.map((d) => ({ title: d.person, rows: [["ชุด", d.title], ["กำหนดส่ง", dueLabel(d.dueAt, now)]] })),
      unit: "รายการ",
      action: { label: "ดูภาพรวม", url: appUrl("/dashboard") },
    },
    plain,
  );
}

/** เวอร์ชันใหม่ถึงคนที่ผ่านแล้ว (spec §7) */
export function newVersionMessage(input: { assignmentId: number; title: string; label: string | null; what: string }): LineMessage {
  const url = appUrl(`/learn/${input.assignmentId}`);
  return cardMessage(
    {
      tone: "brand",
      eyebrow: LEARN,
      head: "มีเวอร์ชันใหม่",
      intro: input.what,
      items: [{ title: input.title, rows: input.label ? [["เวอร์ชัน", input.label]] : [], url }],
      action: { label: "เปิดชุดนี้", url },
    },
    `🔄 ${input.title} มีเวอร์ชันใหม่${input.label ? ` (${input.label})` : ""} — ${input.what}\n${url}`,
  );
}

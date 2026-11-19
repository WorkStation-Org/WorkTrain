/**
 * LINE Flex Message — ยกจาก WorkDaily `src/lib/flex.ts` (เฉพาะส่วนย่อยที่ใช้) · ส่งผ่าน GateWay `messages` ตรง ๆ
 * (GateWay ไม่แตะโครง แค่เดินหา URI ไปย่อลิงก์ และใช้ `label` ของ action เป็น tracking) · การ์ดของ WorkTrain อยู่ที่ `line-cards.ts`
 *
 * ★ ทำไมต้องมี `checkFlexMessage()`: GateWay รับข้อความเข้าคิวแล้วตอบ 202 ก่อนถึง LINE — ถ้า LINE ปฏิเสธ Flex
 *   (altText ยาวเกิน · JSON เกิน 30KB · uri ไม่ใช่ https) เราไม่มีทางรู้ตอนส่ง แล้วข้อความจะหายเงียบ ๆ
 *   (ข้อ 12 — บั๊ก PDList) · ผู้ส่งจึงตรวจเองก่อน ถ้าไม่ผ่านให้ถอยไปส่งข้อความล้วนแทน (`toLineMessages()` ใน deliver.ts)
 *   ส่วนความถูกต้องของโครง (ชื่อ property) ตรึงด้วยเทสต์ `flex.test.ts` เพราะเป็นของตายตัวตามโค้ด
 */

/** สีของ Flex — ต้องเป็น hex (LINE ไม่รู้จัก CSS variable) · `flex.test.ts` ตรวจว่าตรงกับ `--wt-*` (ธีมสว่าง) ใน globals.css */
export const FLEX_COLOR = {
  brand: "#161719",
  onBrand: "#ffffff",
  onBrandMuted: "#a4a7ad",
  ink: "#1b1c1e",
  ink2: "#45484d",
  ink3: "#6c7077",
  line: "#e7e8ea",
  surface2: "#f7f7f8",
  surface3: "#f0f0f2",
  danger: "#a84444",
  dangerSoft: "#f8eded",
  warning: "#8a5a12",
  warningSoft: "#f8f1e4",
  success: "#2f6b45",
  successSoft: "#e9f2ec",
} as const;

type Spacing = "none" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl" | `${number}px`;
type TextSize = "xxs" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl";

export interface FlexUriAction {
  type: "uri";
  /** ไม่เกิน 20 ตัวอักษร · GateWay ใช้เป็นชื่อปุ่มตอนนับการกด */
  label: string;
  /** https เท่านั้น ไม่เกิน 1000 ตัวอักษร */
  uri: string;
}

export interface FlexText {
  type: "text";
  text: string;
  size?: TextSize;
  weight?: "regular" | "bold";
  color?: string;
  wrap?: boolean;
  maxLines?: number;
  align?: "start" | "end" | "center";
  flex?: number;
  margin?: Spacing;
}

export interface FlexSeparator {
  type: "separator";
  margin?: Spacing;
  color?: string;
}

/** ดันของที่ตามหลังไปชิดขอบ — ใช้ในแถวแนวนอน */
export interface FlexFiller {
  type: "filler";
  flex?: number;
}

export interface FlexButton {
  type: "button";
  style: "primary" | "secondary" | "link";
  action: FlexUriAction;
  color?: string;
  height?: "sm" | "md";
}

export interface FlexBox {
  type: "box";
  layout: "vertical" | "horizontal";
  contents: FlexComponent[];
  spacing?: Spacing;
  margin?: Spacing;
  flex?: number;
  backgroundColor?: string;
  cornerRadius?: Spacing;
  paddingAll?: Spacing;
  paddingTop?: Spacing;
  paddingBottom?: Spacing;
  paddingStart?: Spacing;
  paddingEnd?: Spacing;
  alignItems?: "flex-start" | "center" | "flex-end";
  action?: FlexUriAction;
}

export type FlexComponent = FlexText | FlexSeparator | FlexFiller | FlexButton | FlexBox;

export interface FlexBubble {
  type: "bubble";
  size?: "kilo" | "mega" | "giga";
  header?: FlexBox;
  body?: FlexBox;
  footer?: FlexBox;
}

export interface FlexMessage {
  type: "flex";
  /** แสดงใน notification bar และเครื่องที่แสดง Flex ไม่ได้ · 1–400 ตัวอักษร · ห้ามมีลิงก์ (GateWay ย่อให้ทั้ง altText) */
  altText: string;
  contents: FlexBubble;
}

// ── ตัวสร้าง — property ที่ไม่ได้ใส่ไม่ถูกส่งออกไป (LINE ปฏิเสธค่า undefined ไม่ได้ แต่ JSON ตัดให้เอง) ───────────────

export const box = (layout: FlexBox["layout"], contents: FlexComponent[], rest: Omit<FlexBox, "type" | "layout" | "contents"> = {}): FlexBox => ({
  type: "box",
  layout,
  contents,
  ...rest,
});

export const text = (value: string, rest: Omit<FlexText, "type" | "text"> = {}): FlexText => ({ type: "text", text: value, ...rest });

export const separator = (rest: Omit<FlexSeparator, "type"> = {}): FlexSeparator => ({ type: "separator", ...rest });

export const filler = (): FlexFiller => ({ type: "filler" });

export const uriAction = (label: string, uri: string): FlexUriAction => ({ type: "uri", label, uri });

export const button = (label: string, uri: string, rest: { style?: FlexButton["style"]; color?: string; height?: FlexButton["height"] } = {}): FlexButton => ({
  type: "button",
  style: rest.style ?? "primary",
  action: uriAction(label, uri),
  ...(rest.color ? { color: rest.color } : {}),
  ...(rest.height ? { height: rest.height } : {}),
});

// ── ตัวตรวจ ────────────────────────────────────────────────────────────────

/** LINE: Flex ทั้งก้อนไม่เกิน 30KB */
export const FLEX_MAX_BYTES = 30_000;
export const FLEX_ALT_TEXT_MAX = 400;
const URI_MAX = 1000;
const LABEL_MAX = 20;
const MAX_DEPTH = 8;

const SPACING = /^(none|xs|sm|md|lg|xl|xxl|\d+px)$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** property ที่ตัวสร้างนี้ปล่อยออกไปได้ — ชื่อที่ไม่อยู่ในนี้คือพิมพ์ผิดหรือใช้ของที่ยังไม่ได้ตรวจกับ LINE */
const KEYS: Record<string, readonly string[]> = {
  bubble: ["type", "size", "header", "body", "footer"],
  box: [
    "type", "layout", "contents", "spacing", "margin", "flex", "backgroundColor", "cornerRadius", "paddingAll",
    "paddingTop", "paddingBottom", "paddingStart", "paddingEnd", "alignItems", "action",
  ],
  text: ["type", "text", "size", "weight", "color", "wrap", "maxLines", "align", "flex", "margin"],
  separator: ["type", "margin", "color"],
  filler: ["type", "flex"],
  button: ["type", "style", "action", "color", "height"],
  uri: ["type", "label", "uri"],
};

/** คืนเหตุผลข้อแรกที่ไม่ผ่าน · null = ส่งได้ */
export function checkFlexMessage(m: FlexMessage): string | null {
  if (m.type !== "flex") return "type ต้องเป็น flex";
  if (typeof m.altText !== "string" || m.altText.length === 0) return "altText ว่าง";
  if (m.altText.length > FLEX_ALT_TEXT_MAX) return `altText ยาว ${m.altText.length} > ${FLEX_ALT_TEXT_MAX}`;
  const bytes = new TextEncoder().encode(JSON.stringify(m)).length;
  if (bytes > FLEX_MAX_BYTES) return `Flex ใหญ่ ${bytes}B > ${FLEX_MAX_BYTES}B`;
  return checkNode(m.contents, "contents", 0);
}

function checkKeys(node: object, kind: string, path: string): string | null {
  const allowed = KEYS[kind];
  const stray = Object.keys(node).find((k) => !allowed.includes(k));
  return stray ? `${path}: property ${stray} ไม่อยู่ในชุดที่ตรวจแล้ว (${kind})` : null;
}

function checkAction(a: FlexUriAction | undefined, path: string): string | null {
  if (a === undefined) return null;
  const keyErr = checkKeys(a, "uri", path);
  if (keyErr) return keyErr;
  if (a.type !== "uri") return `${path}: action ต้องเป็น uri`;
  if (!a.uri.startsWith("https://")) return `${path}: uri ต้องขึ้นต้น https://`;
  if (a.uri.length > URI_MAX) return `${path}: uri ยาวเกิน ${URI_MAX}`;
  if (a.label.length === 0 || a.label.length > LABEL_MAX) return `${path}: label ต้อง 1–${LABEL_MAX} ตัวอักษร`;
  return null;
}

function checkSpacing(node: Record<string, unknown>, path: string): string | null {
  for (const k of ["spacing", "margin", "cornerRadius", "paddingAll", "paddingTop", "paddingBottom", "paddingStart", "paddingEnd"]) {
    const v = node[k];
    if (v !== undefined && (typeof v !== "string" || !SPACING.test(v))) return `${path}.${k}: ค่า ${String(v)} ใช้ไม่ได้`;
  }
  return null;
}

function checkColors(node: Record<string, unknown>, path: string): string | null {
  for (const k of ["color", "backgroundColor"]) {
    const v = node[k];
    if (v !== undefined && (typeof v !== "string" || !HEX.test(v))) return `${path}.${k}: ต้องเป็น hex 6 หลัก`;
  }
  return null;
}

function checkNode(node: FlexBubble | FlexComponent, path: string, depth: number): string | null {
  if (depth > MAX_DEPTH) return `${path}: ซ้อนลึกเกิน ${MAX_DEPTH} ชั้น`;
  const kind = node.type as string;
  if (!(kind in KEYS) || kind === "uri") return `${path}: type ${kind} ไม่อยู่ในชุดที่ตรวจแล้ว`;
  const keyErr = checkKeys(node, kind, path);
  if (keyErr) return keyErr;
  const generic = checkSpacing(node as unknown as Record<string, unknown>, path) ?? checkColors(node as unknown as Record<string, unknown>, path);
  if (generic) return generic;

  switch (node.type) {
    case "bubble": {
      for (const part of ["header", "body", "footer"] as const) {
        const box = node[part];
        if (box) {
          const err = checkNode(box, `${path}.${part}`, depth + 1);
          if (err) return err;
        }
      }
      return node.body ? null : `${path}: ต้องมี body`;
    }
    case "box": {
      if (node.contents.length === 0) return `${path}: contents ว่าง`;
      const actionErr = checkAction(node.action, `${path}.action`);
      if (actionErr) return actionErr;
      for (const [i, child] of node.contents.entries()) {
        const err = checkNode(child, `${path}.contents[${i}]`, depth + 1);
        if (err) return err;
      }
      return null;
    }
    case "text":
      if (node.text.length === 0) return `${path}: text ว่าง`;
      if (node.maxLines !== undefined && (!Number.isInteger(node.maxLines) || node.maxLines < 1)) return `${path}: maxLines ต้องเป็นจำนวนเต็ม ≥ 1`;
      return null;
    case "button":
      return checkAction(node.action, `${path}.action`) ?? (node.action ? null : `${path}: ต้องมี action`);
    case "separator":
    case "filler":
      return null;
  }
}

/** ข้อความทุกก้อนใน Flex ตามลำดับ — เทสต์ใช้ตรวจเนื้อหา และ log ใช้บอกว่าส่งอะไรไป */
export function flexTexts(m: FlexMessage): string[] {
  const out: string[] = [];
  const walk = (n: FlexBubble | FlexComponent | undefined) => {
    if (!n) return;
    if (n.type === "text") out.push(n.text);
    if (n.type === "bubble") [n.header, n.body, n.footer].forEach(walk);
    if (n.type === "box") n.contents.forEach(walk);
    if (n.type === "button") out.push(n.action.label);
  };
  walk(m.contents);
  return out;
}

/** URI ของทุก action ใน Flex — เทสต์ตรวจว่าทุกเรื่องมีลิงก์ของตัวเอง */
export function flexUris(m: FlexMessage): string[] {
  const out: string[] = [];
  const walk = (n: FlexBubble | FlexComponent | undefined) => {
    if (!n) return;
    if (n.type === "bubble") [n.header, n.body, n.footer].forEach(walk);
    if (n.type === "box") {
      if (n.action) out.push(n.action.uri);
      n.contents.forEach(walk);
    }
    if (n.type === "button") out.push(n.action.uri);
  };
  walk(m.contents);
  return out;
}

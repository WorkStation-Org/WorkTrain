import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FLEX_ALT_TEXT_MAX,
  FLEX_COLOR,
  FLEX_MAX_BYTES,
  box,
  button,
  checkFlexMessage,
  flexTexts,
  flexUris,
  separator,
  text,
  uriAction,
  type FlexMessage,
} from "@/lib/flex";

const ok = (over: Partial<FlexMessage> = {}): FlexMessage => ({
  type: "flex",
  altText: "ชุดการเรียนรู้ใหม่",
  contents: {
    type: "bubble",
    body: box("vertical", [text("สวัสดี"), separator(), button("เริ่มเรียน", "https://worktrain.test/learn")]),
  },
  ...over,
});

describe("checkFlexMessage — ข้อจำกัดของ LINE ที่ GateWay ไม่ตรวจให้ (202 ก่อนถึง LINE)", () => {
  it("Flex ปกติผ่าน", () => {
    expect(checkFlexMessage(ok())).toBeNull();
  });

  it("altText ต้องไม่ว่างและไม่เกิน 400", () => {
    expect(checkFlexMessage(ok({ altText: "" }))).toMatch(/altText/);
    expect(checkFlexMessage(ok({ altText: "ก".repeat(FLEX_ALT_TEXT_MAX) }))).toBeNull();
    expect(checkFlexMessage(ok({ altText: "ก".repeat(FLEX_ALT_TEXT_MAX + 1) }))).toMatch(/altText/);
  });

  it("ก้อนเกิน 30KB ไม่ผ่าน", () => {
    const big = ok({
      contents: { type: "bubble", body: box("vertical", Array.from({ length: 400 }, (_, i) => text(`${"ข".repeat(30)}${i}`))) },
    });
    expect(JSON.stringify(big).length).toBeGreaterThan(FLEX_MAX_BYTES / 3);
    expect(checkFlexMessage(big)).toMatch(/ใหญ่/);
  });

  it("uri ต้องเป็น https · label ไม่เกิน 20", () => {
    const withUri = (uri: string, label = "เปิด") =>
      ok({ contents: { type: "bubble", body: box("vertical", [text("x")], { action: uriAction(label, uri) }) } });
    expect(checkFlexMessage(withUri("https://a.b/c"))).toBeNull();
    expect(checkFlexMessage(withUri("http://a.b/c"))).toMatch(/https/);
    expect(checkFlexMessage(withUri("javascript:alert(1)"))).toMatch(/https/);
    expect(checkFlexMessage(withUri(`https://a.b/${"x".repeat(1000)}`))).toMatch(/ยาวเกิน/);
    expect(checkFlexMessage(withUri("https://a.b/c", "ก".repeat(21)))).toMatch(/label/);
  });

  it("box ว่าง · text ว่าง · สีไม่ใช่ hex · property นอกชุดที่ตรวจแล้ว ไม่ผ่าน", () => {
    const body = (b: ReturnType<typeof box>) => ok({ contents: { type: "bubble", body: b } });
    expect(checkFlexMessage(body(box("vertical", [])))).toMatch(/ว่าง/);
    expect(checkFlexMessage(body(box("vertical", [text("")])))).toMatch(/text ว่าง/);
    expect(checkFlexMessage(body(box("vertical", [text("x", { color: "red" })])))).toMatch(/hex/);
    expect(checkFlexMessage(body(box("vertical", [text("x")], { backgroundColor: "#fff" })))).toMatch(/hex/);
    expect(checkFlexMessage(body(box("vertical", [text("x")], { margin: "3" as never })))).toMatch(/ใช้ไม่ได้/);
    const stray = { ...text("x"), gradient: true } as never;
    expect(checkFlexMessage(body(box("vertical", [stray])))).toMatch(/gradient/);
  });

  it("bubble ต้องมี body", () => {
    expect(checkFlexMessage(ok({ contents: { type: "bubble", header: box("vertical", [text("x")]) } }))).toMatch(/body/);
  });
});

describe("flexTexts / flexUris", () => {
  it("เก็บข้อความและ label ปุ่มตามลำดับ · เก็บ URI ของทั้ง box และปุ่ม", () => {
    const m = ok({
      contents: {
        type: "bubble",
        body: box("vertical", [
          box("vertical", [text("หนึ่ง"), text("สอง")], { action: uriAction("เปิดเรื่อง", "https://a.b/1") }),
          button("ปุ่ม", "https://a.b/2"),
        ]),
      },
    });
    expect(flexTexts(m)).toEqual(["หนึ่ง", "สอง", "ปุ่ม"]);
    expect(flexUris(m)).toEqual(["https://a.b/1", "https://a.b/2"]);
  });
});

describe("สีของ Flex ตรงกับ design token (ธีมสว่าง) ใน globals.css — derive ไม่ได้ จึงต้องมีเทสต์ที่ล้มเมื่อไม่ตรง", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
  // ค่าแรกของแต่ละ token คือธีมสว่าง (ธีมมืดประกาศทีหลังใน media query) — LINE แสดงการ์ดบนพื้นของตัวเอง จึงใช้ชุดสว่าง
  const token = (name: string) => css.match(new RegExp(`--wt-${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]?.toLowerCase();

  it.each([
    ["brand", "accent"],
    ["onBrand", "accent-fg"],
    ["onBrandMuted", "ink-4"],
    ["ink", "fg"],
    ["ink2", "ink-2"],
    ["ink3", "muted"],
    ["line", "line"],
    ["surface2", "canvas"],
    ["surface3", "subtle"],
    ["danger", "danger"],
    ["dangerSoft", "danger-soft"],
    ["warning", "warn"],
    ["warningSoft", "warn-soft"],
    ["success", "success"],
    ["successSoft", "success-soft"],
  ] as const)("%s = --wt-%s", (key, cssName) => {
    expect(token(cssName), `--wt-${cssName} ไม่พบใน globals.css`).toBeDefined();
    expect(FLEX_COLOR[key]).toBe(token(cssName));
  });
});

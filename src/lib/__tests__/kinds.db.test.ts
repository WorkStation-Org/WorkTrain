import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setupTestDb, testDb, truncateAll } from "@/db/__tests__/pgdb";
import { GENERAL_BLUEPRINT, PRODUCT_BLUEPRINT } from "@/domain/blueprint";
import type { Actor } from "@/lib/auth";

/**
 * ทะเบียนชนิดของชุด (ADR-0011) — migration 0007 ย้าย enum เดิม · TG เท่านั้นที่ดูแล · ชุดคัดลอกแม่แบบตอนสร้าง
 * PGlite + migration จริง
 */

vi.mock("@/db", async () => {
  const s = await import("@/db/schema");
  const { testDb: get } = await import("@/db/__tests__/pgdb");
  return { db: () => get(), schema: s };
});

const K = await import("@/lib/kind-service");
const { createSet, getSetDetail, requestUpload } = await import("@/lib/set-service");

const tg: Actor = { personId: 1, email: "tg@ws.co", name: "ทีจี", role: "admin" };
const pd: Actor = { personId: 10, email: "pd@ws.co", name: "พีดี", role: "author" };

const SAFETY = [
  { topic: "กฎในไซต์งาน", level: "recall", count: 4 },
  { topic: "กฎในไซต์งาน", level: "understand", count: 2 },
  { topic: "อุปกรณ์ป้องกัน", level: "understand", count: 2 },
  { topic: "อุปกรณ์ป้องกัน", level: "scenario", count: 2 },
];

beforeAll(async () => {
  await setupTestDb();
  vi.stubEnv("SESSION_SECRET", "test-secret-test-secret-test-secret-0000");
  vi.stubEnv("WORKTRAIN_DEV_ORG", JSON.stringify([]));
});
afterAll(() => vi.unstubAllEnvs());

describe("migration 0007 — ฐานที่เพิ่งย้าย (ก่อนล้างตาราง)", () => {
  it("มีสองชนิดเดิม แม่แบบตรงกับค่าคงที่ในโค้ด · Pricelist เปิดเฉพาะชนิดสินค้า", async () => {
    const rows = await testDb().select().from(schema.setKinds).orderBy(schema.setKinds.id);
    expect(rows.map((r) => ({ id: r.id, name: r.name, blueprint: r.blueprint, allowPricelist: r.allowPricelist, active: r.active }))).toEqual([
      { id: schema.SEEDED_KIND_IDS.product, name: "สินค้าใหม่ (PD)", blueprint: PRODUCT_BLUEPRINT, allowPricelist: true, active: true },
      { id: schema.SEEDED_KIND_IDS.general, name: "ทั่วไป", blueprint: GENERAL_BLUEPRINT, allowPricelist: false, active: true },
    ]);
  });

  it("ชนิดใหม่ได้ id ต่อจากสองชนิดเดิม (sequence ถูกเลื่อนแล้ว)", async () => {
    const r = await K.createKind({ actor: tg, name: "ความปลอดภัย", blueprint: SAFETY, allowPricelist: false });
    expect(r).toEqual({ ok: true, kindId: 3 });
  });
});

describe("ชุดเดิมก่อนมีทะเบียน", () => {
  it("migration ย้าย kind เดิมไป kind_id โดยแม่แบบของชุดไม่เปลี่ยน", async () => {
    // จำลองฐานก่อน 0007: รัน migration 0000–0006 แล้วใส่ชุด แล้วรัน 0007–0008
    const { PGlite } = await import("@electric-sql/pglite");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(process.cwd(), "drizzle");
    const journal = JSON.parse(fs.readFileSync(path.join(dir, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
    const pg = new PGlite();
    const run = async (tag: string) => {
      for (const raw of fs.readFileSync(path.join(dir, `${tag}.sql`), "utf8").split("--> statement-breakpoint")) if (raw.trim()) await pg.exec(raw);
    };
    const tags = journal.entries.map((e) => e.tag);
    const at = tags.indexOf("0007_set_kinds");
    for (const t of tags.slice(0, at)) await run(t);
    const custom = JSON.stringify([{ topic: "price", level: "recall", count: 10 }]);
    await pg.query(
      `insert into learning_sets (title, kind, author_person_id, author_name, blueprint) values
       ('ชุดสินค้า', 'product', 10, 'พีดี', $1), ('ชุดทั่วไป', 'general', 10, 'พีดี', $2)`,
      [custom, JSON.stringify(GENERAL_BLUEPRINT)],
    );
    for (const t of tags.slice(at)) await run(t);
    const sets = await pg.query<{ title: string; kind_id: number; blueprint: unknown }>(`select title, kind_id, blueprint from learning_sets order by id`);
    expect(sets.rows).toEqual([
      { title: "ชุดสินค้า", kind_id: schema.SEEDED_KIND_IDS.product, blueprint: JSON.parse(custom) },
      { title: "ชุดทั่วไป", kind_id: schema.SEEDED_KIND_IDS.general, blueprint: GENERAL_BLUEPRINT },
    ]);
    const cols = await pg.query(`select 1 from information_schema.columns where table_name = 'learning_sets' and column_name = 'kind'`);
    expect(cols.rows).toHaveLength(0);
    await pg.close();
    // สร้างฐานใหม่และรัน migration ทั้งหมดในเทสต์เดียว — ช้าพอ ๆ กับ setupTestDb (hook 60 วิ)
  }, 60_000);
});

describe("TG ดูแลทะเบียน", () => {
  beforeEach(truncateAll);

  it("เฉพาะ TG — ผู้สร้างเพิ่มหรือแก้ไม่ได้", async () => {
    expect(await K.createKind({ actor: pd, name: "x", blueprint: SAFETY, allowPricelist: false })).toEqual({ ok: false, error: "เฉพาะ TG" });
    expect(await K.updateKind({ actor: pd, kindId: schema.SEEDED_KIND_IDS.general, name: "y" })).toEqual({ ok: false, error: "เฉพาะ TG" });
  });

  it("เพิ่มชนิดพร้อมหัวข้อที่ตั้งเอง · ชื่อซ้ำ (ไม่สนตัวพิมพ์) ไม่ได้", async () => {
    const r = await K.createKind({ actor: tg, name: "  ความ   ปลอดภัย ", blueprint: SAFETY, allowPricelist: false });
    expect(r.ok).toBe(true);
    const kind = await K.getKind((r as { kindId: number }).kindId);
    expect(kind).toMatchObject({ name: "ความ ปลอดภัย", allowPricelist: false, active: true, blueprint: SAFETY });
    expect(await K.createKind({ actor: tg, name: "ทั่วไป", blueprint: SAFETY, allowPricelist: false })).toEqual({ ok: false, error: 'มีชนิด "ทั่วไป" อยู่แล้ว' });
    expect(await K.createKind({ actor: tg, name: "Onboarding", blueprint: SAFETY, allowPricelist: false })).toMatchObject({ ok: true });
    expect(await K.createKind({ actor: tg, name: "onboarding", blueprint: SAFETY, allowPricelist: false })).toMatchObject({ ok: false });
  });

  it("แม่แบบต้องรวมได้ 10 ข้อ · ชื่อว่างไม่ได้", async () => {
    expect(await K.createKind({ actor: tg, name: "x", blueprint: SAFETY.slice(1), allowPricelist: false })).toEqual({ ok: false, error: "รวมต้องได้ 10 ข้อ (ตอนนี้ 6)" });
    expect(await K.createKind({ actor: tg, name: "  ", blueprint: SAFETY, allowPricelist: false })).toMatchObject({ ok: false });
  });

  it("แก้ชื่อ · แม่แบบ · สวิตช์ Pricelist", async () => {
    const id = schema.SEEDED_KIND_IDS.general;
    expect(await K.updateKind({ actor: tg, kindId: id, name: "เรื่องทั่วไป", blueprint: SAFETY, allowPricelist: true })).toEqual({ ok: true });
    expect(await K.getKind(id)).toMatchObject({ name: "เรื่องทั่วไป", blueprint: SAFETY, allowPricelist: true });
    expect(await K.updateKind({ actor: tg, kindId: id, name: "สินค้าใหม่ (pd)" })).toMatchObject({ ok: false });
  });

  it("ปิดชนิดได้ แต่ต้องเหลือที่เปิดอยู่อย่างน้อยหนึ่ง", async () => {
    expect(await K.updateKind({ actor: tg, kindId: schema.SEEDED_KIND_IDS.product, active: false })).toEqual({ ok: true });
    expect(await K.updateKind({ actor: tg, kindId: schema.SEEDED_KIND_IDS.general, active: false })).toEqual({
      ok: false,
      error: "ต้องเปิดไว้อย่างน้อยหนึ่งชนิด ไม่งั้นสร้างชุดใหม่ไม่ได้",
    });
    expect((await K.activeKinds()).map((k) => k.id)).toEqual([schema.SEEDED_KIND_IDS.general]);
    expect(await K.updateKind({ actor: tg, kindId: schema.SEEDED_KIND_IDS.product, active: true })).toEqual({ ok: true });
  });

  it("listKinds นับชุดที่ใช้แต่ละชนิด", async () => {
    await createSet({ actor: pd, title: "a", kindId: schema.SEEDED_KIND_IDS.general });
    await createSet({ actor: pd, title: "b", kindId: schema.SEEDED_KIND_IDS.general });
    const list = await K.listKinds();
    expect(list.map((k) => [k.id, k.setCount])).toEqual([
      [schema.SEEDED_KIND_IDS.product, 0],
      [schema.SEEDED_KIND_IDS.general, 2],
    ]);
  });
});

describe("สร้างชุดจากทะเบียน", () => {
  beforeEach(truncateAll);

  it("ชุดคัดลอกแม่แบบของชนิด — แก้แม่แบบทีหลังไม่กระทบชุดเดิม", async () => {
    const k = (await K.createKind({ actor: tg, name: "ความปลอดภัย", blueprint: SAFETY, allowPricelist: false })) as { kindId: number };
    const s = (await createSet({ actor: pd, title: "อบรมความปลอดภัย", kindId: k.kindId })) as { ok: true; setId: number };
    expect(s.ok).toBe(true);
    await K.updateKind({ actor: tg, kindId: k.kindId, blueprint: GENERAL_BLUEPRINT });
    const detail = await getSetDetail(pd, s.setId);
    expect(detail?.blueprint).toEqual(SAFETY);
    expect(detail?.kind).toEqual({ id: k.kindId, name: "ความปลอดภัย", allowPricelist: false });
  });

  it("ชนิดที่ปิดหรือไม่มีจริง → สร้างไม่ได้", async () => {
    const k = (await K.createKind({ actor: tg, name: "เลิกใช้", blueprint: SAFETY, allowPricelist: false })) as { kindId: number };
    await K.updateKind({ actor: tg, kindId: k.kindId, active: false });
    expect(await createSet({ actor: pd, title: "x", kindId: k.kindId })).toEqual({ ok: false, error: 'ชนิด "เลิกใช้" ปิดอยู่' });
    expect(await createSet({ actor: pd, title: "x", kindId: 999 })).toEqual({ ok: false, error: "เลือกชนิดของชุด" });
    expect(await createSet({ actor: pd, title: "x", kindId: Number.NaN })).toEqual({ ok: false, error: "เลือกชนิดของชุด" });
  });

  it("ปิดชนิดแล้ว ชุดเดิมยังเปิดดูได้", async () => {
    const s = (await createSet({ actor: pd, title: "x", kindId: schema.SEEDED_KIND_IDS.product })) as { setId: number };
    await K.updateKind({ actor: tg, kindId: schema.SEEDED_KIND_IDS.product, active: false });
    expect((await getSetDetail(pd, s.setId))?.kind.name).toBe("สินค้าใหม่ (PD)");
  });

  it("แนบ Pricelist ได้ตามสวิตช์ของชนิด", async () => {
    const s = (await createSet({ actor: pd, title: "x", kindId: schema.SEEDED_KIND_IDS.general })) as { setId: number };
    const ask = () => requestUpload({ actor: pd, setId: s.setId, docKind: "pricelist", fileName: "p.pdf", mime: "application/pdf", size: 100 });
    expect(await ask()).toEqual({ ok: false, error: "ชนิดของชุดนี้ไม่ได้เปิดให้แนบ Pricelist" });
    await K.updateKind({ actor: tg, kindId: schema.SEEDED_KIND_IDS.general, allowPricelist: true });
    expect(await ask()).toMatchObject({ ok: true });
  });

  it("ชื่อชนิดเก็บแค่ที่ทะเบียน — แก้ชื่อแล้วชุดเดิมแสดงชื่อใหม่", async () => {
    const s = (await createSet({ actor: pd, title: "x", kindId: schema.SEEDED_KIND_IDS.general })) as { setId: number };
    await K.updateKind({ actor: tg, kindId: schema.SEEDED_KIND_IDS.general, name: "ความรู้ทั่วไป" });
    expect((await getSetDetail(pd, s.setId))?.kind.name).toBe("ความรู้ทั่วไป");
    const [row] = await testDb().select().from(schema.learningSets).where(eq(schema.learningSets.id, s.setId));
    expect(row.kindId).toBe(schema.SEEDED_KIND_IDS.general);
  });
});

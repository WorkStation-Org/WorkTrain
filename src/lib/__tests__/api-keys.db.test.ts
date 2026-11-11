import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setupTestDb, testDb, truncateAll } from "@/db/__tests__/pgdb";
import type { Actor } from "@/lib/auth";

/**
 * API key ของระบบอื่น (ADR-0012) — TG ออก/ถอน · เก็บแค่ hash · ด่านของ `/api/v1/*` — PGlite + migration จริง
 */

vi.mock("@/db", async () => {
  const s = await import("@/db/schema");
  const { testDb: get } = await import("@/db/__tests__/pgdb");
  return { db: () => get(), schema: s };
});

const K = await import("@/lib/api-consumers");

const tg: Actor = { personId: 1, email: "tg@ws.co", name: "ทีจี", role: "admin" };
const pd: Actor = { personId: 10, email: "pd@ws.co", name: "พีดี", role: "author" };

function req(key: string | null) {
  return new Request("https://wt.test/api/v1/x", { headers: key ? { authorization: `Bearer ${key}` } : {} });
}

async function issue(name = "workhr", note?: string): Promise<{ id: number; key: string }> {
  const out = await K.createApiKey({ actor: tg, name, note });
  if (!out.ok) throw new Error(out.error);
  return out;
}

beforeAll(setupTestDb);
beforeEach(truncateAll);
afterEach(() => vi.restoreAllMocks());

describe("ออก key", () => {
  it("เฉพาะ TG · ชื่อผิดรูปไม่ได้ · ชื่อพิมพ์ใหญ่กลายเป็นตัวเล็ก", async () => {
    expect(await K.createApiKey({ actor: pd, name: "workhr" })).toEqual({ ok: false, error: "เฉพาะ TG" });
    for (const bad of ["", "w", "1hr", "work hr", "work_hr", "ข้อมูล", "a".repeat(41)]) {
      expect((await K.createApiKey({ actor: tg, name: bad })).ok).toBe(false);
    }
    expect((await K.createApiKey({ actor: tg, name: "x", note: "ก".repeat(K.NOTE_MAX + 1) })).ok).toBe(false);
    const out = await K.createApiKey({ actor: tg, name: "  WorkHR " });
    expect(out.ok).toBe(true);
    expect((await K.listApiKeys()).map((k) => k.name)).toEqual(["workhr"]);
  });

  it("เก็บแค่ hash + 4 ตัวท้าย · ไม่คืน hash ให้หน้าจอ · ชื่อผู้ออก ณ เวลานั้น", async () => {
    const { id, key } = await issue("workhr", "  ดึงสถานะ   Onboarding ");
    expect(key).toMatch(/^wtr_[A-Za-z0-9_-]{43}$/);
    const [row] = await testDb().select().from(schema.apiConsumers).where(eq(schema.apiConsumers.id, id));
    expect(row.keyHash).toBe(K.hashApiKey(key));
    expect(JSON.stringify(row)).not.toContain(key);
    expect(row).toMatchObject({ keyHint: key.slice(-4), note: "ดึงสถานะ Onboarding", createdByName: "ทีจี", scopes: ["read"] });
    const [listed] = await K.listApiKeys();
    expect(listed).not.toHaveProperty("keyHash");
  });

  it("ชื่อเดียวกันออกได้หลาย key (หมุน key) · ทุก key ใช้ได้จนกว่าจะถอน", async () => {
    const a = await issue();
    const b = await issue();
    expect(a.key).not.toBe(b.key);
    expect((await K.findConsumer(`Bearer ${a.key}`))?.name).toBe("workhr");
    expect((await K.findConsumer(`Bearer ${b.key}`))?.name).toBe("workhr");
  });
});

describe("ด่านของ /api/v1", () => {
  it("ไม่มี · รูปผิด · ไม่รู้จัก = 401", async () => {
    await issue();
    for (const key of [null, "abc", `whr_${"a".repeat(30)}`, K.newConsumerKey()]) {
      const g = await K.requireConsumer(req(key), "read");
      expect(!g.ok && g.res.status).toBe(401);
    }
  });

  it("key ถูก = ผ่าน พร้อมชื่อระบบ · บันทึกใช้ล่าสุด ไม่เกินชั่วโมงละครั้ง", async () => {
    const { id, key } = await issue();
    const t0 = new Date("2026-11-11T09:00:00+07:00");
    expect(await K.findConsumer(`Bearer ${key}`, t0)).toMatchObject({ id, name: "workhr", scopes: ["read"] });
    const used = async () => (await testDb().select().from(schema.apiConsumers).where(eq(schema.apiConsumers.id, id)))[0].lastUsedAt;
    expect(await used()).toEqual(t0);
    await K.findConsumer(`Bearer ${key}`, new Date("2026-11-11T09:30:00+07:00"));
    expect(await used()).toEqual(t0);
    const t2 = new Date("2026-11-11T10:00:00+07:00");
    await K.findConsumer(`Bearer ${key}`, t2);
    expect(await used()).toEqual(t2);
    const g = await K.requireConsumer(req(key), "read");
    expect(g.ok && g.consumer.name).toBe("workhr");
  });

  it("ถอนแล้วใช้ไม่ได้ทันที · ถอนซ้ำไม่ได้ · เฉพาะ TG · key อื่นของชื่อเดียวกันยังใช้ได้", async () => {
    const old = await issue();
    const fresh = await issue();
    expect(await K.revokeApiKey({ actor: pd, id: old.id })).toEqual({ ok: false, error: "เฉพาะ TG" });
    expect(await K.revokeApiKey({ actor: tg, id: old.id })).toEqual({ ok: true });
    expect((await K.revokeApiKey({ actor: tg, id: old.id })).ok).toBe(false);
    expect((await K.revokeApiKey({ actor: tg, id: 9999 })).ok).toBe(false);
    expect(await K.findConsumer(`Bearer ${old.key}`)).toBeNull();
    expect((await K.findConsumer(`Bearer ${fresh.key}`))?.name).toBe("workhr");
    const rows = await K.listApiKeys();
    expect(rows.find((r) => r.id === old.id)).toMatchObject({ revokedByName: "ทีจี" });
    expect(rows.find((r) => r.id === old.id)?.revokedAt).toBeInstanceOf(Date);
  });

  it("ฐานปฏิเสธชื่อ / hash / scope ผิดรูป", async () => {
    const base = { keyHint: "abcd", createdByPersonId: 1, createdByName: "ทีจี" };
    await expect(testDb().insert(schema.apiConsumers).values({ ...base, name: "Bad Name", keyHash: "a".repeat(64) })).rejects.toThrow();
    await expect(testDb().insert(schema.apiConsumers).values({ ...base, name: "ok", keyHash: "zz" })).rejects.toThrow();
    await expect(testDb().insert(schema.apiConsumers).values({ ...base, name: "ok", keyHash: "b".repeat(64), scopes: ["write"] })).rejects.toThrow();
  });
});

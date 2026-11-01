import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setupTestDb, testDb, truncateAll } from "@/db/__tests__/pgdb";
import { devStoreObjects } from "@/lib/object-store";
import type { FaceApi, LivenessResult } from "@/lib/rekognition";

/**
 * ลงทะเบียนใบหน้า · สแกน · TG ตรวจ (spec §8 · ADR-0006) — Rekognition เป็นตัวปลอมที่ขอบ `FaceApi`
 */

vi.mock("@/db", async () => {
  const s = await import("@/db/schema");
  const { testDb: get } = await import("@/db/__tests__/pgdb");
  return { db: () => get(), schema: s };
});

const I = await import("@/lib/identity-service");

const ME = 31;
const T0 = new Date("2026-11-02T09:00:00+07:00");
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);
const FACE = new Uint8Array([1, 2, 3]);

function fakeApi(opts: { live?: Partial<LivenessResult>; similarity?: number | null } = {}): FaceApi & { compared: number } {
  let n = 0;
  const api = {
    region: "ap-northeast-1",
    compared: 0,
    async createLivenessSession() {
      return `sess-${++n}`;
    },
    async livenessResult() {
      return { status: "SUCCEEDED", confidence: 95, referenceImage: FACE, ...opts.live };
    },
    async compareFaces() {
      api.compared += 1;
      return opts.similarity === undefined ? 99 : opts.similarity;
    },
    async browserCredentials() {
      return { accessKeyId: "a", secretAccessKey: "b", sessionToken: "c", expiration: at(900) };
    },
  };
  return api;
}

async function scan(purpose: "study" | "exam" | "enroll", api: FaceApi, now = T0, personId = ME) {
  const b = await I.beginScan({ personId, purpose, api, now });
  if (!b.ok) return b;
  return I.finishScan({ personId, ticket: b.ticket, api, now });
}

beforeAll(setupTestDb);
beforeEach(async () => {
  await truncateAll();
  devStoreObjects().clear();
  vi.stubEnv("SESSION_SECRET", "test-secret-test-secret-test-secret-0000");
});
afterEach(() => vi.unstubAllEnvs());

describe("ลงทะเบียนใบหน้า", () => {
  it("ครั้งแรก = ใช้ได้ทันที · เก็บภาพใน R2 private", async () => {
    const out = await scan("enroll", fakeApi());
    expect(out).toMatchObject({ ok: true, passed: true, enrollment: "active" });
    expect(await I.enrollmentState(ME)).toEqual({ state: "active", pending: false });
    const [e] = await testDb().select().from(schema.faceEnrollments);
    expect(e.objectKey).toMatch(new RegExp(`^faces/enroll/${ME}/[0-9a-f]{24}\\.jpg$`));
    expect(devStoreObjects().get(e.objectKey!)).toEqual(FACE);
  });

  it("ยังไม่ลงทะเบียน → สแกนเรียน/สอบไม่ได้", async () => {
    expect(await I.beginScan({ personId: ME, purpose: "study", api: fakeApi() })).toEqual({ ok: false, error: "ต้องลงทะเบียนใบหน้าก่อน" });
  });

  it("ลงทะเบียนใหม่ = รอ TG อนุมัติ · ระหว่างรอใช้ใบหน้าเดิม · อนุมัติแล้วเดิมถูกแทน", async () => {
    await scan("enroll", fakeApi());
    expect(await scan("enroll", fakeApi())).toMatchObject({ ok: true, enrollment: "pending" });
    expect(await I.enrollmentState(ME)).toEqual({ state: "active", pending: true });
    expect((await I.beginScan({ personId: ME, purpose: "enroll", api: fakeApi() })).ok).toBe(false);
    const pending = (await I.reviewQueue()).enrollments;
    expect(pending).toHaveLength(1);
    expect(await I.reviewEnrollment({ reviewerPersonId: 1, enrollmentId: pending[0].id, approve: true, now: at(60) })).toEqual({ ok: true });
    const rows = await testDb().select().from(schema.faceEnrollments).orderBy(schema.faceEnrollments.id);
    expect(rows.map((r) => r.status)).toEqual(["superseded", "active"]);
  });

  it("ไม่ใช่คนจริง (liveness ต่ำ) → ลงทะเบียนไม่ได้", async () => {
    expect(await scan("enroll", fakeApi({ live: { confidence: 40 } }))).toMatchObject({ ok: true, passed: false });
    expect(await I.enrollmentState(ME)).toEqual({ state: "none" });
  });
});

describe("สแกนเรียน/สอบ — เทียบฝั่งเซิร์ฟเวอร์", () => {
  it("คนจริง + เหมือน ≥ 90% → ผ่าน · ใช้เริ่มรอบเรียนได้", async () => {
    await scan("enroll", fakeApi());
    const out = await scan("study", fakeApi({ similarity: 96.4 }), at(10));
    expect(out).toMatchObject({ ok: true, passed: true });
    expect(await I.usableScan({ personId: ME, scanId: (out as { scanId: number }).scanId, purpose: "study", now: at(20) })).toBeNull();
    const [s] = await testDb().select().from(schema.faceScans).where(eq(schema.faceScans.purpose, "study"));
    expect(s).toMatchObject({ result: "pass", similarity: "96.40" });
  });

  it("เหมือนไม่ถึง 90% → no_match · ไม่เจอใบหน้า → no_match · liveness ไม่สำเร็จ → ไม่เทียบเลย", async () => {
    await scan("enroll", fakeApi());
    expect(await scan("study", fakeApi({ similarity: 70 }))).toMatchObject({ passed: false });
    expect(await scan("study", fakeApi({ similarity: null }))).toMatchObject({ passed: false });
    const noLive = fakeApi({ live: { status: "FAILED", confidence: null, referenceImage: null } });
    expect(await scan("study", noLive)).toMatchObject({ passed: false });
    expect(noLive.compared).toBe(0);
    const results = (await testDb().select().from(schema.faceScans).where(eq(schema.faceScans.purpose, "study"))).map((s) => s.result);
    expect(results.sort()).toEqual(["liveness_fail", "no_match", "no_match"]);
  });

  it("ใบสแกนของคนอื่น / หมดอายุ ใช้ไม่ได้", async () => {
    await scan("enroll", fakeApi());
    const b = await I.beginScan({ personId: ME, purpose: "study", api: fakeApi(), now: T0 });
    if (!b.ok) throw new Error(b.error);
    expect(await I.finishScan({ personId: 99, ticket: b.ticket, api: fakeApi() })).toEqual({ ok: false, error: "ใบสแกนไม่ถูกต้อง" });
    expect(await I.finishScan({ personId: ME, ticket: b.ticket, api: fakeApi(), now: at(11 * 60) })).toEqual({ ok: false, error: "ใบสแกนหมดอายุ สแกนใหม่" });
  });

  it("ไม่ได้ตั้ง AWS → บอกตรง ๆ ไม่ปล่อยผ่าน", async () => {
    expect(await I.beginScan({ personId: ME, purpose: "study", api: null })).toEqual({ ok: false, error: "ยังไม่ได้ตั้งระบบสแกนใบหน้าบนเซิร์ฟเวอร์นี้" });
  });
});

describe("TG ตรวจเมื่อไม่ผ่าน 3 ครั้งติด", () => {
  async function failThree() {
    await scan("enroll", fakeApi());
    for (let i = 0; i < 3; i++) await scan("exam", fakeApi({ similarity: 50 }), at(i));
  }

  it("ไม่ผ่าน 2 ครั้งยังไม่ขึ้นคิว · 3 ครั้งขึ้นพร้อมภาพทั้งชุด", async () => {
    await scan("enroll", fakeApi());
    await scan("exam", fakeApi({ similarity: 50 }), at(0));
    await scan("exam", fakeApi({ similarity: 50 }), at(1));
    expect((await I.reviewQueue()).scanReviews).toEqual([]);
    await scan("exam", fakeApi({ similarity: 50 }), at(2));
    const q = (await I.reviewQueue()).scanReviews;
    expect(q.map((r) => [r.personId, r.scans.length])).toEqual([[ME, 3]]);
    expect(q[0].scans.every((s) => s.objectKey?.startsWith(`faces/scan/${ME}/`))).toBe(true);
  });

  it("ยืนยัน → ใช้เริ่มสอบได้ภายใน 24 ชม. ครั้งเดียว · ออกจากคิว", async () => {
    await failThree();
    const out = await I.reviewFailedScans({ reviewerPersonId: 1, personId: ME, confirm: true, now: at(3600) });
    expect(out.ok).toBe(true);
    expect((await I.reviewQueue()).scanReviews).toEqual([]);
    const scanId = await I.confirmedScanFor(ME, "exam", at(3700));
    expect(scanId).toBe((out as { scanId: number }).scanId);
    expect(await I.usableScan({ personId: ME, scanId: scanId!, purpose: "exam", now: at(3600 + 25 * 3600) })).toBe("ผลสแกนหมดอายุ สแกนใหม่");
  });

  it("ปฏิเสธ → ใช้ไม่ได้ ต้องสแกนใหม่", async () => {
    await failThree();
    await I.reviewFailedScans({ reviewerPersonId: 1, personId: ME, confirm: false, now: at(3600) });
    expect(await I.confirmedScanFor(ME, "exam", at(3700))).toBeNull();
  });
});

describe("ทางลัด dev และการลบภาพ", () => {
  it("devScan: ลงทะเบียนครั้งแรก แล้วสแกนผ่าน · ยังไม่ลงทะเบียนสแกนไม่ได้", async () => {
    expect((await I.devScan({ personId: ME, purpose: "study" })).ok).toBe(false);
    expect(await I.devScan({ personId: ME, purpose: "enroll" })).toMatchObject({ ok: true, enrollment: "active" });
    expect(await I.devScan({ personId: ME, purpose: "study" })).toMatchObject({ ok: true, passed: true });
  });

  it("ลงทะเบียนที่ไม่ผ่าน liveness เก็บภาพไว้ใต้ faces/scan/ (ลบตามรอบ 90 วัน)", async () => {
    await scan("enroll", fakeApi({ live: { confidence: 10 } }));
    expect(await testDb().select().from(schema.faceEnrollments)).toEqual([]);
    const [s] = await testDb().select().from(schema.faceScans);
    expect(s.objectKey).toMatch(new RegExp(`^faces/scan/${ME}/`));
  });

  it("ภาพสแกนครบ 90 วันถูกลบจากที่เก็บ และล้าง key", async () => {
    await scan("enroll", fakeApi());
    await scan("study", fakeApi({ similarity: 50 }), T0);
    const before = devStoreObjects().size;
    expect(await I.deleteExpiredScanImages(at(91 * 86400))).toBe(1);
    expect(devStoreObjects().size).toBe(before - 1);
    const [s] = await testDb().select().from(schema.faceScans).where(eq(schema.faceScans.purpose, "study"));
    expect(s.objectKey).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RECHECK_AFTER_SEC,
  SESSION_TTL_SEC,
  type SessionData,
  needsRecheck,
  signSession,
  verifySession,
} from "@/lib/session";

/**
 * session cookie ของ WorkTrain เอง
 *
 * WorkTrain **ไม่มีตาราง `users`** (เจ้าของข้อมูลตัวตนคือ WorkID — ข้อ 2) ตัว cookie
 * จึงเป็นที่เดียวที่ถือตัวตนของคนที่ล็อกอินอยู่ · แปลว่าถ้าเซ็นไม่แน่น
 * ใครก็ปลอมเป็น admin ได้ด้วยการแก้ cookie ตัวเอง ไม่ต้องแตะฐานข้อมูลเลย
 *
 * เก็บ `epoch` กับ `checkedAt` มาด้วยเพราะสองอย่างนี้คือสิ่งที่ทำให้
 * "ถอนสิทธิ์ที่ WorkID แล้วหลุดภายใน 5 นาที" เป็นจริงได้โดยไม่ต้องมีตารางฝั่งนี้
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

const SECRET = "dGVzdC1zZWNyZXQtdGhhdC1pcy1sb25nLWVub3VnaA==";

const actor: SessionData = {
  personId: 45,
  email: "it@workstationoffice.com",
  name: "IT Admin",
  nickname: "ไอที",
  role: "admin",
  epoch: 3,
  checkedAt: 1_757_400_000,
};

describe("session cookie", () => {
  it("cookie ที่ออกก่อนมีฟิลด์ nickname ยังใช้ได้ — nickname = null", async () => {
    vi.stubEnv("SESSION_SECRET", SECRET);
    const { nickname: _, ...old } = actor;
    const token = await signSession(old);
    await expect(verifySession(token)).resolves.toEqual({ ...old, nickname: null });
  });

  it("เซ็นแล้วอ่านกลับได้ครบทุกฟิลด์", async () => {
    vi.stubEnv("SESSION_SECRET", SECRET);
    const token = await signSession(actor);
    await expect(verifySession(token)).resolves.toEqual(actor);
  });

  it("แก้ payload แล้วต้องไม่ผ่าน — ไม่ใช่แค่ค่าเพี้ยน", async () => {
    vi.stubEnv("SESSION_SECRET", SECRET);
    const token = await signSession(actor);
    const [payload, mac] = token.split(".");

    // ยกตัวเองเป็น admin โดยแก้ cookie — ท่าที่คนจะลองก่อนอย่างอื่น
    const tampered = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), role: "admin", personId: 1 }),
    ).toString("base64url");

    await expect(verifySession(`${tampered}.${mac}`)).resolves.toBeNull();
  });

  it("secret คนละตัว → ไม่ผ่าน (cookie จาก dev เอามาใช้บน production ไม่ได้)", async () => {
    vi.stubEnv("SESSION_SECRET", SECRET);
    const token = await signSession(actor);

    vi.stubEnv("SESSION_SECRET", "YW5vdGhlci1zZWNyZXQtZW50aXJlbHktZGlmZmVyZW50");
    await expect(verifySession(token)).resolves.toBeNull();
  });

  it("หมดอายุแล้วไม่ผ่าน · ก่อนหมดอายุยังผ่าน", async () => {
    vi.stubEnv("SESSION_SECRET", SECRET);
    const issuedAt = Date.UTC(2026, 8, 9, 8, 0, 0);
    const token = await signSession(actor, issuedAt);

    await expect(verifySession(token, issuedAt + (SESSION_TTL_SEC - 60) * 1000)).resolves.toEqual(actor);
    await expect(verifySession(token, issuedAt + (SESSION_TTL_SEC + 60) * 1000)).resolves.toBeNull();
  });

  it("token ที่ 'ออกในอนาคต' ไม่ผ่าน — ของปลอมที่เลื่อนเวลาหนีการหมดอายุ", async () => {
    vi.stubEnv("SESSION_SECRET", SECRET);
    const future = Date.UTC(2027, 0, 1);
    const token = await signSession(actor, future);
    await expect(verifySession(token, future - 3600_000)).resolves.toBeNull();
  });

  it("รูปแบบเพี้ยน / ว่าง / null → null ไม่ throw", async () => {
    vi.stubEnv("SESSION_SECRET", SECRET);
    for (const bad of [null, undefined, "", "abc", "a.b.c", "....", "!!!.???"]) {
      await expect(verifySession(bad)).resolves.toBeNull();
    }
  });

  it("ไม่มี SESSION_SECRET → **ดัง** ไม่ใช่ปล่อยผ่านหรือคืน null เงียบ ๆ", async () => {
    // ข้อ 14: ตั้งค่าไม่ครบต้องแยกออกจาก "ไม่ได้ล็อกอิน" ให้ได้
    // ถ้าคืน null เงียบ ๆ อาการจะเป็น "ล็อกอินไม่ติด" ที่ไม่มีใครรู้ว่าเพราะ env หาย
    vi.stubEnv("SESSION_SECRET", undefined);
    await expect(signSession(actor)).rejects.toThrow(/SESSION_SECRET/);
    await expect(verifySession("anything.here")).rejects.toThrow(/SESSION_SECRET/);
  });
});

describe("needsRecheck — ตัวที่ทำให้ 'ถอนสิทธิ์แล้วหลุดใน 5 นาที' เป็นจริง", () => {
  const at = (sec: number) => needsRecheck({ ...actor, checkedAt: actor.checkedAt }, (actor.checkedAt + sec) * 1000);

  it("เพิ่งเช็ค → ยังไม่ต้องเช็คใหม่", () => {
    expect(at(0)).toBe(false);
    expect(at(RECHECK_AFTER_SEC - 1)).toBe(false);
  });

  it("ครบ 5 นาที → ต้องเช็คใหม่", () => {
    expect(at(RECHECK_AFTER_SEC)).toBe(true);
    expect(at(RECHECK_AFTER_SEC + 3600)).toBe(true);
  });

  it("5 นาทีจริง ๆ ไม่ใช่เลขที่เขียนไว้สวย ๆ", () => {
    // เกณฑ์นี้มาจาก docs/PLAN.md ("เช็คทุก 5 นาที") ซึ่งมาจากเกณฑ์เสร็จของ Slice 2
    // ("ถอนสิทธิ์ที่ WorkID แล้วหลุดใน 5 นาที") — ผูกไว้กับเทสต์ ไม่งั้นมีคนมาผ่อนเป็น 60 นาที
    expect(RECHECK_AFTER_SEC).toBe(300);
  });
});

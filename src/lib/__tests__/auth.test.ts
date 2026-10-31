import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ForbiddenError,
  NotAuthenticatedError,
  currentActor,
  requireAdmin,
  requireUser,
} from "@/lib/auth";
import { SESSION_COOKIE, type SessionData, signSession } from "@/lib/session";

/**
 * cookie ปลอมของ request context — `cookies()` ของ next/headers โยน error
 * เมื่อถูกเรียกนอก request ซึ่งเป็นสถานะปกติของเทสต์
 */
const jar: { value?: string } = {};
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && jar.value !== undefined ? { value: jar.value } : undefined,
  }),
}));

const SECRET = "dGVzdC1zZWNyZXQtdGhhdC1pcy1sb25nLWVub3VnaA==";

const session: SessionData = {
  personId: 45,
  email: "boss@workstationoffice.com",
  name: "หัวหน้า",
  role: "admin",
  epoch: 3,
  checkedAt: Math.floor(Date.now() / 1000),
};

/**
 * ด่านสิทธิ์ (ยกมาจาก WorkIT) — WorkTrain ยังไม่ได้ลงทะเบียนแอปที่ WorkID ตอนเขียนโค้ดนี้
 * ทางลัด dev จึงยังจำเป็นสำหรับเปิดหน้าเว็บทดสอบ
 *
 * สิ่งที่เทสต์ชุดนี้กันคือ **การรอ SSO แบบเปิดประตูทิ้งไว้**:
 * ทางลัดสำหรับ dev ต้องใช้ได้เฉพาะบนเครื่อง และต้อง **ตายบน Vercel ทุกกรณี**
 * ไม่ใช่แค่ "ตั้งใจจะไม่ตั้ง env ตัวนั้นบน production"
 * (ข้อ 21 — กลไกกันที่ไม่มีใครวัดว่ามันเข้าเงื่อนไขจริง เท่ากับยังไม่ได้กันอะไร)
 */
beforeEach(() => {
  delete jar.value;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const DEV_ADMIN = "45:it.workstationoffice@gmail.com:IT Admin:admin";

describe("requireAdmin / requireUser", () => {
  it("ไม่มี session และไม่มีทางลัด → ปฏิเสธ", async () => {
    vi.stubEnv("WORKTRAIN_DEV_ACTOR", undefined);
    await expect(requireAdmin()).rejects.toThrow(NotAuthenticatedError);
  });

  it("บนเครื่อง dev ตั้ง WORKTRAIN_DEV_ACTOR แล้วเข้าได้", async () => {
    vi.stubEnv("WORKTRAIN_DEV_ACTOR", DEV_ADMIN);
    await expect(requireAdmin()).resolves.toMatchObject({
      personId: 45,
      email: "it.workstationoffice@gmail.com",
      role: "admin",
    });
  });

  it("**บน Vercel ทางลัดตายทุกกรณี** แม้จะตั้ง env มาแล้ว", async () => {
    vi.stubEnv("WORKTRAIN_DEV_ACTOR", DEV_ADMIN);
    vi.stubEnv("VERCEL", "1");
    await expect(requireAdmin()).rejects.toThrow(NotAuthenticatedError);
  });

  it("**NODE_ENV=production ทางลัดตายทุกกรณี** (preview deploy ก็เป็น production)", async () => {
    vi.stubEnv("WORKTRAIN_DEV_ACTOR", DEV_ADMIN);
    vi.stubEnv("NODE_ENV", "production");
    await expect(requireAdmin()).rejects.toThrow(NotAuthenticatedError);
  });

  it("user ดูแลระบบไม่ได้ แต่เรียนและสอบได้", async () => {
    vi.stubEnv("WORKTRAIN_DEV_ACTOR", "7:somchai@workstation.co.th:สมชาย:user");
    await expect(requireAdmin()).rejects.toThrow(ForbiddenError);
    await expect(requireUser()).resolves.toMatchObject({ role: "user", personId: 7 });
  });

  it("WORKTRAIN_DEV_ACTOR รูปแบบผิด → ดัง ไม่ใช่เมินเงียบ ๆ กลายเป็นไม่มีสิทธิ์", async () => {
    // ข้อ 14: fallback ที่เปลี่ยน "ตั้งค่าผิด" ให้เป็น "ค่าว่างที่ดูปกติ" คือกับดัก
    vi.stubEnv("WORKTRAIN_DEV_ACTOR", "somchai@workstation.co.th");
    await expect(requireAdmin()).rejects.toThrow(/WORKTRAIN_DEV_ACTOR/);

    vi.stubEnv("WORKTRAIN_DEV_ACTOR", "1:a@b.c:ชื่อ:superuser");
    await expect(requireAdmin()).rejects.toThrow(/WORKTRAIN_DEV_ACTOR/);

    // ไม่มี personId = กติกาต่อเรื่องใช้ไม่ได้เลย ต้องดังตั้งแต่ตอนอ่านค่า
    vi.stubEnv("WORKTRAIN_DEV_ACTOR", "a@b.c:ชื่อ:admin");
    await expect(requireAdmin()).rejects.toThrow(/WORKTRAIN_DEV_ACTOR/);
  });
});

describe("sessionActor", () => {
  it("cookie ที่เซ็นถูก → ได้ actor จาก session ไม่ใช่จากทางลัด", async () => {
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("WORKTRAIN_DEV_ACTOR", undefined);
    jar.value = await signSession(session);

    await expect(requireAdmin()).resolves.toEqual({
      personId: 45,
      email: "boss@workstationoffice.com",
      name: "หัวหน้า",
      nickname: null,
      role: "admin",
    });
  });

  it("**session จริงชนะทางลัด dev** — ไม่ใช่แค่มีโค้ดใหม่วางไว้ข้าง ๆ", async () => {
    // ข้อ 19: ฝั่งใหม่ที่ "ไม่มีข้อมูล" คือความเงียบ ไม่ใช่ error · ถ้า sessionActor()
    // ยังคืน null อยู่ ทุกอย่างจะดูทำงานปกติเพราะทางลัดรับช่วงไว้ให้ แล้วไม่มีใครรู้ว่า
    // SSO ไม่เคยทำงานเลย — เทสต์นี้คือสิ่งที่ทำให้ความเงียบนั้นดัง
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("WORKTRAIN_DEV_ACTOR", "9:shortcut@workstation.co.th:ทางลัด:user");
    jar.value = await signSession(session);

    await expect(currentActor()).resolves.toEqual({
      personId: 45,
      email: "boss@workstationoffice.com",
      name: "หัวหน้า",
      nickname: null,
      role: "admin",
    });
  });

  it("session เป็น user → ดูแลระบบไม่ได้ แต่เรียนและสอบได้", async () => {
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("WORKTRAIN_DEV_ACTOR", undefined);
    jar.value = await signSession({ ...session, role: "user" });

    await expect(requireAdmin()).rejects.toThrow(ForbiddenError);
    await expect(requireUser()).resolves.toMatchObject({ role: "user" });
  });

  it("cookie ปลอม → ไม่ผ่าน (ไม่ตกไปใช้ค่าใน payload ที่แก้มา)", async () => {
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("WORKTRAIN_DEV_ACTOR", undefined);
    jar.value = "eyJyb2xlIjoiYWRtaW4ifQ.bm90LWEtcmVhbC1tYWM";

    await expect(requireAdmin()).rejects.toThrow(NotAuthenticatedError);
  });

  it("มี cookie แต่ไม่มี SESSION_SECRET → **ดัง** ไม่ใช่กลายเป็นไม่ได้ล็อกอิน", async () => {
    vi.stubEnv("SESSION_SECRET", SECRET);
    const token = await signSession(session);

    vi.stubEnv("SESSION_SECRET", undefined);
    vi.stubEnv("WORKTRAIN_DEV_ACTOR", undefined);
    jar.value = token;

    await expect(requireAdmin()).rejects.toThrow(/SESSION_SECRET/);
  });

  it("ไม่มี cookie + ไม่มี SESSION_SECRET → ยังใช้ทางลัดได้ (ไม่บังคับตั้ง env ที่ยังไม่ได้ใช้)", async () => {
    vi.stubEnv("SESSION_SECRET", undefined);
    vi.stubEnv("WORKTRAIN_DEV_ACTOR", DEV_ADMIN);

    await expect(requireAdmin()).resolves.toMatchObject({ role: "admin" });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WORKID_CALLBACK_PATH,
  WORKID_EXCHANGE_TIMEOUT_MS,
  WORKID_SESSION_TIMEOUT_MS,
  checkWorkIdSession,
  exchangeWorkIdCode,
  newWorkIdState,
  roleFromWorkId,
  verifyWorkIdState,
  workIdConfigured,
  workIdLoginUrl,
  workIdLogoutUrl,
} from "@/lib/workid";

/**
 * client ของ WorkID — ทุกฟิลด์ในนี้เปิด type ฝั่งเจ้าของข้อมูลมาดูจริงแล้ว ไม่ได้เดา (ข้อ 14)
 *   `WorkID/src/app/api/v1/auth/exchange/route.ts` → { personId, email, fullName, name, nickname, role, epoch }
 *   `WorkID/src/lib/app-auth.ts` `SessionCheck`    → { valid: true, role, epoch }
 *                                                  | { valid: false, reason }
 */
const BASE = "https://workid.workstationoffice.com";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function configured() {
  vi.stubEnv("WORKID_BASE_URL", BASE);
  vi.stubEnv("WORKID_API_KEY", "wid_test");
  vi.stubEnv("WORKID_APP_KEY", "worktrain");
}

/** ตอบเป็น JSON แบบที่ `fetch` จริงตอบ — ไม่ mock ตัว client ของเราเอง */
function stubFetch(...responses: Array<{ status: number; body?: unknown } | Error>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  vi.stubGlobal("fetch", (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve(
      new Response(r.body === undefined ? "" : JSON.stringify(r.body), {
        status: r.status,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return calls;
}

describe("workIdConfigured — ยังไม่ตั้ง env ต้องทำงานเหมือนเดิม ไม่พัง", () => {
  it("ต้องมีทั้ง base url และ api key", () => {
    vi.stubEnv("WORKID_BASE_URL", BASE);
    vi.stubEnv("WORKID_API_KEY", undefined);
    expect(workIdConfigured()).toBe(false);

    vi.stubEnv("WORKID_BASE_URL", undefined);
    vi.stubEnv("WORKID_API_KEY", "wid_test");
    expect(workIdConfigured()).toBe(false);

    configured();
    expect(workIdConfigured()).toBe(true);
  });

  it("ไม่ได้ตั้งค่า → ไม่มี URL ให้ไป (คืน null ไม่ประกอบ URL ครึ่ง ๆ กลาง ๆ)", () => {
    vi.stubEnv("WORKID_BASE_URL", undefined);
    vi.stubEnv("WORKID_API_KEY", undefined);
    expect(workIdLoginUrl("https://train.workstationoffice.com", "s")).toBeNull();
    expect(workIdLogoutUrl()).toBeNull();
  });
});

describe("state — ตัวกัน login CSRF", () => {
  it("สุ่มไม่ซ้ำ และ **ไม่เกิน 128 ตัวอักษร**", () => {
    const values = new Set(Array.from({ length: 50 }, () => newWorkIdState()));
    expect(values.size).toBe(50);
    for (const v of values) {
      // WorkID `sanitizeAppState` ทิ้ง state ที่ยาวเกิน 128 **เงียบ ๆ** แล้วไม่ส่งคืน
      // → อาการจะเป็น "state ไม่ตรง" ทุกครั้งโดยไม่มีใครนึกถึงความยาว
      expect(v.length).toBeLessThanOrEqual(128);
      expect(v.length).toBeGreaterThanOrEqual(20);
      expect(v).toBe(v.trim()); // sanitizeAppState trim ก่อนเทียบ
    }
  });

  it("ยาวไม่เท่ากัน → คืน false **ไม่ throw**", () => {
    // กับดักที่คู่มือ WorkID เตือน: node timingSafeEqual โยน error เมื่อยาวไม่เท่ากัน
    // ถ้าปล่อยให้ throw callback จะกลายเป็น 500 แทนที่จะปฏิเสธอย่างสุภาพ
    expect(verifyWorkIdState("abc", "abcd")).toBe(false);
    expect(verifyWorkIdState("a".repeat(43), "a".repeat(42))).toBe(false);
  });

  it("ตรงกันผ่าน · ไม่ตรงไม่ผ่าน · ว่าง/null ไม่ผ่าน", () => {
    const s = newWorkIdState();
    expect(verifyWorkIdState(s, s)).toBe(true);
    expect(verifyWorkIdState(s, newWorkIdState())).toBe(false);
    for (const [a, b] of [
      [null, s],
      [s, null],
      ["", ""],
      [undefined, undefined],
    ] as const) {
      expect(verifyWorkIdState(a, b)).toBe(false);
    }
  });
});

describe("roleFromWorkId — role ที่ไม่รู้จักต้องปฏิเสธ ห้ามเดา", () => {
  it("รับแค่ admin · author · user (role ของแอป worktrain ที่ลงทะเบียนไว้ใน WorkID)", () => {
    expect(roleFromWorkId("admin")).toBe("admin");
    expect(roleFromWorkId("author")).toBe("author");
    expect(roleFromWorkId("user")).toBe("user");
  });

  it("role ของแอปอื่นที่หลุดมา → null", () => {
    // `designer_admin` ของ DESList เคยไปโผล่ที่ PDList จริง
    // เดาต่ำ = เข้ามาแล้วทำอะไรไม่ได้ · เดาสูง = ได้สิทธิ์ที่ไม่มีใครตั้งใจให้
    for (const r of ["designer_admin", "staff", "supervisor", "member", "viewer", "ADMIN", "", " ", null, undefined]) {
      expect(roleFromWorkId(r)).toBeNull();
    }
  });
});

describe("workIdLoginUrl", () => {
  it("ยิงไป /auth/start พร้อม app · return ที่เป็น callback path จริง · state", () => {
    configured();
    const url = new URL(workIdLoginUrl("https://train.workstationoffice.com", "st4te")!);

    expect(url.origin + url.pathname).toBe(`${BASE}/auth/start`);
    expect(url.searchParams.get("app")).toBe("worktrain");
    expect(url.searchParams.get("state")).toBe("st4te");
    // ยืนยันกับ WorkID ตัวจริงแล้วว่า path ที่ลงทะเบียนไว้คือตัวที่มี /api
    // (ตัวที่ไม่มี /api ได้ HTTP 400 — ดู docs/PLAN.md §โดเมนและการลงทะเบียนแอป)
    expect(url.searchParams.get("return")).toBe(
      "https://train.workstationoffice.com/api/auth/workid/callback",
    );
    expect(WORKID_CALLBACK_PATH).toBe("/api/auth/workid/callback");
  });

  it("logout ส่ง app ไปด้วย — WorkID เลือกโดเมนที่จะเด้งกลับจาก return_urls เอง", () => {
    configured();
    const url = new URL(workIdLogoutUrl()!);
    expect(url.origin + url.pathname).toBe(`${BASE}/auth/logout`);
    expect(url.searchParams.get("app")).toBe("worktrain");
  });
});

describe("exchangeWorkIdCode", () => {
  it("สำเร็จ → คืนตัวตนครบ และยิงแบบ server-to-server พร้อม Bearer", async () => {
    configured();
    const calls = stubFetch({
      status: 200,
      body: { personId: 45, email: "it@wso.com", fullName: "IT Admin (ไอที)", name: "IT Admin", nickname: "ไอที", role: "admin", epoch: 3 },
    });

    await expect(exchangeWorkIdCode("real-code")).resolves.toEqual({
      ok: true,
      identity: { personId: 45, email: "it@wso.com", fullName: "IT Admin (ไอที)", name: "IT Admin", nickname: "ไอที", role: "admin", epoch: 3 },
    });

    expect(calls[0].url).toBe(`${BASE}/api/v1/auth/exchange`);
    expect(calls[0].init?.method).toBe("POST");
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("authorization")).toBe("Bearer wid_test");
  });

  it("code ใช้แล้ว/หมดอายุ → คืนเหตุผลของ WorkID ไม่กลืนเป็น 'ล็อกอินไม่สำเร็จ'", async () => {
    configured();
    stubFetch({ status: 400, body: { error: "used" } });
    await expect(exchangeWorkIdCode("x")).resolves.toEqual({ ok: false, error: "used" });
  });

  it("**ตอบ 200 แต่ฟิลด์ไม่ครบ → ล้มเหลวแบบดัง** ไม่ใช่ตัวตนที่ขาดฟิลด์", async () => {
    configured();
    // ข้อ 14: fallback ที่เปลี่ยน "รูปร่างไม่ตรง" ให้เป็นค่าว่างที่ดูปกติ คือกับดัก
    // ตัวตนที่ไม่มี email จะไปโผล่เป็นเคสที่ไม่มีผู้แจ้งทีหลัง ไกลจากต้นเหตุมาก
    stubFetch({ status: 200, body: { personId: 45, role: "admin", epoch: 3 } });
    const result = await exchangeWorkIdCode("x");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/รูปร่าง|shape/i);
  });

  it("เน็ตล่ม → คืน ok:false ไม่ throw ขึ้นไปเป็น 500", async () => {
    configured();
    stubFetch(new Error("fetch failed"));
    const result = await exchangeWorkIdCode("x");
    expect(result.ok).toBe(false);
  });
});

describe("checkWorkIdSession — สามสถานะ ไม่ใช่สอง", () => {
  it("valid:true → ตัดสินแล้วว่ายังใช้ได้ พร้อม role ล่าสุด", async () => {
    configured();
    const calls = stubFetch({ status: 200, body: { valid: true, role: "user", epoch: 4 } });

    await expect(checkWorkIdSession(45, 3)).resolves.toEqual({
      decided: true,
      valid: true,
      role: "user",
      epoch: 4,
    });

    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/api/v1/session/check");
    expect(url.searchParams.get("personId")).toBe("45");
    expect(url.searchParams.get("epoch")).toBe("3");
    // กับดักข้อ 1 ของคู่มือ: revalidate เป็น stale-while-revalidate
    // → กด logout แล้ว refresh ครั้งแรกยังเข้าได้ ซึ่งสำหรับการเช็คสิทธิ์คือ *ผิด*
    expect((calls[0].init as { cache?: string } | undefined)?.cache).toBe("no-store");
  });

  it("valid:false → ตัดสินแล้วว่าหลุด พร้อมเหตุผลไว้ลง log", async () => {
    configured();
    stubFetch({ status: 200, body: { valid: false, reason: "no_access" } });
    await expect(checkWorkIdSession(45, 3)).resolves.toEqual({
      decided: true,
      valid: false,
      reason: "no_access",
    });
  });

  it("**200 แต่ไม่มีฟิลด์ valid → 'ถามไม่ได้' ไม่ใช่ 'ถูกถอนสิทธิ์'**", async () => {
    configured();
    // นี่คือกับดักข้อ 8 ของคู่มือ WorkID: `(await res.json()) as SessionCheck`
    // แล้วเช็ค `!check.valid` จะ **เตะทุกคนที่ล็อกอินด้วย WorkID ออกพร้อมกัน**
    // และล็อกอินใหม่ก็โดนเตะซ้ำ เพราะคำตอบยังรูปร่างเดิม
    for (const body of [{}, { valid: "yes" }, { ok: true }, { valid: 1 }, [], null]) {
      stubFetch({ status: 200, body });
      expect(await checkWorkIdSession(45, 3)).toMatchObject({ decided: false });
    }
  });

  it("valid:true แต่ role/epoch ไม่ครบ → ถามไม่ได้ ไม่ใช่ยอมรับ role ที่หายไป", async () => {
    configured();
    // ถ้ายอมรับ จะได้ actor ที่ role เป็น undefined แล้วไปตกที่ permission check
    // เป็น "ไม่มีสิทธิ์" ซึ่งแยกไม่ออกจากการถูกถอนสิทธิ์จริง
    stubFetch({ status: 200, body: { valid: true } });
    expect(await checkWorkIdSession(45, 3)).toMatchObject({ decided: false });

    stubFetch({ status: 200, body: { valid: true, role: "user" } });
    expect(await checkWorkIdSession(45, 3)).toMatchObject({ decided: false });
  });

  it("WorkID ล่ม (5xx / เน็ตพัง / ไม่ใช่ JSON) → ถามไม่ได้ = ปล่อยผ่าน", async () => {
    configured();
    // กับดักข้อ 5: ถ้าเลือกเตะ ทั้งบริษัทจะใช้ทุกระบบไม่ได้พร้อมกันทันทีที่ระบบกลางสะดุด
    stubFetch({ status: 503, body: { error: "down" } });
    expect((await checkWorkIdSession(45, 3)).decided).toBe(false);

    stubFetch(new Error("ECONNREFUSED"));
    expect((await checkWorkIdSession(45, 3)).decided).toBe(false);

    vi.stubGlobal("fetch", () => Promise.resolve(new Response("<html>502</html>", { status: 200 })));
    expect((await checkWorkIdSession(45, 3)).decided).toBe(false);
  });

  it("ยังไม่ตั้ง env → ถามไม่ได้ ไม่ใช่หลุด", async () => {
    vi.stubEnv("WORKID_BASE_URL", undefined);
    vi.stubEnv("WORKID_API_KEY", undefined);
    expect((await checkWorkIdSession(45, 3)).decided).toBe(false);
  });
});

describe("timeout — WorkID ค้างต้องไม่ลากทุกหน้าของ WorkTrain ค้างตาม", () => {
  it("ทุกการเรียกแนบ AbortSignal มาด้วย", async () => {
    configured();
    let calls = stubFetch({ status: 200, body: { valid: true, role: "user", epoch: 4 } });
    await checkWorkIdSession(45, 3);
    expect((calls[0].init as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal);

    calls = stubFetch({
      status: 200,
      body: { personId: 1, email: "a@b.c", fullName: "n", role: "admin", epoch: 1 },
    });
    await exchangeWorkIdCode("c");
    expect((calls[0].init as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal);
  });

  it("ครบเวลาแล้วถูก abort → 'ถามไม่ได้' (ปล่อยผ่าน) ไม่ใช่ 'หลุด'", async () => {
    configured();
    // fetch จริงจะ reject ด้วย AbortError เมื่อ signal ครบเวลา
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    stubFetch(abortErr);
    expect((await checkWorkIdSession(45, 3)).decided).toBe(false);

    stubFetch(abortErr);
    expect((await exchangeWorkIdCode("c")).ok).toBe(false);
  });

  it("งบเวลาของ session/check สั้นกว่า exchange — คนละสถานการณ์", () => {
    // session/check วิ่งบนเส้นทางที่ผู้ใช้กำลังรอหน้าเว็บอยู่ → ต้องยอมแพ้เร็ว
    // ส่วน exchange เกิดครั้งเดียวตอนล็อกอิน รอได้นานกว่า และล้มแล้วต้องล็อกอินใหม่ทั้งรอบ
    expect(WORKID_SESSION_TIMEOUT_MS).toBeLessThan(WORKID_EXCHANGE_TIMEOUT_MS);
    expect(WORKID_SESSION_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });
});

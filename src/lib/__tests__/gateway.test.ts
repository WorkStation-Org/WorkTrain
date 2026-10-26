import { afterEach, describe, expect, it, vi } from "vitest";
import { PUSH_TIMEOUT_MS, gatewayConfigured, getFriendship, getGroupSummary, pushAsync, pushJobStatuses, pushMany, replyOnce } from "@/lib/gateway";

/**
 * client ของ GateWay — **นี่คือไฟล์ที่บั๊กของ PDList อยู่** (9 ส.ค. 2026)
 *
 * PDList ยิงแจ้งเตือนเข้ากลุ่มก่อน 1:1 เสมอ กลุ่มจึงรับ cold start ทุกครั้ง
 * แล้ว `catch` คืน `false` เงียบ ๆ ส่วนฟังก์ชันคืน `{ok:true, sent:0}` = "สำเร็จ"
 * ทั้งที่ไม่มีใครได้รับ → **แจ้งเตือนกลุ่มหายทั้งวันจนผู้ใช้มาทักเอง**
 *
 * กติกาข้อ 12 บังคับสามข้อ และเทสต์ในไฟล์นี้ต้องพิสูจน์ครบทั้งสาม:
 *   1. retry อย่างน้อย 1 ครั้งเมื่อ **ต่อไม่ติด/timeout** — และ **ห้าม retry เมื่อได้ status กลับมา**
 *   2. ห้ามรายงานว่าสำเร็จเมื่อไม่ถึงใคร
 *   3. ห้ามให้ช่องทางใดเป็นตัวรับ cold start ให้ช่องทางอื่นประจำ → **ยิงพร้อมกัน**
 */
const BASE = "https://gateway.workstationoffice.com";
const CHANNEL = "1234567890";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function configured() {
  vi.stubEnv("GATEWAY_BASE_URL", BASE);
  vi.stubEnv("GATEWAY_API_KEY", "wlg_test");
  vi.stubEnv("GATEWAY_LINE_CHANNEL_ID", CHANNEL);
}

const request = (to: string) => ({
  to,
  messages: [{ type: "text", text: "ทดสอบ" }],
  idempotencyKey: `ticket:1:opened:0:${to}`,
});

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

describe("gatewayConfigured", () => {
  it("ต้องมีครบสามค่า — ขาดตัวใดตัวหนึ่งถือว่ายังไม่เปิดใช้", () => {
    configured();
    expect(gatewayConfigured()).toBe(true);
    for (const k of ["GATEWAY_BASE_URL", "GATEWAY_API_KEY", "GATEWAY_LINE_CHANNEL_ID"]) {
      configured();
      vi.stubEnv(k, undefined);
      expect(gatewayConfigured()).toBe(false);
    }
  });

  it("ยังไม่ตั้งค่า → คืน ok:false ไม่ throw และไม่ยิงออกนอก", async () => {
    vi.stubEnv("GATEWAY_BASE_URL", undefined);
    const calls = stubFetch({ status: 202, body: { status: "queued", jobId: "j1" } });
    const r = await pushAsync(request("U1"));
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("pushAsync — ใช้ push-async เสมอ ไม่ใช้ /push", () => {
  it("202 queued → ok พร้อม jobId · ยิงไปที่ push-async ของ channel ที่ตั้งไว้", async () => {
    configured();
    const calls = stubFetch({ status: 202, body: { status: "queued", jobId: "job-1" } });

    await expect(pushAsync(request("U1"))).resolves.toEqual({
      ok: true,
      status: "queued",
      jobId: "job-1",
    });

    // `/push` ไม่มี retry ไม่มี idempotency — ส่งพลาดคือหาย
    expect(calls[0].url).toBe(`${BASE}/v1/line/${CHANNEL}/push-async`);
    expect(calls[0].url).not.toContain("/push-async/");
    expect(calls[0].init?.method).toBe("POST");
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe("Bearer wlg_test");

    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toMatchObject({ to: "U1", idempotencyKey: "ticket:1:opened:0:U1" });
  });

  it("200 duplicate → **ถือว่าสำเร็จ** (ปลายทางมีงานนั้นอยู่แล้ว)", async () => {
    configured();
    stubFetch({ status: 200, body: { status: "duplicate", jobId: "job-1", jobStatus: "success" } });
    await expect(pushAsync(request("U1"))).resolves.toMatchObject({
      ok: true,
      status: "duplicate",
      jobId: "job-1",
    });
  });

  it("**ตอบ 2xx แต่ไม่มี jobId → ไม่ใช่สำเร็จ**", async () => {
    configured();
    // ข้อ 12 ข้อ 2: ห้ามรายงานว่าสำเร็จเมื่อไม่ถึงใคร · jobId คือเส้นเดียวที่ลากต่อ
    // ไปหา /api/outbound-jobs ได้ ไม่มีมันก็ตอบไม่ได้ว่าใบนั้นส่งไปหรือยัง
    stubFetch({ status: 202, body: { status: "queued" } });
    const r = await pushAsync(request("U1"));
    expect(r.ok).toBe(false);
  });
});

describe("retry — ตามข้อ 12 ข้อ 1", () => {
  it("ต่อไม่ติด → **retry 1 ครั้ง** แล้วสำเร็จ", async () => {
    configured();
    const calls = stubFetch(
      new Error("fetch failed"),
      { status: 202, body: { status: "queued", jobId: "job-2" } },
    );

    await expect(pushAsync(request("U1"))).resolves.toMatchObject({ ok: true, jobId: "job-2" });
    expect(calls).toHaveLength(2);
    // retry ต้องใช้ idempotencyKey เดิม ไม่งั้นถ้าครั้งแรกถึงจริงจะได้สองข้อความ
    expect(JSON.parse(String(calls[1].init?.body)).idempotencyKey).toBe(
      JSON.parse(String(calls[0].init?.body)).idempotencyKey,
    );
  });

  it("ต่อไม่ติดสองครั้ง → ok:false และบอกว่า retry แล้ว", async () => {
    configured();
    const calls = stubFetch(new Error("ECONNREFUSED"));
    const r = await pushAsync(request("U1"));

    expect(r).toMatchObject({ ok: false, retried: true });
    expect(calls).toHaveLength(2);
  });

  it("**ได้ status กลับมาแล้วห้าม retry** — ปลายทางรับไปแล้ว", async () => {
    configured();
    // ยิงซ้ำตอนได้ 400/500 คือเสี่ยงส่งซ้ำโดยไม่จำเป็น (GateWay retry เองอยู่แล้ว 6 ครั้ง)
    for (const status of [400, 401, 403, 429, 500, 503]) {
      const calls = stubFetch({ status, body: { error: "nope" } });
      const r = await pushAsync(request("U1"));
      expect(r).toMatchObject({ ok: false, retried: false });
      expect(calls).toHaveLength(1);
    }
  });

  it("timeout ถูกแนบมาด้วย และ abort นับเป็น 'ต่อไม่ติด' (retry ได้)", async () => {
    configured();
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const calls = stubFetch(abort, { status: 202, body: { status: "queued", jobId: "j3" } });

    await expect(pushAsync(request("U1"))).resolves.toMatchObject({ ok: true });
    expect(calls).toHaveLength(2);
    expect((calls[0].init as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal);
    expect(PUSH_TIMEOUT_MS).toBeGreaterThanOrEqual(8000);
  });
});

describe("pushMany — ข้อ 12 ข้อ 3: ยิงพร้อมกัน ไม่ใช่เรียงกัน", () => {
  it("**ทั้งสองปลายทางเริ่มยิงก่อนที่ตัวใดตัวหนึ่งจะเสร็จ**", async () => {
    configured();
    // เทสต์นี้จะ **ค้างแล้ว fail** ถ้า implement เป็น await เรียงกัน เพราะคำขอที่สอง
    // จะไม่เริ่มจนคำขอแรกเสร็จ ส่วนคำขอแรกก็รอคำขอที่สองอยู่ → พิสูจน์ความพร้อมกัน
    // ได้จริง ไม่ใช่แค่ assert ว่า "เรียก 2 ครั้ง" ซึ่งการยิงเรียงกันก็ผ่าน
    let started = 0;
    let release!: () => void;
    const bothStarted = new Promise<void>((r) => {
      release = r;
    });

    vi.stubGlobal("fetch", async () => {
      started += 1;
      if (started === 2) release();
      await bothStarted;
      return new Response(JSON.stringify({ status: "queued", jobId: `job-${started}` }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    });

    const results = await pushMany([request("U-reporter"), request("C-itgroup")]);

    expect(started).toBe(2);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("ปลายทางหนึ่งล้ม อีกปลายทางต้องยังส่งได้ และผลต้องแยกกันชัด", async () => {
    configured();
    let n = 0;
    vi.stubGlobal("fetch", (_url: string | URL, init?: RequestInit) => {
      n += 1;
      const to = JSON.parse(String(init?.body)).to as string;
      if (to.startsWith("C")) return Promise.reject(new Error("group cold start timeout"));
      return Promise.resolve(
        new Response(JSON.stringify({ status: "queued", jobId: `job-${n}` }), {
          status: 202,
          headers: { "content-type": "application/json" },
        }),
      );
    });

    const [reporter, group] = await pushMany([request("U-reporter"), request("C-itgroup")]);

    expect(reporter.ok).toBe(true);
    // ★ หัวใจของบั๊ก PDList: ตัวที่ล้มต้องรายงานว่าล้ม ไม่ใช่ถูกกลืนแล้วสรุปว่าสำเร็จ
    expect(group).toMatchObject({ ok: false, retried: true });
  });

  it("ลำดับผลลัพธ์ตรงกับลำดับที่ส่งเข้าไป (ไม่ใช่ลำดับที่เสร็จ)", async () => {
    configured();
    let call = 0;
    vi.stubGlobal("fetch", async (_u: string | URL, init?: RequestInit) => {
      const to = JSON.parse(String(init?.body)).to as string;
      // ตัวแรกช้ากว่าตัวที่สองโดยเจตนา
      await new Promise((r) => setTimeout(r, to === "U-first" ? 20 : 0));
      call += 1;
      return new Response(JSON.stringify({ status: "queued", jobId: to }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    });

    const results = await pushMany([request("U-first"), request("U-second")]);
    expect(results.map((r) => (r.ok ? r.jobId : null))).toEqual(["U-first", "U-second"]);
    expect(call).toBe(2);
  });
});

describe("replyOnce — ตอบด้วย reply token ผ่าน /v1/line/:ch/reply", () => {
  const req = { replyToken: "rt-1", messages: [{ type: "text", text: "กดเมนูด้านล่างครับ" }] };

  it("200 → ok · ยิงไปที่ /reply ของ channel ที่ตั้งไว้ พร้อม token", async () => {
    configured();
    const calls = stubFetch({ status: 200, body: { status: "ok" } });

    await expect(replyOnce(req)).resolves.toEqual({ ok: true });
    expect(calls[0].url).toBe(`${BASE}/v1/line/${CHANNEL}/reply`);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual(req);
  });

  it("**token หมดอายุ/ถูกใช้แล้ว → reason 'invalid_reply_token'** ให้ผู้เรียกถอยไป push", async () => {
    configured();
    stubFetch({ status: 400, body: { status: "invalid_reply_token", error: "Invalid reply token" } });
    await expect(replyOnce(req)).resolves.toEqual({ ok: false, reason: "invalid_reply_token" });
  });

  it("error อื่นจาก GateWay → ok:false พร้อมเหตุผล และ **ไม่ retry** (reply ซ้ำ = ข้อความซ้ำ)", async () => {
    configured();
    const calls = stubFetch({ status: 502, body: { error: "LINE 500" } });
    const r = await replyOnce(req);
    expect(r).toEqual({ ok: false, reason: "LINE 500" });
    expect(calls).toHaveLength(1);
  });

  it("ต่อไม่ติด → ok:false ไม่ throw และ **ไม่ retry** (token ใช้ได้ครั้งเดียว ถ้าครั้งแรกถึงแล้วซ้ำจะล้มเปล่า)", async () => {
    configured();
    const calls = stubFetch(new Error("fetch failed"));
    const r = await replyOnce(req);
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("ยังไม่ตั้งค่า → ok:false ไม่ยิงออกนอก", async () => {
    vi.stubEnv("GATEWAY_BASE_URL", undefined);
    const calls = stubFetch({ status: 200, body: { status: "ok" } });
    expect((await replyOnce(req)).ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("getGroupSummary — ถามชื่อกลุ่มและเช็กว่า Work Bot ยังอยู่ในกลุ่ม", () => {
  const GROUP = `C${"a".repeat(32)}`;

  it("ยังไม่ตั้งค่า / groupId ผิดรูปแบบ → unavailable พร้อมเหตุผล และไม่ยิงออกนอก", async () => {
    const calls = stubFetch({ status: 200, body: { status: "ok", group: { name: "x" } } });
    expect(await getGroupSummary(GROUP)).toEqual({ status: "unavailable", why: "gateway_not_configured" });
    configured();
    expect(await getGroupSummary("../evil")).toEqual({ status: "unavailable", why: "bad_group_id" });
    expect(calls).toEqual([]);
  });

  it("ok → ชื่อกลุ่ม · ยิง GET ไปที่ summary ของ channel ด้วยคีย์ชุดเดียวกับตอนส่ง", async () => {
    configured();
    const calls = stubFetch({ status: 200, body: { status: "ok", group: { name: "CEO + เลขา", pictureUrl: null } } });
    expect(await getGroupSummary(GROUP)).toEqual({ status: "ok", name: "CEO + เลขา" });
    expect(calls[0].url).toBe(`${BASE}/v1/line/${CHANNEL}/groups/${GROUP}/summary`);
    expect(calls[0].init?.method ?? "GET").toBe("GET");
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe("Bearer wlg_test");
  });

  it("ok แต่ไม่มีชื่อ → name เป็น null (ไม่ใช่สตริงว่าง)", async () => {
    configured();
    stubFetch({ status: 200, body: { status: "ok", group: { name: "" } } });
    expect(await getGroupSummary(GROUP)).toEqual({ status: "ok", name: null });
  });

  it("not_found = รู้แล้วว่า Work Bot ไม่อยู่ในกลุ่ม — คนละเรื่องกับตอบไม่ได้", async () => {
    configured();
    stubFetch({ status: 200, body: { status: "not_found" } });
    expect(await getGroupSummary(GROUP)).toEqual({ status: "not_found" });
  });

  it("★ ข้อ 12: ตอบไม่ได้ (401/429/5xx) = unavailable ไม่ใช่ not_found และไม่ใช่กลุ่มปกติ · ไม่ retry เมื่อได้ status กลับมา", async () => {
    configured();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const calls = stubFetch({ status: 429, body: { error: "LINE rate limit" } });
    expect(await getGroupSummary(GROUP)).toEqual({ status: "unavailable", why: "LINE rate limit" });
    expect(calls).toHaveLength(1);

    stubFetch({ status: 502 });
    expect(await getGroupSummary(GROUP)).toEqual({ status: "unavailable", why: "http_502" });
    // 200 ที่ไม่ใช่รูปที่รู้จัก ก็ไม่ใช่ ok
    stubFetch({ status: 200, body: { hello: "world" } });
    expect((await getGroupSummary(GROUP)).status).toBe("unavailable");
    log.mockRestore();
  });

  it("★ ข้อ 12: ต่อไม่ติด retry หนึ่งครั้ง (cold start) · ล้มทั้งสองครั้งคืน unavailable ไม่กลืนเงียบ", async () => {
    configured();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const calls = stubFetch(new TypeError("fetch failed"), { status: 200, body: { status: "ok", group: { name: "กลุ่ม" } } });
    expect(await getGroupSummary(GROUP)).toEqual({ status: "ok", name: "กลุ่ม" });
    expect(calls).toHaveLength(2);

    const dead = stubFetch(new TypeError("fetch failed"));
    const r = await getGroupSummary(GROUP);
    expect(r.status).toBe("unavailable");
    expect(dead).toHaveLength(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("gateway_group_summary_failed"));
    log.mockRestore();
  });

  it("log ไม่มี groupId (เป็นข้อมูลของกลุ่ม ไม่ควรลง log)", async () => {
    configured();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    stubFetch({ status: 403, body: { error: "forbidden" } });
    await getGroupSummary(GROUP);
    stubFetch(new TypeError("fetch failed"));
    await getGroupSummary(GROUP);
    expect(log.mock.calls.flat().join("\n")).not.toContain(GROUP);
    log.mockRestore();
  });
});

describe("getFriendship — ก่อนเตือนตัวต่อตัว: แอด Work Bot แล้วหรือยัง", () => {
  const USER = `U${"1".repeat(32)}`;

  it("ok = friend · not_friend = รู้แน่ว่าส่งไม่ถึง · ยิง GET profile ของ channel", async () => {
    configured();
    const calls = stubFetch({ status: 200, body: { status: "ok", friend: true, profile: {} } });
    expect(await getFriendship(USER)).toEqual({ status: "friend" });
    expect(calls[0].url).toBe(`${BASE}/v1/line/${CHANNEL}/profile/${USER}`);
    stubFetch({ status: 200, body: { status: "not_friend", friend: false, profile: null } });
    expect(await getFriendship(USER)).toEqual({ status: "not_friend" });
  });

  it("★ ตอบไม่ได้ = unavailable ไม่ใช่ not_friend — ผู้เรียกต้องส่งต่อ (fail-open) · userId ผิดรูปไม่ยิงออก", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const none = stubFetch({ status: 200, body: { status: "ok" } });
    expect((await getFriendship(USER)).status).toBe("unavailable");
    configured();
    expect(await getFriendship("../x")).toEqual({ status: "unavailable", why: "bad_user_id" });
    expect(none).toEqual([]);
    stubFetch({ status: 429, body: { error: "LINE rate limit" } });
    expect(await getFriendship(USER)).toEqual({ status: "unavailable", why: "LINE rate limit" });
    const calls = stubFetch(new TypeError("fetch failed"));
    expect((await getFriendship(USER)).status).toBe("unavailable");
    expect(calls).toHaveLength(2);
    log.mockRestore();
  });
});

describe("pushJobStatuses — ผลจริงของงาน push-async (GateWay#125)", () => {
  const JOB = "794a3e84-6ceb-4bf9-8f5c-ab358632db2c";

  it("ถาม GET push-async/status ด้วย key ของเรา แล้วคืน jobs + missing", async () => {
    configured();
    const calls = stubFetch({
      status: 200,
      body: { jobs: [{ jobId: JOB, status: "dead", attempts: 1, lastStatusCode: 400, lastError: "Failed to send messages", updatedAt: "x" }], missing: ["gone"] },
    });
    expect(await pushJobStatuses([JOB, "gone"])).toEqual({
      ok: true,
      jobs: [{ jobId: JOB, status: "dead", lastStatusCode: 400, lastError: "Failed to send messages" }],
      missing: ["gone"],
    });
    expect(calls[0].url).toBe(`${BASE}/v1/line/${CHANNEL}/push-async/status?ids=${JOB},gone`);
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe("Bearer wlg_test");
  });

  it("★ GateWay รุ่นที่ยังไม่มี endpoint (404) · ต่อไม่ติด = ok:false ไม่ใช่ 'ไม่มีงานตาย'", async () => {
    configured();
    stubFetch({ status: 404, body: { error: "not found" } });
    expect(await pushJobStatuses([JOB])).toEqual({ ok: false, why: "not found" });
    stubFetch(new Error("fetch failed"));
    expect((await pushJobStatuses([JOB])).ok).toBe(false);
  });

  it("ไม่ได้ตั้ง GateWay · ไม่มี job = ไม่เรียก", async () => {
    expect(await pushJobStatuses([JOB])).toEqual({ ok: false, why: "gateway_not_configured" });
    configured();
    const calls = stubFetch();
    expect(await pushJobStatuses([])).toEqual({ ok: true, jobs: [], missing: [] });
    expect(calls).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";
import { maxNewSegments, segmentWatchTarget, videoSegmentCount, formatDuration, maxBytesFor, kindAllowsMime } from "@/domain/document";
import { mp4DurationSeconds } from "@/domain/mp4";
import { fakeMp4, rangeReader } from "./mp4-fixture";

/** ความยาววิดีโอจากหัวไฟล์ MP4 + กติกาการนับช่วง (ADR-0013) */

describe("mp4DurationSeconds", () => {
  it("moov อยู่ต้นไฟล์ (faststart) · mvhd version 0", async () => {
    const f = fakeMp4({ seconds: 125.5 });
    expect(await mp4DurationSeconds(rangeReader(f), f.length)).toBeCloseTo(125.5);
  });

  it("moov อยู่ท้ายไฟล์หลัง mdat ก้อนใหญ่ — อ่านแค่หัวกล่อง ไม่ไล่อ่านเนื้อ", async () => {
    const f = fakeMp4({ seconds: 61, moovAtEnd: true, mdatBytes: 5_000_000 });
    const read = rangeReader(f);
    expect(await mp4DurationSeconds(read, f.length)).toBe(61);
    expect(read.calls).toBeLessThan(10);
  });

  it("mvhd version 1 (ความยาว 64 บิต)", async () => {
    const f = fakeMp4({ seconds: 3 * 3600, version: 1, timescale: 90_000 });
    expect(await mp4DurationSeconds(rangeReader(f), f.length)).toBe(3 * 3600);
  });

  it("ไม่ใช่ MP4 · ไฟล์ขาด · ไม่มีความยาว (fragmented) → null", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7 ".repeat(20));
    expect(await mp4DurationSeconds(rangeReader(pdf), pdf.length)).toBeNull();
    const f = fakeMp4({ seconds: 30, moovAtEnd: true });
    const cut = f.slice(0, f.length - 20);
    expect(await mp4DurationSeconds(rangeReader(cut), cut.length)).toBeNull();
    const zero = fakeMp4({ seconds: 0 });
    expect(await mp4DurationSeconds(rangeReader(zero), zero.length)).toBeNull();
    expect(await mp4DurationSeconds(rangeReader(new Uint8Array()), 0)).toBeNull();
  });

  it("ตัวอ่านโยน error → null ไม่ระเบิด", async () => {
    const f = fakeMp4({ seconds: 30 });
    expect(await mp4DurationSeconds(async () => Promise.reject(new Error("net")), f.length)).toBeNull();
  });
});

describe("ช่วงวิดีโอ", () => {
  it("ช่วงละ 10 วินาที ปัดขึ้น · อย่างน้อย 1 ช่วง", () => {
    expect(videoSegmentCount(0.4)).toBe(1);
    expect(videoSegmentCount(10)).toBe(1);
    expect(videoSegmentCount(10.1)).toBe(2);
    expect(videoSegmentCount(125.5)).toBe(13);
  });

  it("ต้องเล่นผ่าน 80% ของช่วง · ช่วงสุดท้ายที่สั้นกว่าใช้ความยาวจริง", () => {
    expect(segmentWatchTarget(1, 125.5)).toBe(8);
    expect(segmentWatchTarget(13, 125.5)).toBeCloseTo(4.4);
  });

  it("ช่วงใหม่ต่อ heartbeat ไม่เกินที่เล่นทันที่ 2 เท่า", () => {
    expect(maxNewSegments(0)).toBe(1);
    expect(maxNewSegments(15)).toBe(4);
    expect(maxNewSegments(30)).toBe(7);
  });

  it("ขนาดไฟล์ · Pricelist ไม่รับวิดีโอ · รูปแบบเวลา", () => {
    expect(maxBytesFor("video/mp4")).toBe(2_000_000_000);
    expect(maxBytesFor("application/pdf")).toBe(30 * 1024 * 1024);
    expect(kindAllowsMime("pricelist", "video/mp4")).toBe(false);
    expect(kindAllowsMime("catalog", "video/mp4")).toBe(true);
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3725)).toBe("1:02:05");
  });
});

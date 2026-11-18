#!/usr/bin/env node
/**
 * ด่าน audit ของ `npm run ci` — แทน `npm audit --audit-level=high` ตรง ๆ (ADR-0023)
 *
 * advisory ระดับ high / critical = ไม่ผ่าน · ยกเว้นตัวที่อยู่ใน `scripts/audit-allowlist.json` และยังไม่เลย `reviewBy`
 * ★ ยกเว้นได้เฉพาะ advisory ที่ยังไม่มีเวอร์ชันที่แก้แล้ว และใช้โจมตีโปรเจกต์นี้ไม่ได้ — เขียนเหตุผลไว้ในไฟล์ทุกครั้ง
 * ★ เลยวันทบทวน = ไม่ผ่าน ให้กลับไปดูว่ามี patch หรือยัง (มีแล้วอัปเกรดแล้วลบออกจากไฟล์ · ยังไม่มีเลื่อนวันพร้อมเหตุผล)
 * ★ ตัวที่ยกเว้นไว้แต่ไม่เจอแล้ว = เตือนให้ลบออก (ไม่ทำให้ไม่ผ่าน)
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BLOCKING = new Set(["high", "critical"]);
// วันนี้ตามเวลาไทย (YYYY-MM-DD) — เทียบกับ reviewBy แบบสตริงได้ตรง ๆ
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

const allow = JSON.parse(readFileSync(new URL("./audit-allowlist.json", import.meta.url), "utf8"));
const r = spawnSync("npm audit --json", { shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
let report;
try {
  report = JSON.parse(r.stdout);
} catch {
  console.error("อ่านผล npm audit --json ไม่ได้");
  console.error((r.stdout || r.stderr || "").slice(0, 2000));
  process.exit(1);
}
if (report.error) {
  console.error(`npm audit ล้ม: ${report.error.summary ?? JSON.stringify(report.error)}`);
  process.exit(1);
}

/** advisory ทั้งหมด (ไม่ซ้ำ) — `via` ที่เป็น object คือ advisory จริง · ที่เป็นสตริงคือแพ็กเกจที่ติดต่อมา */
const advisories = new Map();
for (const v of Object.values(report.vulnerabilities ?? {})) {
  for (const x of v.via) {
    if (typeof x !== "object" || !x.url) continue;
    const id = x.url.split("/").pop();
    if (!advisories.has(id)) advisories.set(id, { id, name: x.name, severity: x.severity, title: x.title, range: x.range, via: new Set() });
    advisories.get(id).via.add(v.name);
  }
}

const allowed = new Map(allow.map((a) => [a.id, a]));
const blocking = [];
const skipped = [];
for (const a of advisories.values()) {
  if (!BLOCKING.has(a.severity)) continue;
  const entry = allowed.get(a.id);
  if (entry && entry.reviewBy >= today) skipped.push({ ...a, entry });
  else blocking.push({ ...a, expired: entry ? entry.reviewBy : null });
}
const stale = allow.filter((a) => !advisories.has(a.id));

const counts = report.metadata?.vulnerabilities ?? {};
console.log(`npm audit: ${["critical", "high", "moderate", "low"].map((s) => `${s} ${counts[s] ?? 0}`).join(" · ")}`);
for (const s of skipped) console.log(`  ยกเว้น ${s.id} (${s.name} ${s.range} · ${s.severity}) ถึง ${s.entry.reviewBy} — ${s.entry.reason}`);
for (const s of stale) console.log(`  ⚠ ${s.id} (${s.package}) ไม่เจอใน npm audit แล้ว — ลบออกจาก scripts/audit-allowlist.json`);
for (const b of blocking) {
  console.log(
    `  ✗ ${b.id} ${b.name} ${b.range} · ${b.severity} — ${b.title}` +
      ` (ผ่าน ${[...b.via].join(", ")})${b.expired ? ` · เลยวันทบทวน ${b.expired} แล้ว` : ""}`,
  );
}
if (blocking.length) {
  console.log(`\nไม่ผ่าน: advisory ระดับ high ขึ้นไป ${blocking.length} ตัว — อัปเกรด หรือถ้ายังไม่มี patch และใช้โจมตีที่นี่ไม่ได้ ใส่ใน scripts/audit-allowlist.json พร้อมเหตุผล`);
  process.exit(1);
}
console.log(`ผ่าน — ไม่มี advisory ระดับ high ขึ้นไปที่ไม่ได้ยกเว้น${skipped.length ? ` (ยกเว้น ${skipped.length})` : ""}`);

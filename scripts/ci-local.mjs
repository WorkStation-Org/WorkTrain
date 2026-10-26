#!/usr/bin/env node
/**
 * `npm run ci` — ตรวจแทน GitHub Actions บนเครื่อง (เจ้าของตัดสิน 3 ต.ค. 2569: ไม่พึ่ง Actions ของ org)
 *
 * รันทุกขั้นเดียวกับ `.github/workflows/ci.yml` + เช็กว่า schema ไม่มี migration ค้าง แล้วพิมพ์ตารางผล
 * ไว้วางใน PR · ล้มขั้นไหน exit 1 (รันต่อจนครบเพื่อให้เห็นทุกอย่างในรอบเดียว)
 *
 * `npm run ci -- --fresh` = เริ่มด้วย `npm ci` (ติดตั้งจาก lockfile ใหม่ทั้งหมด — แบบเดียวกับเครื่อง CI/Vercel · ข้อ 13)
 */
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

const fresh = process.argv.includes("--fresh");
const want = readFileSync(".nvmrc", "utf8").trim();
const have = process.versions.node.split(".")[0];

const steps = [
  ...(fresh ? [{ name: "npm ci", cmd: "npm ci --no-audit --no-fund" }] : []),
  { name: "typecheck", cmd: "npm run typecheck" },
  { name: "test", cmd: "npm test", pick: /Tests\s+(.+)/ },
  // ไม่ใส่ env ตอน build — ทุกหน้าเป็น dynamic ไม่แตะ DB ตอน build (เหมือนใน ci.yml)
  { name: "build (ไม่มี env)", cmd: "npm run build", env: { DATABASE_URL: "", SESSION_SECRET: "" } },
  { name: "audit --audit-level=high", cmd: "npm audit --audit-level=high" },
  // generate ที่ได้ไฟล์ใหม่ = schema.ts เปลี่ยนแต่ยังไม่มี migration
  { name: "migration ตรงกับ schema", cmd: "npx drizzle-kit generate", expect: /No schema changes/ },
];

const results = [];
if (have !== want) results.push({ name: `node ${want} (.nvmrc)`, ok: false, note: `เครื่องนี้ node ${process.versions.node}` });

for (const s of steps) {
  process.stdout.write(`▶ ${s.name} … `);
  const r = spawnSync(s.cmd, { shell: true, encoding: "utf8", env: { ...process.env, ...(s.env ?? {}) } });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.replace(/\x1b\[[0-9;]*m/g, "");
  const ok = r.status === 0 && (!s.expect || s.expect.test(out));
  const note = s.pick ? (out.match(s.pick)?.[1] ?? "").trim() : s.expect && !ok && r.status === 0 ? "มี migration ใหม่ที่ยังไม่ได้ commit" : "";
  results.push({ name: s.name, ok, note });
  console.log(ok ? "✅" : "❌");
  if (!ok) console.log(out.split("\n").slice(-25).join("\n"));
}
rmSync(".next", { recursive: true, force: true });

const sha = spawnSync("git rev-parse --short HEAD", { shell: true, encoding: "utf8" }).stdout.trim();
const dirty = spawnSync("git status --porcelain", { shell: true, encoding: "utf8" }).stdout.trim() !== "";
console.log(`\nผลตรวจบนเครื่อง — \`${sha}\`${dirty ? " (+ งานที่ยังไม่ commit)" : ""} · node ${process.versions.node}\n`);
console.log("| ขั้น | ผล |\n|---|---|");
for (const r of results) console.log(`| \`${r.name}\` | ${r.ok ? "✅" : "❌"}${r.note ? ` ${r.note}` : ""} |`);
process.exit(results.every((r) => r.ok) ? 0 : 1);

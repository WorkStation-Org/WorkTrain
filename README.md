# WorkTrain

ระบบเรียนรู้ด้วยตัวเองของเครือ Work Station — ผู้สร้าง (PD · Sales Manager ฯลฯ) ส่งเอกสาร → AI ออกข้อสอบ 5 ชุด →
ผู้อนุมัติตรวจ → ส่งให้คนตามผังองค์กร → ผู้เรียนอ่านแล้วสอบ (ผ่าน 80%) → TG ติดตามและดูสถิติ

> **สถานะ (5 พ.ย. 2569):** เขียนใหม่ทั้งหมดตาม [ADR-0001](docs/adr/0001-rewrite-on-drizzle-in-same-repo.md) ·
> โค้ดของ spec รุ่นที่ 1 ครบแล้ว — ผู้สร้าง → AI ออกข้อสอบ → อนุมัติ · มอบงาน + เตือน LINE · หน้าผู้เรียน (ยินยอม → สแกน → อ่าน → สอบ) ·
> สแกนใบหน้า (Rekognition · `ap-southeast-7`) · เส้นทาง Onboarding + API ให้ WorkHR · Dashboard + Leaderboard ·
> เวอร์ชันใหม่ของเอกสาร · Pricelist พร้อมลายน้ำ
>
> **ยังไม่ deploy** — ยังไม่มี Neon · app key `worktrain` ที่ WorkID · consumer key ของ WorkGateWay/WorkID ·
> branch `production` ยังเป็นแอป Prisma ตัวเก่า · เรื่องที่รอคนอื่น (PDPA ใบหน้า · `positionId` · ตัวอย่าง Pricelist) ดู [spec §14](docs/spec-release-1.md)

## เอกสาร

| | |
|---|---|
| [CONTEXT.md](CONTEXT.md) | อภิธานศัพท์ — ชุดการเรียนรู้ · ชุดข้อสอบ · ครั้งที่สอบ · รอบเรียน · การสแกน ฯลฯ |
| [docs/spec-release-1.md](docs/spec-release-1.md) | spec รุ่นที่ 1 · เรื่องที่ยังรอ (§14) |
| [docs/adr/](docs/adr/) | การตัดสินใจที่ถอยยาก |
| [AGENTS.md](AGENTS.md) | กติกาของ repo · แผนที่โค้ด |

## Stack

Next.js 16 + Drizzle + Neon (Singapore) · vitest + PGlite · Node 24 — เหมือน WorkHR / WorkDaily
โครงล็อกอิน · session · proxy · health · ตัวเรียก WorkID/GateWay ยกมาจาก WorkDaily (ซึ่งยกมาจาก WorkDecision)

## รันบนเครื่อง

```sh
npm install                 # ตั้ง core.hooksPath ให้เองผ่าน script prepare (กัน push เข้า main ตรง)
cp .env.example .env.local  # DATABASE_URL=pglite:.pglite ใช้ได้เลยไม่ต้องมี Neon
npm run db:dev-setup        # รัน migration ลง PGlite ครั้งแรก
npm run dev                 # http://localhost:3000
```

ไม่มี SSO บนเครื่อง ใช้ทางลัด `WORKTRAIN_DEV_ACTOR="1:a@b.c:ชื่อ:admin"` (ตายเองบน Vercel ทุก environment)

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | vitest ทั้งชุด — รวม migration + CHECK + trigger บน PGlite |
| `npm run build` | build production — ไม่ต้องมี env |
| `npm run db:generate` | สร้าง migration จาก `src/db/schema.ts` — แก้ schema แล้วต้องรันและ commit `drizzle/` |
| `npm run ci` | ทุกขั้นของ CI บนเครื่อง (typecheck · test · build · audit · migration ตรง schema) — ต้องเขียวก่อน merge |

## Deploy

`vercel.json` รัน `scripts/migrate-on-deploy.mjs` ก่อน build ของ production — migration ล้ม = build ล้ม

# ADR-0023 — ยกเว้น advisory ที่ยังไม่มี patch ในด่าน audit

วันที่ 18 พฤศจิกายน 2569 · สถานะ: ใช้อยู่

`npm run ci` ไม่ผ่านที่ `npm audit --audit-level=high` เพราะ picomatch ReDoS (GHSA-fc5q-39xc-vjpf · ≤ 4.0.7)
ซึ่ง**ยังไม่มีเวอร์ชันที่แก้แล้วเลย** (first_patched_version = null) — อัปเกรดอะไรก็ไม่หาย
ที่ npm แนะนำ (vitest 3.1.4) ก็ยังดึง picomatch 4 ผ่าน tinyglobby
ในโปรเจกต์นี้ picomatch มาแค่ผ่าน vitest / vite (เครื่องมือทดสอบ ไม่ขึ้น production) และ glob มาจาก config ของเราเอง จึงใช้โจมตีไม่ได้

**ตัดสินว่า**
- ด่าน audit ใช้ `scripts/audit-check.mjs` แทน `npm audit --audit-level=high` ตรง ๆ — advisory ระดับ high / critical ยังไม่ผ่านเหมือนเดิม
  ยกเว้นตัวที่อยู่ใน `scripts/audit-allowlist.json` (id · package · เหตุผล · วันที่เพิ่ม · `reviewBy`)
- เลย `reviewBy` = ไม่ผ่านอีก ให้กลับไปดูว่ามี patch หรือยัง — มีแล้วอัปเกรดแล้วลบออก · ยังไม่มีเลื่อนวันพร้อมเหตุผล
- ตัวที่ยกเว้นไว้แต่ไม่เจอแล้ว = เตือนให้ลบ (ไม่ทำให้ไม่ผ่าน)
- ยกเว้นได้เฉพาะ advisory ที่**ยังไม่มี patch และใช้โจมตีที่นี่ไม่ได้** — มี patch แล้วต้องอัปเกรด
- ตัวแรก: GHSA-fc5q-39xc-vjpf ทบทวนภายใน 31 มกราคม 2570

## ไม่เลือก

- **ตรวจเฉพาะของที่ขึ้น production (`--omit=dev`)** — ง่ายกว่า แต่ advisory ของเครื่องมือ dev ทุกตัวหลุดจากด่านไปตลอด
- **ลด vitest ตามที่ npm แนะนำ** — ไม่หาย (ยังได้ picomatch 4) และถอยเครื่องมือทดสอบลง major
- **รอ patch** — CI แดงไปเรื่อย ๆ โดยไม่มีกำหนด ด่าน audit จะไม่มีความหมาย (ทุกคนชินกับสีแดง)

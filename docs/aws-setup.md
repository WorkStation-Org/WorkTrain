# ตั้ง AWS สำหรับสแกนใบหน้า (ADR-0006)

เครือยังไม่มีบัญชี AWS (ยืนยัน 26 ต.ค. 2569) — เอกสารนี้คือขั้นตอนตั้งแต่เปิดบัญชีจนใส่ค่าใน Vercel
**ขั้น 1 ต้องทำเองโดยคนที่ถือบัตรของบริษัท** · ขั้น 2–6 ทำตามได้ใน AWS Console (copy policy จากที่นี่)

## เลือก region: Tokyo (`ap-northeast-1`)

FAQ ของ AWS ระบุ Face Liveness ไว้ 5 region: N. Virginia · Oregon · Ireland · **Tokyo** · Mumbai — **ไม่มี Singapore**
(ตรวจ 26 ต.ค. 2569 — Rekognition มี endpoint ที่ Singapore แต่ไม่ได้บอกว่ามี Face Liveness)
Tokyo ใกล้ที่สุด · ภาพใบหน้าจึงถูกส่งไปประมวลผลที่ญี่ปุ่น — **ต้องเขียนลงข้อความยินยอม** (กติกาเครือข้อ 7 · spec §8)
ถ้าวันหน้า Singapore มี Face Liveness ย้ายได้ด้วยการเปลี่ยน `AWS_REKOGNITION_REGION` ค่าเดียว

ทุกขั้นข้างล่างให้เลือก region **Asia Pacific (Tokyo)** ที่มุมขวาบนของ Console ก่อน (IAM เป็น global ไม่ต้องเลือก)

## 1. เปิดบัญชี (คนที่ถือบัตรบริษัททำเอง)

1. สมัครที่ https://aws.amazon.com/ ด้วยอีเมลกลางของบริษัท (ไม่ใช่อีเมลส่วนตัว) — ต้องใช้บัตรเครดิตและยืนยันเบอร์โทร
2. เปิด **MFA ของ root user** ทันที แล้วเลิกใช้ root ในงานประจำวัน
3. ตั้ง **AWS Budgets** แจ้งเตือนที่ $20/เดือน (ค่าใช้จ่ายที่คาดไว้ ≈ 330 บาท/เดือนที่ 60 คน · spec §15) — ถ้าเกินจะรู้ทันที

## 2. policy ของเซิร์ฟเวอร์

IAM → Policies → Create policy → JSON → ตั้งชื่อ `worktrain-server-rekognition`
(แทน `<ACCOUNT_ID>` ด้วยเลขบัญชี 12 หลัก)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LivenessAndCompare",
      "Effect": "Allow",
      "Action": ["rekognition:CreateFaceLivenessSession", "rekognition:GetFaceLivenessSessionResults", "rekognition:CompareFaces"],
      "Resource": "*"
    },
    {
      "Sid": "VendBrowserCredentials",
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::<ACCOUNT_ID>:role/worktrain-liveness-browser"
    }
  ]
}
```

## 3. user ของเซิร์ฟเวอร์

IAM → Users → Create user → ชื่อ `worktrain-server` · **ไม่ต้องให้เข้า Console** · แนบ policy `worktrain-server-rekognition`

## 4. role ที่เบราว์เซอร์ใช้

เบราว์เซอร์ต้องเปิดสตรีมวิดีโอไปที่ Rekognition เอง — เซิร์ฟเวอร์ออก credential ชั่วคราว 15 นาทีจาก role นี้
และตอนออกยังบีบสิทธิ์ซ้ำอีกชั้นให้ทำได้แค่ `StartFaceLivenessSession` (`src/lib/rekognition.ts`)

IAM → Roles → Create role → **Custom trust policy**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::<ACCOUNT_ID>:user/worktrain-server" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

แล้วเพิ่ม inline policy ชื่อ `start-liveness-only`:

```json
{
  "Version": "2012-10-17",
  "Statement": [{ "Effect": "Allow", "Action": "rekognition:StartFaceLivenessSession", "Resource": "*" }]
}
```

ตั้งชื่อ role ว่า `worktrain-liveness-browser` · คัด **Role ARN** ไว้

## 5. access key ของเซิร์ฟเวอร์

IAM → Users → `worktrain-server` → Security credentials → Create access key → เลือก "Application running outside AWS"
คัด Access key ID + Secret access key **ครั้งเดียว** (ปิดหน้าแล้วดูซ้ำไม่ได้) · ห้ามส่งในแชต/LINE

## 6. ใส่ค่าใน Vercel (โปรเจกต์ WorkTrain · Production เท่านั้น · ชนิด Sensitive)

| ตัวแปร | ค่า |
|---|---|
| `AWS_REKOGNITION_REGION` | `ap-northeast-1` |
| `AWS_ACCESS_KEY_ID` | จากขั้น 5 |
| `AWS_SECRET_ACCESS_KEY` | จากขั้น 5 |
| `AWS_LIVENESS_ROLE_ARN` | จากขั้น 4 |

Preview ไม่ต้องใส่ — preview จะเป็น `scanMode() = off` (เรียน/สอบไม่ได้) ซึ่งตั้งใจไว้

## ตรวจหลังตั้ง

1. เปิด `/enroll` บนมือถือ → ต้องขึ้นกล้องพร้อมวงรีให้ขยับหน้า (ไม่ใช่ปุ่ม "dev — ข้ามกล้อง" และไม่ใช่ "ยังไม่ได้ตั้งระบบสแกน")
2. ลงทะเบียน → สแกนเริ่มเรียน → ต้องผ่าน · ลองให้อีกคนสแกนแทน → ต้องไม่ผ่าน
3. FaceLivenessDetector โหลดโมเดลหน้าและ wasm จาก `cdn.jsdelivr.net` และ `tfhub.dev` — ถ้าเครือข่ายบริษัทบล็อก ต้อง host เอง (`config.binaryPath` · `faceModelUrl`)

## ความลับ

- ไม่มี key ของ AWS ใน repo · `.env.local` อยู่ใน `.gitignore`
- หมุน access key ของ `worktrain-server` ทุก 90 วัน (IAM แสดงอายุ key ให้เห็น)

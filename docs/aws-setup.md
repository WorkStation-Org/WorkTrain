# ตั้ง AWS สำหรับสแกนใบหน้า (ADR-0006)

## สถานะ (31 ต.ค. 2569)

- **ตั้งครบแล้ว 31 ต.ค. 2569:** ข้อ 2 · 4 · 5 · 6 · 7–11 (Budget `worktrain-monthly-20usd` แจ้ง it.workstationoffice@gmail.com ที่ 80%/100%/คาดการณ์ 100% · Vercel โปรเจกต์ `wso-knowledge` · ตรวจด้วย CLI: liveness ใน Thailand ได้ · Sydney ถูกปฏิเสธ · role ของเบราว์เซอร์สร้าง session เองไม่ได้)
- **1 พ.ย. 2569:** ข้อ 3 เสร็จ — เจ้าของตั้งรหัสผ่านและ MFA ของ root บัญชีหลัก `168629931180` แล้ว · เหลือตรวจบนมือถือหลัง deploy

### ประวัติ (26 ต.ค. 2569)

- เครือเปิดบัญชีด้วย **Sign up for AWS (new)** ผ่าน Gmail แล้ว — project region = **Sydney (`ap-southeast-2`)** · account `468683594627` (ชื่อ `WorkTrain` — เดิม AWS ตั้งให้ว่า "Golden Hour Code")
- AWS CLI ตั้ง profile `workstation` แล้ว (`aws login` · credential 12 ชม. ต่ออายุได้ 90 วัน)
- **ปัญหา:** บัญชีแบบ new สร้างของได้แค่ region ของ project และ **Sydney ไม่มี Face Liveness**
- **ตัดสินแล้ว:** activate advanced AWS features แล้วใช้ **Thailand (`ap-southeast-7`)** — ภาพใบหน้าไม่ออกนอกประเทศไทย (ดีที่สุดสำหรับ PDPA)
  ข่าว AWS ก.ย. 2569 ระบุ Face Liveness มีที่ Thailand · Malaysia · Tokyo · Mumbai · N. Virginia · Oregon · Ireland · São Paulo

## ส่วนที่ 1 — เจ้าของบัญชีทำใน AWS Settings / Console (ทำเอง)

### 1. อัปเกรดเป็น Paid Plan
https://settings.aws.com → อัปเกรดบัญชี (ต้องทำก่อน activate) · ใส่บัตรบริษัท

### 2. Activate advanced features — **ย้อนกลับไม่ได้**
1. https://settings.aws.com → **Projects** → **Actions** → **Explore advanced features**
2. **Team name:** เช่น `Work Station`
3. **Management account email:** อีเมลกลางของบริษัท (ไม่ใช่อีเมลส่วนตัว) → ยืนยันอีเมล
4. **Review and complete activation** → **activate**

ผลที่ตามมา: spend limit ถูกลบ (ใช้ AWS Budgets แทน) · Console มีตัวเลือก Region และบริการครบ ·
project เดิมกลายเป็น member account ในองค์กร · AWS สร้าง account "Identity Delegated Admin" เพิ่มให้เอง

### 3. ตั้ง root password ของ management account + เปิด MFA
ตามลิงก์ที่ AWS ส่งมา · ใช้ root เฉพาะเหตุฉุกเฉิน

### 4. ตั้ง AWS Budgets แจ้งเตือน $20/เดือน
Billing and Cost Management → Budgets (แทน spend limit ที่หายไป · ค่าที่คาด ≈ 330 บาท/เดือนที่ 60 คน · spec §15)

### 5. เพิ่ม Thailand ใน SCP `RegionFloor`
Organizations console (management account) → Policies → Service control policies → policy ที่ AWS ตั้งให้ project →
แก้ statement **`RegionFloor`** ให้รวม `ap-southeast-7` ด้วย (ไม่แก้ส่วนอื่น)

### 6. เปิด Region Thailand ให้ project account
Organizations console → **AWS accounts** → เลือก project account `WorkTrain` (`468683594627`) → **Account settings** → **Regions** →
`Asia Pacific (Thailand) ap-southeast-7` → **Actions → Enable** — ใช้เวลาไม่กี่นาทีถึงหลายชั่วโมง

> ทำเสร็จข้อ 6 แล้วบอก Claude — จะตรวจด้วย CLI ว่า region เปิดแล้ว และเรียก Face Liveness ใน Thailand ได้จริง
> (`aws account get-region-opt-status` · สร้าง liveness session ทดลอง 1 ครั้ง) ก่อนทำส่วนที่ 2

## ส่วนที่ 2 — สิทธิ์ของ WorkTrain (ทำใน project account · Claude ช่วยได้ผ่าน CLI หลังผู้ตัดสินอนุมัติ)

ทุกคำสั่ง/หน้า Console ข้างล่างอยู่ใน project account `468683594627` (IAM เป็น global)

### 7. policy ของเซิร์ฟเวอร์ `worktrain-server-rekognition`

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LivenessAndCompare",
      "Effect": "Allow",
      "Action": ["rekognition:CreateFaceLivenessSession", "rekognition:GetFaceLivenessSessionResults", "rekognition:CompareFaces"],
      "Resource": "*",
      "Condition": { "StringEquals": { "aws:RequestedRegion": "ap-southeast-7" } }
    },
    {
      "Sid": "VendBrowserCredentials",
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::468683594627:role/worktrain-liveness-browser"
    }
  ]
}
```

`aws:RequestedRegion` บังคับให้ภาพใบหน้าถูกส่งไป Thailand เท่านั้น แม้ตั้ง env ผิด

### 8. user ของเซิร์ฟเวอร์ `worktrain-server`
ไม่ให้เข้า Console · แนบ policy ข้อ 7

### 9. role ที่เบราว์เซอร์ใช้ `worktrain-liveness-browser`

trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Principal": { "AWS": "arn:aws:iam::468683594627:user/worktrain-server" }, "Action": "sts:AssumeRole" }
  ]
}
```

inline policy `start-liveness-only`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "rekognition:StartFaceLivenessSession",
      "Resource": "*",
      "Condition": { "StringEquals": { "aws:RequestedRegion": "ap-southeast-7" } }
    }
  ]
}
```

เซิร์ฟเวอร์บีบสิทธิ์ซ้ำอีกชั้นตอนออก credential 15 นาที (`src/lib/rekognition.ts`)

⚠ Thailand เป็น opt-in region — token จาก STS global endpoint ใช้ที่นี่ไม่ได้ (`UnrecognizedClientException`) ·
ต้อง AssumeRole ผ่าน STS ของ `ap-southeast-7` · โค้ดทำอยู่แล้ว (`new STSClient({ region })`) · ทดสอบด้วย CLI ให้ใส่ `--region ap-southeast-7`

### 10. access key ของ `worktrain-server`
"Application running outside AWS" · คัดครั้งเดียว · **ห้ามส่งในแชต/LINE** · หมุนทุก 90 วัน

### 11. ค่าใน Vercel (โปรเจกต์ WorkTrain · Production เท่านั้น · Sensitive)

| ตัวแปร | ค่า |
|---|---|
| `AWS_REKOGNITION_REGION` | `ap-southeast-7` |
| `AWS_ACCESS_KEY_ID` | จากข้อ 10 |
| `AWS_SECRET_ACCESS_KEY` | จากข้อ 10 |
| `AWS_LIVENESS_ROLE_ARN` | `arn:aws:iam::468683594627:role/worktrain-liveness-browser` |

Preview ไม่ต้องใส่ — preview เป็น `scanMode() = off` (เรียน/สอบไม่ได้) ซึ่งตั้งใจไว้

## ตรวจหลังตั้ง

1. เปิด `/enroll` บนมือถือ → ต้องขึ้นกล้องพร้อมวงรีให้ขยับหน้า
2. ลงทะเบียน → สแกนเริ่มเรียน → ต้องผ่าน · ให้อีกคนสแกนแทน → ต้องไม่ผ่าน
3. FaceLivenessDetector โหลดโมเดลหน้าและ wasm จาก `cdn.jsdelivr.net` และ `tfhub.dev` — ถ้าเครือข่ายบริษัทบล็อก ต้อง host เอง

## หมายเหตุสำหรับ AI agent

หลัง activate แล้ว AWS แนะนำให้เลิกใช้ `aws-starter-rules.md` (กฎของบัญชีแบบ new) — `CLAUDE.md` ต้องเปลี่ยนเป็น
`aws-agent-rules.md` (กฎของบัญชีแบบ advanced) ระหว่าง marker `BEGIN/END AWS Agent Toolkit rules`

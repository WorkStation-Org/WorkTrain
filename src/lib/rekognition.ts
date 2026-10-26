import { CompareFacesCommand, CreateFaceLivenessSessionCommand, GetFaceLivenessSessionResultsCommand, RekognitionClient } from "@aws-sdk/client-rekognition";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";

/**
 * AWS Rekognition (ADR-0006) — **ที่เดียวที่คุยกับ AWS** · โค้ดอื่นคุยกับ `FaceApi` · เทสต์แทนด้วยตัวปลอมที่ขอบนี้
 *
 * เส้นทางของการสแกนหนึ่งครั้ง:
 *   1. เซิร์ฟเวอร์ `createLivenessSession()` → sessionId
 *   2. เบราว์เซอร์รัน FaceLivenessDetector ด้วย credential ชั่วคราวจาก `browserCredentials()` (ทำได้แค่ StartFaceLivenessSession)
 *   3. เซิร์ฟเวอร์ `livenessResult()` → ความมั่นใจว่าเป็นคนจริง + ภาพอ้างอิง (bytes — ไม่ให้ AWS เก็บลง S3)
 *   4. เซิร์ฟเวอร์ `compareFaces()` ภาพอ้างอิงกับใบหน้าที่ลงทะเบียน — **เทียบฝั่งเซิร์ฟเวอร์ ผลแก้จากเบราว์เซอร์ไม่ได้**
 *
 * ★ region ต้องเป็นที่ที่มี Face Liveness — ตรวจก่อนเปิดใช้ (spec §14 · กติกาเครือข้อ 7)
 */

export interface LivenessResult {
  /** SUCCEEDED · FAILED · EXPIRED · IN_PROGRESS · CREATED */
  status: string;
  /** 0–100 ความมั่นใจว่าเป็นคนจริงต่อหน้ากล้อง · null = ไม่ได้ผล */
  confidence: number | null;
  referenceImage: Uint8Array | null;
}

export interface BrowserCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
}

export interface FaceApi {
  region: string;
  createLivenessSession(): Promise<string>;
  livenessResult(sessionId: string): Promise<LivenessResult>;
  /** ความเหมือนสูงสุด 0–100 · null = ไม่เจอใบหน้าที่ตรงกันเลย */
  compareFaces(enrolled: Uint8Array, probe: Uint8Array): Promise<number | null>;
  browserCredentials(): Promise<BrowserCredentials>;
}

/** ความมั่นใจขั้นต่ำว่าเป็นคนจริง — AWS แนะนำให้ตั้งตามความเสี่ยงของงาน · ยืนยันตัวตนสอบใช้ค่าสูง */
export const LIVENESS_MIN_CONFIDENCE = 80;
/** ความเหมือนขั้นต่ำว่าเป็นคนเดียวกับที่ลงทะเบียน */
export const MATCH_MIN_SIMILARITY = 90;

const env = (name: string) => process.env[name]?.trim() ?? "";

export function rekognitionConfigured(): boolean {
  return Boolean(env("AWS_REKOGNITION_REGION") && env("AWS_ACCESS_KEY_ID") && env("AWS_SECRET_ACCESS_KEY") && env("AWS_LIVENESS_ROLE_ARN"));
}

/** สิทธิ์ของ credential ที่ส่งให้เบราว์เซอร์ — เปิดสตรีม liveness ได้อย่างเดียว */
const BROWSER_POLICY = JSON.stringify({
  Version: "2012-10-17",
  Statement: [{ Effect: "Allow", Action: "rekognition:StartFaceLivenessSession", Resource: "*" }],
});

export function awsFaceApi(): FaceApi | null {
  if (!rekognitionConfigured()) return null;
  const region = env("AWS_REKOGNITION_REGION");
  const credentials = { accessKeyId: env("AWS_ACCESS_KEY_ID"), secretAccessKey: env("AWS_SECRET_ACCESS_KEY") };
  const rek = new RekognitionClient({ region, credentials });
  const sts = new STSClient({ region, credentials });

  return {
    region,
    async createLivenessSession() {
      const out = await rek.send(new CreateFaceLivenessSessionCommand({ Settings: { AuditImagesLimit: 0 } }));
      if (!out.SessionId) throw new Error("Rekognition ไม่ได้ส่ง SessionId กลับมา");
      return out.SessionId;
    },
    async livenessResult(sessionId) {
      const out = await rek.send(new GetFaceLivenessSessionResultsCommand({ SessionId: sessionId }));
      return {
        status: out.Status ?? "UNKNOWN",
        confidence: typeof out.Confidence === "number" ? out.Confidence : null,
        referenceImage: out.ReferenceImage?.Bytes ?? null,
      };
    },
    async compareFaces(enrolled, probe) {
      const out = await rek.send(
        new CompareFacesCommand({ SourceImage: { Bytes: enrolled }, TargetImage: { Bytes: probe }, SimilarityThreshold: 0 }),
      );
      const best = Math.max(...(out.FaceMatches ?? []).map((m) => m.Similarity ?? 0), -1);
      return best < 0 ? null : best;
    },
    async browserCredentials() {
      const out = await sts.send(
        new AssumeRoleCommand({
          RoleArn: env("AWS_LIVENESS_ROLE_ARN"),
          RoleSessionName: "worktrain-liveness",
          DurationSeconds: 900,
          Policy: BROWSER_POLICY,
        }),
      );
      const c = out.Credentials;
      if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken || !c.Expiration) throw new Error("STS ไม่ได้ส่ง credential กลับมา");
      return { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken, expiration: c.Expiration };
    },
  };
}

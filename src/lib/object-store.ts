import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { devShortcutAllowed } from "@/lib/dev";

/**
 * ที่เก็บเอกสารต้นทางและภาพสแกน (ADR-0010) — **จุดเดียวที่แตะ bucket** · โค้ดอื่นคุยกับ `ObjectStore` ไม่ใช่ SDK ตรง
 * เทสต์แทนด้วย store ปลอมที่ขอบนี้ได้ และวันที่ย้าย provider มีไฟล์เดียวที่เปลี่ยน
 * (ยกมาจาก WorkDecision `src/lib/object-store.ts` ← WorkIT `src/lib/r2.ts` ที่ใช้งานจริงอยู่แล้ว)
 *
 * ★ ข้อเท็จจริงของ R2 ที่โค้ดนี้พึ่ง (WorkIT docs/research/r2-presigned-upload.md):
 *   - `getSignedUrl` **ไม่เซ็น Content-Type โดย default** — ต้องส่ง `signableHeaders` เอง
 *   - R2 ไม่มี presigned POST (ไม่มี content-length-range) → ยืนยันขนาดด้วย HEAD หลังอัปเสมอ
 * ★ bucket ต้อง private · ลิงก์เปิดไฟล์อายุสั้นและ **ไม่เก็บไว้ที่ไหน** (กติกาเครือ — ห้าม persist presign)
 */
export interface ObjectStore {
  /** URL สำหรับ `PUT` ตรงจากเบราว์เซอร์ — client ต้องส่ง Content-Type ตรงตัว */
  presignPut(input: { key: string; contentType: string; contentLength: number }): Promise<string>;
  /** `null` = ไม่มี object (ยังไม่อัป / อัปล้ม) */
  head(key: string): Promise<{ size: number } | null>;
  /** copy ฝั่งเซิร์ฟเวอร์ภายใน bucket พร้อมตั้ง Content-Type ใหม่ */
  copy(fromKey: string, toKey: string, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** อ่านไฟล์ทั้งก้อนฝั่งเซิร์ฟเวอร์ (ส่งเอกสารให้ AI ออกข้อสอบ) · `null` = ไม่มี object */
  get(key: string): Promise<Uint8Array | null>;
  /** เขียนจากฝั่งเซิร์ฟเวอร์ (ภาพสแกนที่ได้จาก Rekognition) */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** ลิงก์เปิดไฟล์อายุสั้น — ส่งให้คนที่ผ่านการตรวจสิทธิ์แล้วเท่านั้น */
  presignGet(input: { key: string; contentType: string; disposition: string }): Promise<string>;
}

/** อายุลิงก์อัป — ไฟล์ใหญ่บนมือถือใช้เวลานาน 15 นาทีแบบ WorkIT ไม่พอ */
export const UPLOAD_TTL_SECONDS = 60 * 60;
/** อายุลิงก์เปิดไฟล์ — สั้นพอที่ลิงก์หลุดไปก็ใช้ต่อไม่ได้ (แบบเดียวกับ WorkChat) */
export const DOWNLOAD_TTL_SECONDS = 60;

const env = (name: string) => process.env[name]?.trim() ?? "";

export function r2Configured(): boolean {
  return Boolean(env("R2_ACCOUNT_ID") && env("R2_ACCESS_KEY_ID") && env("R2_SECRET_ACCESS_KEY") && env("R2_BUCKET"));
}

/**
 * ที่เก็บที่ใช้จริงตอนนี้ — R2 ถ้าตั้งครบ · บนเครื่อง dev ที่ยังไม่ตั้ง R2 ใช้โฟลเดอร์ในเครื่อง
 * `null` = ยังไม่ได้ตั้งค่า (production/preview ที่ยังไม่มี env) → route ตอบ 503 บอกตรง ๆ
 */
export function objectStore(): ObjectStore | null {
  if (r2Configured()) return r2Store();
  if (devShortcutAllowed()) return localDevStore();
  return null;
}

// ── R2 ────────────────────────────────────────────────────────────────────

let client: S3Client | null = null;
let clientKey = "";

function s3(): S3Client {
  const accountId = env("R2_ACCOUNT_ID");
  const accessKeyId = env("R2_ACCESS_KEY_ID");
  const secretAccessKey = env("R2_SECRET_ACCESS_KEY");
  const key = `${accountId}|${accessKeyId}`;
  if (!client || clientKey !== key) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
    clientKey = key;
  }
  return client;
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

function r2Store(): ObjectStore {
  const Bucket = env("R2_BUCKET");
  return {
    presignPut({ key, contentType, contentLength }) {
      return getSignedUrl(s3(), new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, ContentLength: contentLength }), {
        expiresIn: UPLOAD_TTL_SECONDS,
        // ★ ไม่มีบรรทัดนี้ = Content-Type ไม่ถูกเซ็น (ดูหัวไฟล์)
        signableHeaders: new Set(["content-type", "content-length"]),
      });
    },
    async head(key) {
      try {
        const r = await s3().send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: Number(r.ContentLength ?? 0) };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    async copy(fromKey, toKey, contentType) {
      await s3().send(
        new CopyObjectCommand({
          Bucket,
          CopySource: `/${Bucket}/${encodeURIComponent(fromKey).replace(/%2F/g, "/")}`,
          Key: toKey,
          ContentType: contentType,
          MetadataDirective: "REPLACE",
        }),
      );
    },
    async delete(key) {
      await s3().send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async put(key, bytes, contentType) {
      await s3().send(new PutObjectCommand({ Bucket, Key: key, Body: bytes, ContentType: contentType }));
    },
    async get(key) {
      try {
        const r = await s3().send(new GetObjectCommand({ Bucket, Key: key }));
        return r.Body ? await r.Body.transformToByteArray() : null;
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    presignGet({ key, contentType, disposition }) {
      return getSignedUrl(
        s3(),
        new GetObjectCommand({ Bucket, Key: key, ResponseContentType: contentType, ResponseContentDisposition: disposition }),
        { expiresIn: DOWNLOAD_TTL_SECONDS },
      );
    },
  };
}

// ── ที่เก็บจำลองบนเครื่อง dev ───────────────────────────────────────────────

/**
 * ที่เก็บจำลอง — **อยู่ในหน่วยความจำของ dev server** (หายเมื่อปิด `next dev`) · ไม่มีทางถูกใช้บน Vercel
 *
 * ★ ไม่เขียนลงดิสก์โดยเจตนา: การอ่านไฟล์จาก path ที่รู้ตอนรันทำให้ Turbopack เหมาเอาทั้งโปรเจกต์ไปใส่
 *   ใน route ตอน build (deploy บวม) · และไม่มี path ก็ไม่มีช่องให้ key แบบ `../` หลุดออกนอกโฟลเดอร์
 * route `/api/dev-store/*` กับตัวนี้ใช้ Map เดียวกันผ่าน `globalThis` (process เดียวกัน)
 */
export function devStoreObjects(): Map<string, Uint8Array> {
  const g = globalThis as { __wtrDevStore?: Map<string, Uint8Array> };
  g.__wtrDevStore ??= new Map();
  return g.__wtrDevStore;
}

function localDevStore(): ObjectStore {
  const objects = devStoreObjects();
  const url = (key: string, q: Record<string, string>) =>
    `/api/dev-store/${key.split("/").map(encodeURIComponent).join("/")}?${new URLSearchParams(q)}`;
  return {
    async presignPut({ key, contentType }) {
      return url(key, { ct: contentType });
    },
    async head(key) {
      const body = objects.get(key);
      return body ? { size: body.byteLength } : null;
    },
    async copy(fromKey, toKey) {
      const body = objects.get(fromKey);
      if (!body) throw new Error(`ไม่มี ${fromKey} ในที่เก็บจำลอง`);
      objects.set(toKey, body);
    },
    async delete(key) {
      objects.delete(key);
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async put(key, bytes) {
      objects.set(key, bytes);
    },
    async presignGet({ key, contentType, disposition }) {
      return url(key, { ct: contentType, cd: disposition });
    },
  };
}

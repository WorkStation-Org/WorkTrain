import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/auth-layout";
import { Alert, buttonClass, Icon } from "@/components/ui";
import { workIdConfigured } from "@/lib/workid";

export const dynamic = "force-dynamic";

/**
 * `/login` — path นี้ถูกตั้งไว้ที่ WorkID `/admin/apps` ช่อง "หน้าล็อกอินของแอป"
 * WorkID เด้งกลับมาที่นี่พร้อม `?loggedout=1` หลังออกจากระบบ
 *
 * ★ กับดักข้อ 2: **ต้องกัน redirect วน**
 *   - มี `?error` → คนที่ไม่มีสิทธิ์จะวนไม่รู้จบ
 *   - มี `?loggedout` → กดออกจากระบบแล้วจะถูกพากลับเข้าไปใหม่ = กดออกไม่ได้เลย
 *   - `?manual=1` เป็นทางหนีไฟ เปิดหน้านี้ตรง ๆ ได้เสมอ
 *
 * ★ หน้านี้ **ไม่มีเมนูข้าง** โดยเจตนา — เป็นหน้าก่อนล็อกอิน ยังไม่มีตัวตนให้แสดง · หน้าตาแบบหน้าเข้าสู่ระบบของ WorkPass
 */
const MESSAGES: Record<string, string> = {
  no_access: "บัญชีนี้ยังไม่ได้รับสิทธิ์เข้า WorkTrain — ติดต่อ TG ให้เพิ่มสิทธิ์ที่ WorkID",
  unknown_person: "ไม่พบชื่อคุณในทะเบียนพนักงานของ WorkID",
  unknown_role: "WorkID ส่ง role ที่ WorkTrain ไม่รู้จักกลับมา — ต้องตั้ง role ของแอป worktrain เป็น admin · author · user",
  state_mismatch: "คำขอล็อกอินไม่ตรงกับเบราว์เซอร์นี้ ลองกดล็อกอินใหม่จากหน้านี้",
  missing_code: "WorkID ไม่ได้ส่งรหัสยืนยันกลับมา ลองใหม่อีกครั้ง",
  used: "ลิงก์ล็อกอินนี้ถูกใช้ไปแล้ว ลองกดล็อกอินใหม่",
  expired: "ลิงก์ล็อกอินหมดอายุ (มีอายุ 2 นาที) ลองกดล็อกอินใหม่",
  wrong_app: "การตั้งค่าฝั่งเซิร์ฟเวอร์ไม่ตรงกับที่ลงทะเบียนไว้ที่ WorkID (wrong_app)",
  workid_unreachable: "ติดต่อ WorkID ไม่ได้ตอนนี้ ลองอีกครั้งในอีกสักครู่",
  workid_not_configured: "ยังไม่ได้ตั้งค่า WorkID SSO บนเซิร์ฟเวอร์นี้",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const first = (key: string) => {
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  };

  const error = first("error");
  const loggedOut = first("loggedout");
  const manual = first("manual");

  if (workIdConfigured() && !error && !loggedOut && !manual) {
    redirect("/api/auth/workid/login");
  }

  return (
    <AuthLayout
      title={loggedOut ? "ออกจากระบบแล้ว" : "เข้าสู่ WorkTrain"}
      subtitle="ล็อกอินด้วยบัญชี Work Station · เรียนและสอบได้ทั้งบนเว็บนี้และจาก LINE"
      icon={loggedOut ? "logOut" : "book"}
    >
      {error && <Alert title="เข้าสู่ระบบไม่สำเร็จ">{MESSAGES[error] ?? `ล็อกอินไม่สำเร็จ (${error})`}</Alert>}

      <a href="/api/auth/workid/login" className={buttonClass("primary", "lg", "w-full")}>
        <Icon name="arrow" size={18} />
        เข้าสู่ระบบด้วย WorkID
      </a>

      {!workIdConfigured() && (
        <Alert kind="info">
          เซิร์ฟเวอร์นี้ยังไม่ได้ตั้ง <code className="font-mono">WORKID_BASE_URL</code> / <code className="font-mono">WORKID_API_KEY</code> — ปุ่มด้านบนจะพากลับมาที่หน้านี้
        </Alert>
      )}
    </AuthLayout>
  );
}

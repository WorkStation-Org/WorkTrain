import type { Metadata } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

/**
 * ★ ฟอนต์ถูกกำหนดที่นี่ที่เดียวและ **โหลดตอน build** — next/font ดึงไฟล์มาเสิร์ฟเอง
 *   ไม่ได้ยิงไป Google ตอนผู้ใช้เปิดหน้า จึงไม่มีคำขอข้ามโดเมนให้ช้าหรือหลุด
 *   แลกกับการที่ `npm run build` ต้องมีเน็ต
 */
const notoSansThai = Noto_Sans_Thai({
  variable: "--font-noto-sans-thai",
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "WorkTrain",
  description: "ระบบเรียนรู้ด้วยตัวเองของ Work Station",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${notoSansThai.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}

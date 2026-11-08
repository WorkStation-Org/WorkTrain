import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

/**
 * ฟอนต์ตาม CI ของ Work Station (ชุดเดียวกับ WorkPass): อังกฤษ Old Standard TT · ไทย Noto Sans Thai
 * ไฟล์อยู่ใน ./fonts (WOFF2 · OFL ดู ./fonts/OFL.txt) — build ไม่ต้องต่อเน็ต และเสิร์ฟจากโดเมนเราเอง
 * ลำดับใน font-family: Old Standard TT ก่อน (ไม่มีอักษรไทย) → เบราว์เซอร์ใช้ Noto Sans Thai กับตัวอักษรไทยเอง
 * adjustFontFallback: false — ไม่ให้ next/font แทรกฟอนต์สำรองของเครื่องไว้ก่อน Noto Sans Thai
 */
const oldStandard = localFont({
  src: [
    { path: "./fonts/old-standard-tt-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/old-standard-tt-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-latin",
  display: "swap",
  adjustFontFallback: false,
});
const notoThai = localFont({
  src: [
    { path: "./fonts/noto-sans-thai-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/noto-sans-thai-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/noto-sans-thai-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/noto-sans-thai-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-thai",
  display: "swap",
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "WorkTrain",
  description: "ระบบเรียนรู้ด้วยตัวเองของ Work Station",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#131416" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: สคริปต์ด้านล่างใส่ data-theme ก่อน React hydrate (ค่าที่ผู้ใช้เลือกไว้) — ไม่ใช่ความต่างที่ผิด
    <html lang="th" className={`${oldStandard.variable} ${notoThai.variable}`} suppressHydrationWarning>
      <head>
        {/* ตั้งโหมดสีก่อนวาดหน้าแรก ไม่ให้กะพริบ */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-canvas text-fg antialiased">{children}</body>
    </html>
  );
}

// ไอคอนเส้น 24×24 ชุดเดียวทั้งแอป (เส้น 1.6 · ปลายมน) — ยกมาจาก WorkPass `apps/web/src/components/kit/icons.tsx`
// (ชุดเดียวกับแอปมือถือของ WorkPass) · ไอคอนเฉพาะ WorkTrain อยู่ท้าย PATHS · ห้ามใช้ emoji หรือตัวอักษรแทนไอคอน
// เพิ่มไอคอนใหม่: ใส่ path ลงใน PATHS · ไม่ต้องติดตั้ง library
import type { SVGProps } from "react";

const PATHS = {
  // ── ชุดเดียวกับมือถือ ──
  lock: "M7 10V7a5 5 0 0 1 10 0v3 M5 10h14v11H5z M12 14v3",
  shield: "M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6z M8 12l3 3 5-6",
  key: "M11.5 15a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0 M10.2 11.8 20 2 M15.5 6.5l3 3 M18 4l2 2",
  camera: "M4 6h4l2-3h4l2 3h4v15H4z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  photo: "M3 3h18v18H3z M3 17l6-6 4 4 3-3 5 6 M16 7h.01",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  plus: "M12 4v16 M4 12h16",
  search: "M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  star: "m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z",
  settings: "M9 3h6l1 4 4 1v7l-4 1-1 5H9l-1-5-4-1V8l4-1z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  copy: "M9 8h12v13H9z M15 8V3H3v13h6",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  check: "M4 12l5 5L20 6",
  qr: "M3 3h6v6H3z M15 3h6v6h-6z M3 15h6v6H3z M15 14v3h3v4h3v-7 M13 21h2 M18 11v2 M11 3v2",
  note: "M5 2h10l5 5v15H5z M14 2v6h6 M8 12h9 M8 16h7",
  noteLock: "M12 21H5V3h10l4 4v5 M14 3v5h5 M8 11h7 M8 15h3 M15.5 16.5v-1.5a2 2 0 0 1 4 0v1.5 M14.5 16.5h6v4.5h-6z",
  envVars: "M3 6h5 M3 12h5 M3 18h5 M10.5 5h2 M10.5 7h2 M10.5 11h2 M10.5 13h2 M10.5 17h2 M10.5 19h2 M15 6h6 M15 12h4 M15 18h6",
  card: "M2 5h20v15H2z M2 10h20 M5 16h4",
  code: "m8 6-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18",
  terminal: "M3 4h18v16H3z M7 9l3 3-3 3 M13 15h4",
  database: "M3 6c0-5 18-5 18 0v12c0 5-18 5-18 0z M3 6c0 5 18 5 18 0 M3 12c0 5 18 5 18 0",
  file: "M5 2h10l5 5v15H5z M14 2v6h6 M8 13h8 M8 17h5",
  info: "M12 11v6 M12 7h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  clock: "M12 6v6l4 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  logOut: "M9 4H3v16h6 M8 12h13 M16 7l5 5-5 5",
  building: "M4 22V3h16v19 M8 7h1 M15 7h1 M8 11h1 M15 11h1 M8 15h1 M15 15h1 M10 22v-4h4v4",
  refresh: "M20 7V2l-4 4 M20 7a9 9 0 1 0 1 8",
  chevronRight: "M9 5l7 7-7 7",
  chevronLeft: "M15 5l-7 7 7 7",
  x: "M6 6l12 12 M18 6 6 18",
  trash: "M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14 M10 11v6 M14 11v6",

  // ── วาดเพิ่มในสไตล์เดียวกัน (เว็บมีหน้าที่มือถือไม่มี) ──
  chevronDown: "M5 9l7 7 7-7",
  upload: "M12 15V3 M7 8l5-5 5 5 M3 15v6h18v-6",
  download: "M12 3v12 M7 10l5 5 5-5 M3 15v6h18v-6",
  eyeOff: "M3 3l18 18 M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.8 M6.6 6.6C3.8 8.5 2 12 2 12s4 7 10 7a9.7 9.7 0 0 0 5.4-1.6 M9.9 9.9a3 3 0 0 0 4.2 4.2",
  folder: "M3 4h7l2 3h9v13H3z M3 10h18",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M22 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  shieldAlert: "M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6z M12 8v5 M12 16h.01",
  alert: "M12 3 2 21h20z M12 10v5 M12 18h.01",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5 M12 7v5l4 2",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  more: "M6 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0 M13 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0 M20 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0",
  inbox: "M3 13h5l2 3h4l2-3h5 M3 13l3-9h12l3 9v7H3z",
  chart: "M3 3v18h18 M7 16l4-4 4 4 5-6",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  import: "M12 3v12 M7 10l5 5 5-5 M5 21h14",
  edit: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7 M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  dice: "M4 4h16v16H4z M8.5 8.5h.01 M15.5 8.5h.01 M12 12h.01 M8.5 15.5h.01 M15.5 15.5h.01",
  monitor: "M3 4h18v12H3z M8 20h8 M12 16v4",
  /** ปลดล็อกด้วย passkey (Face ID / ลายนิ้วมือ) */
  face: "M3 7V3h4 M17 3h4v4 M21 17v4h-4 M7 21H3v-4 M8 14s1.5 2 4 2 4-2 4-2 M9 9h.01 M15 9h.01",
  smartphone: "M7 2h10v20H7z M12 18h.01",
  globe: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M2 12h20 M12 2a15 15 0 0 1 0 20 M12 2a15 15 0 0 0 0 20",
  paperclip: "m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5",
  undo: "M3 7v6h6 M21 17a9 9 0 0 0-15-6.7L3 13",
  /** ยุบ/ขยายเมนูซ้าย (จากต้นแบบ) */
  sidebar: "M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z M9 4v16 M16 9l-3 3 3 3",
  sun: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",

  // ── WorkTrain (วาดเพิ่มในสไตล์เดียวกัน) ──
  /** ชุดที่ต้องเรียน */
  book: "M4 4h6a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H4z M20 4h-6a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h7z",
  /** ชุดการเรียนรู้ (สร้าง · อนุมัติ) */
  layers: "M12 3 2 8l10 5 10-5z M2 13l10 5 10-5 M2 18l10 5 10-5",
  /** Leaderboard */
  trophy: "M8 4h8v5a4 4 0 0 1-8 0z M8 6H4v1a4 4 0 0 0 4 4 M16 6h4v1a4 4 0 0 1-4 4 M12 13v4 M8 21h8 M9 17h6v4H9z",
  /** เส้นทาง Onboarding */
  route: "M6 19a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M22 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M4 17V9a4 4 0 0 1 4-4h10 M20 7v8a4 4 0 0 1-4 4H6",
  /** ข้อสอบ */
  clipboard: "M9 3h6v3H9z M7 4H5v17h14V4h-2 M8 11h8 M8 15h6",
  home: "M3 10 12 3l9 7v11h-6v-7H9v7H3z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className = "", strokeWidth = 1.6, ...props }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 ${className}`}
      {...props}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

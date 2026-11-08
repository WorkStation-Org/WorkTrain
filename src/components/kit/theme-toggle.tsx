"use client";
// ปุ่มสลับโหมดสว่าง/มืด (แถบบน) — ยกมาจาก WorkPass · จำค่าที่เลือกใน localStorage · ค่าเริ่มต้นตามเครื่อง (ดู lib/theme.ts)
import { useEffect, useState } from "react";
import { THEME_KEY, type ThemeChoice } from "@/lib/theme";
import { Icon } from "./icons";

const current = (): ThemeChoice => {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<ThemeChoice | null>(null);
  useEffect(() => {
    setTheme(current());
    // ยังไม่ได้เลือกเอง → ตามเครื่องเมื่อเครื่องเปลี่ยนโหมด
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setTheme(current());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const next: ThemeChoice = theme === "dark" ? "light" : "dark";
  const label = next === "dark" ? "เปลี่ยนเป็นโหมดมืด" : "เปลี่ยนเป็นโหมดสว่าง";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch {
          // storage ใช้ไม่ได้ (เช่นโหมดส่วนตัว) — เปลี่ยนเฉพาะหน้านี้
        }
        setTheme(next);
      }}
      className={`press inline-flex size-10 items-center justify-center rounded-lg text-muted hover:bg-subtle hover:text-fg ${className}`}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
    </button>
  );
}

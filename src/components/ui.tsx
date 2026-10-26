import Link from "next/link";
import type { ReactNode } from "react";

/**
 * ชิ้นส่วนหน้าจอที่ใช้ร่วมกันทั้งแอป — ยกมาจาก `Notification_Content/src/components/admin/ui.tsx`
 *
 * ★ **ไฟล์นี้ไม่มี `"use client"` โดยเจตนา**
 *   ต้นฉบับมี เพราะแอปนั้นเป็น client-rendered ทั้งใบอยู่แล้วจึงไม่เสียอะไร
 *   ส่วน WorkTrain เป็น server-first — หน้า list กับ detail เป็น server component
 *   ถ้าติด `"use client"` ตรงนี้ ทุกหน้าที่แค่ใช้ `<Card>` จะลาก JS ลงเบราว์เซอร์ไปด้วย
 *   ทั้งที่ไม่มีอะไรให้กด
 *
 *   ผลข้างเคียงที่ยอมรับ: ส่ง `onClick` จาก server component ไม่ได้ จะพัง**ตอน build**
 *   ซึ่งเป็นการพังที่ดังและเห็นทันที ต่างจากการพังเงียบที่ repo นี้กันอยู่ (ข้อ 14)
 *   ไฟล์ที่เป็น client อยู่แล้ว (`ticket-actions.tsx` · `category-admin.tsx`) ใช้ได้ตามปกติ
 *
 * ★ คลาสของ tone ทุกตัวเขียนเป็นสตริงเต็ม ไม่ต่อสตริงเอา — Tailwind v4 สร้างคลาส
 *   จากข้อความที่มันอ่านเจอตรง ๆ เท่านั้น คลาสที่ประกอบขึ้นตอนรันจะไม่มีอยู่จริงใน CSS
 */

/* ---------- โครง ---------- */

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-line bg-surface shadow-card ${padded ? "p-5 sm:p-6" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  right,
  className = "",
}: {
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <h2 className="text-[15px] font-semibold text-ink">{children}</h2>
      {right}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ---------- ป้าย ---------- */

export type BadgeTone = "success" | "neutral" | "warning" | "caution" | "danger" | "info";

const BADGE_TONE: Record<BadgeTone, string> = {
  success: "bg-success-soft text-success",
  neutral: "bg-neutral-soft text-ink-2",
  warning: "bg-warning-soft text-warning",
  caution: "bg-caution-soft text-caution",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};
const DOT_TONE: Record<BadgeTone, string> = {
  success: "bg-success",
  neutral: "bg-neutral",
  warning: "bg-warning",
  caution: "bg-caution",
  danger: "bg-danger",
  info: "bg-info",
};

export function Badge({
  tone = "neutral",
  label,
  dot = true,
  size = "md",
  className = "",
  title,
}: {
  tone?: BadgeTone;
  label: ReactNode;
  dot?: boolean;
  size?: "sm" | "md";
  className?: string;
  title?: string;
}) {
  const sz = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-[12px]";
  return (
    <span
      title={title}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full font-semibold whitespace-nowrap ${sz} ${BADGE_TONE[tone]} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_TONE[tone]}`} />}
      <span className="truncate">{label}</span>
    </span>
  );
}

export function toneDotClass(tone: BadgeTone): string {
  return DOT_TONE[tone];
}

/* ---------- ช่องกรอก ----------
 *
 * ★ ต้นฉบับมี `<Field>` / `<Select>` ที่เป็น controlled component (value + onChange)
 *   WorkTrain ไม่ได้ยกมา เพราะฟอร์มที่นี่เป็นฟอร์มจริงที่ใช้ `name=` + `defaultValue=`
 *   แล้วให้เบราว์เซอร์กับ server action จัดการ — ไม่มี state ฝั่ง client ให้ผูก
 *   จึงส่งต่อเป็น **คลาส** ให้เอาไปแปะบน `<input>` ของจริงแทน
 */

export const INPUT_CLASS =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink-4 transition focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10 disabled:bg-surface-3 disabled:text-ink-3";

export const SELECT_CLASS =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] text-ink transition focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10 disabled:bg-surface-3 disabled:text-ink-3";

export const FIELD_LABEL_CLASS = "mb-1.5 block text-[13px] font-medium text-ink-2";

export const FIELD_HINT_CLASS = "block pt-1 text-[11px] text-ink-3";

/** ป้ายกำกับ + ช่องกรอกที่ไม่ควบคุมค่า (uncontrolled) — ตัวห่อบาง ๆ ไม่ได้ถือ state */
export function FormField({
  label,
  hint,
  className = "",
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`block ${className}`}>
      {label && <span className={FIELD_LABEL_CLASS}>{label}</span>}
      {children}
      {hint && <span className={FIELD_HINT_CLASS}>{hint}</span>}
    </label>
  );
}

/* ---------- ปุ่ม ---------- */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover shadow-sm",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-3 hover:text-ink",
  danger: "border border-danger/40 text-danger hover:bg-danger-soft",
};

type ButtonSize = "sm" | "md" | "lg";

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[12px] gap-1.5",
  md: "h-9 px-4 text-[13px] gap-2",
  lg: "h-11 px-5 text-[14px] gap-2",
};

/**
 * คลาสของปุ่ม สำหรับที่ที่ต้องใช้ `<button>` ของจริง เช่นปุ่ม submit ในฟอร์ม
 * ที่ต้องอยู่ใน DOM ตอน `requestSubmit()` — ใช้แทน `<Button>` ได้ตรง ๆ
 */
export function buttonClass(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  extra = "",
): string {
  return `inline-flex items-center justify-center rounded-lg font-semibold transition disabled:pointer-events-none disabled:opacity-40 ${BUTTON_SIZE[size]} ${BUTTON_VARIANT[variant]} ${extra}`;
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  size = "md",
  disabled = false,
  type = "button",
  href,
  icon,
  className = "",
  title,
  full = false,
}: {
  children?: ReactNode;
  /** ★ ส่งได้เฉพาะจากไฟล์ที่เป็น `"use client"` — ดูหมายเหตุหัวไฟล์ */
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  type?: "button" | "submit";
  href?: string;
  icon?: ReactNode;
  className?: string;
  title?: string;
  full?: boolean;
}) {
  const cls = buttonClass(variant, size, `${full ? "w-full" : ""} ${className}`);
  const inner = (
    <>
      {icon && <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
      {children}
    </>
  );
  if (href && !disabled) {
    return (
      <Link href={href} className={cls} title={title}>
        {inner}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls} title={title}>
      {inner}
    </button>
  );
}

export function IconButton({
  children,
  onClick,
  title,
  tone = "default",
  disabled = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  title: string;
  tone?: "default" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const t =
    tone === "danger"
      ? "text-ink-3 hover:bg-danger-soft hover:text-danger"
      : "text-ink-3 hover:bg-surface-3 hover:text-ink";
  return (
    <button
      type={type}
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full border border-line transition disabled:opacity-40 [&>svg]:h-4 [&>svg]:w-4 ${t}`}
    >
      {children}
    </button>
  );
}

/* ---------- ตาราง ---------- */

export function Table({
  children,
  minWidth = "min-w-[900px]",
  className = "",
}: {
  children: ReactNode;
  minWidth?: string;
  className?: string;
}) {
  return (
    <div
      className={`scrollbar-thin overflow-x-auto rounded-xl border border-line bg-surface ${className}`}
    >
      <table className={`w-full text-left text-[13px] ${minWidth}`}>{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-surface-2 text-[12px] font-medium text-ink-3">{children}</thead>;
}

export function TH({
  children,
  className = "",
  align = "left",
}: {
  children?: ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  const a = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return <th className={`px-4 py-2.5 font-medium ${a} ${className}`}>{children}</th>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-line">{children}</tbody>;
}

export function TR({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <tr className={`align-top transition hover:bg-surface-2 ${className}`}>{children}</tr>;
}

export function TD({
  children,
  className = "",
  align = "left",
  colSpan,
}: {
  children?: ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
  colSpan?: number;
}) {
  const a = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <td colSpan={colSpan} className={`px-4 py-3 ${a} ${className}`}>
      {children}
    </td>
  );
}

/* ---------- หน้าว่าง ---------- */

export function EmptyState({
  icon,
  title,
  hint,
  action,
  compact = false,
}: {
  icon?: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${compact ? "py-6" : "py-12"}`}
    >
      {icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-3 text-ink-3 [&>svg]:h-5 [&>svg]:w-5">
          {icon}
        </div>
      )}
      <div className="text-[14px] font-medium text-ink">{title}</div>
      {hint && <div className="mt-1 max-w-md text-[12px] text-ink-3">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

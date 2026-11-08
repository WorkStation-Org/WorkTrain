import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./kit/icons";

export { Icon, type IconName } from "./kit/icons";

/**
 * ชิ้นส่วนหน้าจอที่ใช้ร่วมกันทั้งแอป — หน้าตายกมาจาก WorkPass (`apps/web/src/components/ui.tsx`)
 * โทนขาว-ดำ-เงิน · การ์ดมุม 13px · ปุ่มกดแล้วย่อ (`press`) · ป้ายตัวพิมพ์ใหญ่ละตินใช้คลาส `kicker` · ห้ามเว้นช่องไฟตัวไทย
 * props คงแบบเดิมของ WorkTrain ไว้ เพื่อให้หน้าเดิมใช้ต่อได้
 *
 * ★ **ไฟล์นี้ไม่มี `"use client"` โดยเจตนา** — WorkTrain เป็น server-first หน้า list/detail เป็น server component
 *   ส่ง `onClick` จาก server component ไม่ได้ จะพัง**ตอน build** (ดังและเห็นทันที)
 *
 * ★ คลาสของ tone ทุกตัวเขียนเป็นสตริงเต็ม ไม่ต่อสตริงเอา — Tailwind v4 สร้างคลาสจากข้อความที่อ่านเจอตรง ๆ เท่านั้น
 * ★ สีใช้ token ใน globals.css เท่านั้น (canvas · raised · subtle · line · fg · muted · accent · danger · warn · success)
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
  return <section className={`rounded-[13px] border border-line bg-raised ${padded ? "p-5" : ""} ${className}`}>{children}</section>;
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
      <h2 className="text-[15px] font-semibold text-fg">{children}</h2>
      {right}
    </div>
  );
}

/** ป้ายหัวกลุ่มเล็ก ๆ เหนือการ์ด · latin = ป้ายตัวพิมพ์ใหญ่ภาษาอังกฤษ (เว้นช่องไฟได้) */
export function SectionLabel({ children, right, latin = false, className = "" }: { children: ReactNode; right?: ReactNode; latin?: boolean; className?: string }) {
  return (
    <div className={`mb-2.5 flex items-center justify-between gap-3 px-0.5 ${latin ? "kicker" : "text-xs font-medium text-muted"} ${className}`}>
      <span>{children}</span>
      {right !== undefined && <span className="text-xs font-normal tracking-normal text-muted normal-case">{right}</span>}
    </div>
  );
}

/**
 * หัวหน้า: ป้าย kicker (ละตินตัวพิมพ์ใหญ่) + ชื่อหน้า + คำอธิบาย + ปุ่มหลักทางขวา
 * ชื่อหน้าภาษาไทยห้ามตัดบรรทัดเอง — ให้ตัดตามความกว้างจอ
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  kicker,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  kicker?: string;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-5">
      <div className="min-w-0">
        {kicker && <p className="kicker mb-2.5">{kicker}</p>}
        <h1 className="text-[26px] leading-tight font-medium text-fg sm:text-[30px]">{title}</h1>
        {subtitle && <div className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/* ---------- แจ้งเตือน ---------- */

const ALERT = {
  error: { cls: "border-danger/40 bg-danger-soft text-danger", icon: "alert" },
  warn: { cls: "border-warn/30 bg-warn-soft text-warn", icon: "alert" },
  info: { cls: "border-transparent bg-subtle text-muted", icon: "info" },
  success: { cls: "border-success/30 bg-success-soft text-success", icon: "check" },
} as const;

/** กล่องแจ้ง (notice ของ WorkPass) · icon เปลี่ยนไอคอนได้ */
export function Alert({ kind = "error", title, icon, children, className = "" }: { kind?: keyof typeof ALERT; title?: ReactNode; icon?: IconName; children: ReactNode; className?: string }) {
  const a = ALERT[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`flex gap-2.5 rounded-xl border p-3.5 text-[13px] leading-relaxed ${a.cls} ${className}`}>
      <Icon name={icon ?? a.icon} size={17} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? "text-fg/85" : ""}>{children}</div>
      </div>
    </div>
  );
}

/* ---------- ป้าย ---------- */

export type BadgeTone = "success" | "neutral" | "warning" | "caution" | "danger" | "info";

const BADGE_TONE: Record<BadgeTone, string> = {
  success: "bg-success-soft text-success",
  neutral: "bg-subtle text-muted",
  warning: "bg-warn-soft text-warn",
  caution: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  info: "border border-line text-muted",
};
const DOT_TONE: Record<BadgeTone, string> = {
  success: "bg-success",
  neutral: "bg-muted",
  warning: "bg-warn",
  caution: "bg-warn",
  danger: "bg-danger",
  info: "bg-muted",
};

/** ป้ายเล็ก (tag ของ WorkPass) */
export function Badge({
  tone = "neutral",
  label,
  dot = false,
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
  const sz = size === "sm" ? "px-1.5 text-[10.5px] leading-[18px]" : "px-2 py-0.5 text-[11px] leading-5";
  return (
    <span title={title} className={`inline-flex max-w-full items-center gap-1 rounded-md font-medium whitespace-nowrap ${sz} ${BADGE_TONE[tone]} ${className}`}>
      {dot && <span className={`size-1.5 shrink-0 rounded-full ${DOT_TONE[tone]}`} />}
      <span className="truncate">{label}</span>
    </span>
  );
}

export function toneDotClass(tone: BadgeTone): string {
  return DOT_TONE[tone];
}

/* ---------- ช่องกรอก ----------
 * ฟอร์มที่นี่เป็นฟอร์มจริงที่ใช้ `name=` + `defaultValue=` แล้วให้ server action จัดการ — ส่งต่อเป็น **คลาส** ให้แปะบน `<input>` ของจริง
 */

export const INPUT_CLASS =
  "w-full min-h-[42px] rounded-lg border border-line bg-raised px-3 py-2 text-sm text-fg placeholder:text-muted/70 transition-[border-color,box-shadow] focus:border-muted focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-muted/15 disabled:opacity-50";

export const SELECT_CLASS = `${INPUT_CLASS} pr-8`;

export const FIELD_LABEL_CLASS = "mb-2 block text-[13px] font-medium text-fg";

export const FIELD_HINT_CLASS = "block pt-1.5 text-xs text-muted";

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

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  secondary: "border border-line bg-raised text-fg hover:border-line-strong hover:bg-subtle",
  ghost: "text-muted hover:bg-subtle hover:text-fg",
  danger: "bg-danger text-danger-fg hover:opacity-90",
  "danger-ghost": "text-danger hover:bg-danger-soft",
};

type ButtonSize = "sm" | "md" | "lg";

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-3 text-xs",
  md: "h-10 gap-2 rounded-[9px] px-4 text-[13px]",
  lg: "h-12 gap-2.5 rounded-[9px] px-5 text-sm",
};

/**
 * คลาสของปุ่ม สำหรับที่ที่ต้องใช้ `<button>`/`<a>` ของจริง เช่นปุ่ม submit ในฟอร์ม — ใช้แทน `<Button>` ได้ตรง ๆ
 */
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra = ""): string {
  return `press inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap disabled:pointer-events-none disabled:opacity-35 ${BUTTON_SIZE[size]} ${BUTTON_VARIANT[variant]} ${extra}`;
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
  /** ชื่อไอคอนในชุด (`IconName`) หรือ element ใด ๆ */
  icon?: IconName | ReactNode;
  className?: string;
  title?: string;
  full?: boolean;
}) {
  const cls = buttonClass(variant, size, `${full ? "w-full" : ""} ${className}`);
  const iconSize = size === "sm" ? 14 : size === "lg" ? 18 : 16;
  const inner = (
    <>
      {typeof icon === "string" ? <Icon name={icon as IconName} size={iconSize} /> : icon && <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
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

/** ปุ่มไอคอนอย่างเดียว — title เป็นทั้ง aria-label และ tooltip */
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
  const t = tone === "danger" ? "text-danger hover:bg-danger-soft" : "text-muted hover:bg-subtle hover:text-fg";
  return (
    <button
      type={type}
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={`press inline-flex size-9 shrink-0 items-center justify-center rounded-lg disabled:opacity-35 [&>svg]:h-4 [&>svg]:w-4 ${t}`}
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
    <div className={`thin-scroll overflow-x-auto rounded-[13px] border border-line bg-raised ${className}`}>
      <table className={`w-full text-left text-[13px] ${minWidth}`}>{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-line text-xs font-medium text-muted">{children}</thead>;
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
  return <th className={`px-4 py-3 font-medium ${a} ${className}`}>{children}</th>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-line">{children}</tbody>;
}

export function TR({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <tr className={`align-top transition-colors hover:bg-subtle ${className}`}>{children}</tr>;
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

/* ---------- หน้าว่าง · โปรไฟล์ ---------- */

export function EmptyState({
  icon,
  title,
  hint,
  action,
  compact = false,
}: {
  /** ชื่อไอคอนในชุด หรือ element ใด ๆ · ไม่ใส่ = กล่องเปล่า */
  icon?: IconName | ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-4 px-6 text-center ${compact ? "py-8" : "py-14"}`}>
      <span className={`flex items-center justify-center border border-line bg-subtle text-fg ${compact ? "size-12 rounded-[16px]" : "size-16 rounded-[20px]"} [&>svg]:h-6 [&>svg]:w-6`}>
        {typeof icon === "string" ? <Icon name={icon as IconName} size={compact ? 22 : 26} /> : (icon ?? <Icon name="inbox" size={compact ? 22 : 26} />)}
      </span>
      <div>
        <p className={`font-semibold text-fg ${compact ? "text-[15px]" : "text-lg"}`}>{title}</p>
        {hint && <div className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">{hint}</div>}
      </div>
      {action && <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** ตัวอักษรแรกของชื่อในวงกลม (เมนูซ้าย) */
export function Avatar({ name, size = 36, className = "" }: { name: string; size?: number; className?: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full border border-line bg-subtle font-semibold text-fg ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initial}
    </span>
  );
}

/** ตัวเลขสรุปบนการ์ด (หน้าแรก · Dashboard) */
export function Stat({ label, value, hint, icon }: { label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: IconName }) {
  return (
    <div className="min-w-0 rounded-[13px] border border-line bg-raised p-3.5 sm:p-5">
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted">
        <span className="truncate">{label}</span>
        {icon && <Icon name={icon} size={16} className="hidden sm:block" />}
      </div>
      <p className="mt-2.5 font-ui text-[24px] leading-none font-semibold tabular-nums text-fg sm:mt-3 sm:text-[28px]">{value}</p>
      {hint && <p className="mt-2 text-xs text-muted">{hint}</p>}
    </div>
  );
}

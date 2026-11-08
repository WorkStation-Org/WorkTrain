import type { ReactNode } from "react";
import { Icon, type IconName } from "./kit/icons";

/**
 * หน้าก่อนเข้าแอป (เข้าสู่ระบบ) — แบบ CenteredCard ของ WorkPass: ซ้ายเป็นแผงโลหะ ขวาเป็นฟอร์ม · จอแคบ (< 950px) เหลือฟอร์มอย่างเดียว
 * emblem โลหะเป็นของ WorkPass — ที่นี่ใช้กรอบไอคอนแทน
 */
export function AuthLayout({ title, subtitle, icon = "book", children }: { title: ReactNode; subtitle?: ReactNode; icon?: IconName; children?: ReactNode }) {
  return (
    <main className="grid min-h-dvh bg-raised min-[950px]:grid-cols-2">
      <section className="auth-editorial relative hidden flex-col justify-between overflow-hidden px-10 py-14 text-[#ececee] min-[950px]:flex xl:px-14 xl:py-16" aria-hidden>
        <div>
          <p className="kicker text-[#b0b2b7]">The WorkTrain experience</p>
          <p className="mt-9 font-display text-[44px] leading-[1.12] xl:text-[54px]">
            Learn the product.
            <br />
            Pass with confidence.
          </p>
          <p className="mt-6 max-w-xs text-sm leading-loose text-[#aeb1b7]">เรียนรู้สินค้าใหม่ด้วยตัวเอง สอบให้ผ่าน แล้วพร้อมขายได้ทันที</p>
        </div>
        <div className="my-8 flex flex-col items-center gap-6 self-center">
          <span className="flex size-[150px] items-center justify-center rounded-[40px] border border-[#ffffff22] bg-[#ffffff0d] text-[#f4f4f5] shadow-[0_12px_22px_rgb(0_0_0/0.35)]">
            <Icon name="book" size={72} strokeWidth={1.2} />
          </span>
          <span className="font-display text-[32px] leading-none tracking-[0.11em] text-[#f4f4f5] xl:text-[36px]">WORKTRAIN</span>
        </div>
        <p className="font-display text-sm tracking-[0.2em] text-[#cacdd2]">WORK STATION · LEARNING</p>
      </section>
      <section className="flex items-center px-6 py-10 sm:px-12">
        <div className="mx-auto flex w-full max-w-[400px] animate-fade-up flex-col gap-5">
          <span className="flex size-14 items-center justify-center self-center rounded-[16px] border border-line bg-subtle text-fg">
            <Icon name={icon} size={26} />
          </span>
          <div className="text-center">
            <h1 className="text-[26px] leading-snug font-semibold text-fg sm:text-[28px]">{title}</h1>
            {subtitle && <div className="mt-3 text-sm leading-relaxed text-muted">{subtitle}</div>}
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}

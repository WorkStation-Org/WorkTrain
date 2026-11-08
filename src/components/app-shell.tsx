"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./kit/icons";
import { ThemeToggle } from "./kit/theme-toggle";

/**
 * โครงหน้าหลังล็อกอิน — ยกจาก WorkPass `vault-app.tsx` (Shell): เมนูซ้ายยุบได้ · จอแคบ (< 720px) เป็น drawer ·
 * แถบบนมีชื่อหน้า · ปุ่มสลับโหมดสี · ออกจากระบบ
 *
 * ★ รายการเมนูมาจาก server (`(app)/layout.tsx`) ตาม role — ที่นี่แค่วาดและไฮไลต์หน้าปัจจุบัน
 *   สิทธิ์จริงยังตรวจที่หน้า/ service เสมอ เมนูที่ซ่อนไม่ใช่ด่านกันสิทธิ์
 */

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}
export interface NavSection {
  /** หัวกลุ่มตัวพิมพ์ใหญ่ละติน (kicker) */
  title: string;
  items: NavItem[];
}

const SIDEBAR_KEY = "worktrain-sidebar-collapsed";

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function NavRow({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={`press flex min-h-[42px] w-full items-center gap-3 rounded-lg text-[13px] transition-colors ${collapsed ? "justify-center px-0" : "px-3.5"} ${
        active ? "bg-fg text-canvas" : "text-muted hover:bg-subtle hover:text-fg"
      }`}
    >
      <Icon name={item.icon} size={17} />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
    </Link>
  );
}

function NavHeading({ children, collapsed }: { children: ReactNode; collapsed: boolean }) {
  return collapsed ? <div className="mx-3 my-3 border-t border-line" role="presentation" /> : <p className="kicker mx-3.5 mt-6 mb-2.5 text-[10px]">{children}</p>;
}

/** wordmark ของ WorkTrain — กรอบไอคอนแทน emblem (emblem โลหะเป็นของ WorkPass) */
export function BrandMark({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <span className={`flex items-center gap-2.5 ${collapsed ? "justify-center" : ""}`}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-fg text-canvas">
        <Icon name="book" size={20} />
      </span>
      {!collapsed && <span className="font-display text-2xl leading-none tracking-[0.03em] text-fg">WORKTRAIN</span>}
    </span>
  );
}

export function AppShell({
  sections,
  user,
  children,
}: {
  sections: NavSection[];
  user: { name: string; roleLabel: string; email: string };
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_KEY) === "true");
    } catch {
      // storage ใช้ไม่ได้ — เริ่มแบบขยาย
    }
  }, []);
  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer]);

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, String(!c));
      } catch {
        // storage ใช้ไม่ได้ — ยุบเฉพาะหน้านี้
      }
      return !c;
    });

  const all = sections.flatMap((s) => s.items);
  // หน้าที่ลึกที่สุดที่ตรง = ชื่อบนแถบบน (เช่น /learn/12 → ชุดที่ต้องเรียน)
  const current = all.filter((i) => isActive(pathname, i.href)).sort((a, b) => b.href.length - a.href.length)[0];

  const sidebar = (c: boolean) => (
    <div className="flex h-full flex-col">
      <Link href="/" className={`flex min-h-12 items-center ${c ? "justify-center" : "px-1"}`} aria-label="WORKTRAIN — หน้าแรก">
        <BrandMark collapsed={c} />
      </Link>
      <nav className="thin-scroll -mx-1 mt-3 flex-1 overflow-y-auto px-1 pb-4" aria-label="เมนูหลัก">
        {sections.map((s) =>
          s.items.length ? (
            <div key={s.title}>
              <NavHeading collapsed={c}>{s.title}</NavHeading>
              <div className="flex flex-col gap-0.5">
                {s.items.map((i) => (
                  <NavRow key={i.href} item={i} active={current?.href === i.href} collapsed={c} />
                ))}
              </div>
            </div>
          ) : null,
        )}
      </nav>
      <div className="border-t border-line pt-4">
        {!c && (
          <p className="kicker mb-4 flex items-center gap-2 px-1.5 text-[10px]">
            <span className="size-1.5 rounded-full bg-muted" aria-hidden />
            Learn. Pass. Grow.
          </p>
        )}
        <div title={`${user.name} · ${user.email}`} className={`flex items-center gap-2.5 rounded-lg py-1.5 ${c ? "justify-center" : "px-1.5"}`}>
          <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-subtle text-[12px] font-semibold text-fg">
            {user.name.trim().charAt(0).toUpperCase() || "?"}
          </span>
          {!c && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-fg">{user.name}</span>
              <span className="block truncate text-[11px] text-muted">{user.roleLabel}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh">
      <aside
        id="sidebar"
        className={`fixed inset-y-0 left-0 z-30 hidden border-r border-line bg-raised pt-7 pb-4 transition-[width,padding] duration-200 nav:block ${collapsed ? "w-20 px-3" : "w-[248px] px-4"}`}
      >
        {sidebar(collapsed)}
      </aside>
      {/* จอแคบ (< 720px): เมนูเลื่อนออกจากซ้าย */}
      {drawer && (
        <div className="fixed inset-0 z-40 nav:hidden" role="dialog" aria-modal aria-label="เมนู">
          <button type="button" aria-label="ปิดเมนู" className="absolute inset-0 animate-fade-in bg-black/50" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] animate-slide-in border-r border-line bg-raised px-4 pt-6 pb-4 shadow-pop">{sidebar(false)}</aside>
        </div>
      )}
      <div className={`flex min-h-dvh flex-col transition-[padding] duration-200 ${collapsed ? "nav:pl-20" : "nav:pl-[248px]"}`}>
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur-md sm:px-6 lg:h-[72px] lg:px-8 xl:px-10">
          <div className="flex min-w-0 items-center gap-3 lg:gap-4">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              aria-label="เปิดเมนู"
              aria-expanded={drawer}
              className="press flex size-10 shrink-0 items-center justify-center rounded-lg border border-line text-muted hover:bg-subtle hover:text-fg nav:hidden"
            >
              <Icon name="menu" size={18} />
            </button>
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? "ขยายเมนูด้านซ้าย" : "ยุบเมนูด้านซ้าย"}
              title={collapsed ? "ขยายเมนูด้านซ้าย" : "ยุบเมนูด้านซ้าย"}
              aria-expanded={!collapsed}
              aria-controls="sidebar"
              className="press hidden size-10 shrink-0 items-center justify-center rounded-lg border border-line text-muted hover:bg-subtle hover:text-fg nav:flex"
            >
              <Icon name="sidebar" size={18} className={`transition-transform duration-200 ${collapsed ? "-scale-x-100" : ""}`} />
            </button>
            <span className="truncate text-[13px] text-muted">{current?.label ?? "WorkTrain"}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <ThemeToggle />
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="press flex h-10 items-center gap-2 rounded-lg px-2.5 text-[13px] text-muted hover:bg-subtle hover:text-fg sm:px-3" aria-label="ออกจากระบบ">
                <Icon name="logOut" size={16} />
                <span className="hidden sm:inline">ออกจากระบบ</span>
              </button>
            </form>
          </div>
        </header>
        <div key={pathname} className="w-full flex-1 animate-fade-in px-4 py-7 sm:px-6 lg:px-8 lg:py-9 xl:px-10">
          {children}
        </div>
      </div>
    </div>
  );
}

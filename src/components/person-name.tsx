import { withNickname, type PersonLabel } from "@/lib/person-name";

/**
 * ชื่อคนในรายชื่อ — "ชื่อ สกุล (ชื่อเล่น)" ตามด้วยทีมตัวเทาเล็ก (แท็บผู้เรียน · Dashboard)
 * แยกจาก `ui.tsx` เพราะ `person-name.ts` ลากผังของ WorkID มาด้วย — ใช้ใน server component เท่านั้น
 */
export function PersonName({ label, showTeam = true }: { label: PersonLabel; showTeam?: boolean }) {
  return (
    <>
      {withNickname(label)}
      {showTeam && label.team && (
        <>
          {" "}
          <span className="text-[11px] text-ink-3">· {label.team}</span>
        </>
      )}
    </>
  );
}

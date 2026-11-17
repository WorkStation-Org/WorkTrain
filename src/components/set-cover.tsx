/**
 * ปกของชุดการเรียนรู้บนการ์ด (16:9) — ภาพปกคลิปแรก · ป้ายชนิดของชุด · ปุ่มเล่น + ชิปความยาว หรือไอคอนเอกสารเมื่อไม่มีวิดีโอ
 * ใช้ทั้งหน้าผู้เรียน (`/learn`) และหน้าชุดการเรียนรู้แบบการ์ด (`/sets`)
 */
export function SetCover({
  coverUrl,
  hasVideo,
  kindName,
  videoChip,
}: {
  coverUrl: string | null;
  hasVideo: boolean;
  kindName: string;
  /** ชิปมุมปก — `3 คลิป · 24:10` */
  videoChip: string | null;
}) {
  return (
    <div className={`relative flex aspect-video items-center justify-center overflow-hidden ${hasVideo ? "bg-[#2c2e32]" : "bg-subtle"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- ภาพผ่าน route ที่ตรวจสิทธิ์ ไม่ผ่าน next/image */}
      {coverUrl && <img src={coverUrl} alt="" className="absolute inset-0 size-full object-cover" />}
      <span className={`absolute left-3 top-2.5 rounded px-1.5 text-[11px] tracking-wide ${hasVideo ? "bg-black/45 text-[#e7e8ea]" : "text-muted"}`}>
        {kindName}
      </span>
      {hasVideo ? (
        <>
          <span className="relative flex size-11 items-center justify-center rounded-full bg-white/90 text-[#161719]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
          {videoChip && <span className="absolute bottom-2.5 right-2.5 rounded bg-black/60 px-1.5 text-[11px] leading-5 text-white">{videoChip}</span>}
        </>
      ) : (
        <svg width="38" height="46" viewBox="0 0 40 48" fill="none" stroke="currentColor" strokeWidth="2" className="text-ink-4" aria-hidden>
          <path d="M6 2h20l10 10v34H6z" />
          <path d="M26 2v10h10" />
          <path d="M12 24h16M12 31h16M12 38h10" />
        </svg>
      )}
    </div>
  );
}

/** ชิปมุมปก — คลิปเดียวบอกแค่ความยาว · หลายคลิปบอกจำนวนด้วย */
export function videoChipLabel(videos: number, duration: string): string | null {
  if (!videos) return null;
  return videos > 1 ? `${videos} คลิป · ${duration}` : duration;
}

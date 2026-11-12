/**
 * MP4 จำลองขนาดเล็กสำหรับเทสต์ — มีแค่กล่องที่ `mp4DurationSeconds` อ่าน (ftyp · mdat · moov/mvhd)
 * ไม่ใช่วิดีโอที่เล่นได้จริง
 */

function box(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function mvhd(version: 0 | 1, timescale: number, duration: number): Uint8Array {
  const body = new Uint8Array(version === 1 ? 112 : 100);
  const v = new DataView(body.buffer);
  body[0] = version;
  if (version === 1) {
    v.setUint32(20, timescale);
    v.setUint32(24, Math.floor(duration / 2 ** 32));
    v.setUint32(28, duration % 2 ** 32);
  } else {
    v.setUint32(12, timescale);
    v.setUint32(16, duration);
  }
  return box("mvhd", body);
}

/**
 * `seconds` วินาที · `moovAtEnd` = moov อยู่หลัง mdat (ไฟล์ที่ไม่ได้ทำ faststart) · `mdatBytes` = ขนาดเนื้อวิดีโอปลอม
 */
export function fakeMp4(opts: { seconds: number; timescale?: number; version?: 0 | 1; moovAtEnd?: boolean; mdatBytes?: number }): Uint8Array {
  const timescale = opts.timescale ?? 1000;
  const ftyp = box("ftyp", new TextEncoder().encode("isom\0\0\x02\0isomiso2avc1mp41"));
  const moov = box("moov", concat([box("trak", new Uint8Array(16)), mvhd(opts.version ?? 0, timescale, Math.round(opts.seconds * timescale))]));
  const mdat = box("mdat", new Uint8Array(opts.mdatBytes ?? 64));
  return opts.moovAtEnd ? concat([ftyp, mdat, moov]) : concat([ftyp, moov, mdat]);
}

/** ตัวอ่านเป็นช่วงจาก bytes ในหน่วยความจำ — นับจำนวนครั้งที่อ่านด้วย */
export function rangeReader(bytes: Uint8Array) {
  const reader = Object.assign(async (start: number, length: number) => ((reader.calls += 1), bytes.slice(start, start + length)), { calls: 0 });
  return reader;
}

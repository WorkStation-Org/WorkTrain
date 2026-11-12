/**
 * เฉลี่ยข้อสอบให้ครอบคลุมทุกไฟล์ — กติกาล้วน ไม่แตะฐานหรือ AI
 *
 * ข้อสอบมี 5 ชุด ชุดละ 10 ข้อ (ADR-0003) = 50 ข้อ · แบ่ง 50 ข้อตามน้ำหนักของแต่ละไฟล์
 * (เศษให้ไฟล์ที่เศษมากสุด) แล้วแจกทีละข้อวนชุด 1→5 ทุกชุดจึงได้ครบพอดี และแต่ละไฟล์กระจายทุกชุดเท่า ๆ กัน
 *   10 ไฟล์ → ไฟล์ละ 1 ข้อทุกชุด (5 ข้อรวม) · 4 ไฟล์ → ไฟล์ละ 2–3 ข้อต่อชุด (12–13 ข้อรวม)
 * AI ได้แผนนี้เป็นตัวเลขชัดเจน แทนการเลือกเอง · หลังออกนับจาก `source_ref` ว่าตรงแผนไหม (`coverage`)
 */

/** แผน `[ชุด][ไฟล์]` = จำนวนข้อ · น้ำหนักเป็น 0 ทุกไฟล์ = ถือว่าเท่ากัน */
export function spreadPlan(weights: readonly number[], perForm: number, forms: number): number[][] {
  const n = weights.length;
  if (n === 0) return Array.from({ length: forms }, () => []);
  const w = weights.map((x) => Math.max(0, x));
  const used = w.some((x) => x > 0) ? w : w.map(() => 1);
  const sum = used.reduce((a, b) => a + b, 0);
  const total = perForm * forms;
  const exact = used.map((x) => (total * x) / sum);
  const totals = exact.map(Math.floor);
  let left = total - totals.reduce((a, b) => a + b, 0);
  const byRemainder = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of byRemainder) {
    if (left <= 0) break;
    totals[i] += 1;
    left -= 1;
  }
  const plan = Array.from({ length: forms }, () => new Array<number>(n).fill(0));
  let k = 0;
  totals.forEach((t, i) => {
    for (let j = 0; j < t; j++) {
      plan[k % forms][i] += 1;
      k += 1;
    }
  });
  return plan;
}

function stem(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]+$/i, "").trim().toLowerCase();
}

/** ไฟล์ที่ `source_ref` อ้าง — เทียบชื่อไฟล์ (มีหรือไม่มีนามสกุล) · ชื่อยาวสุดชนะ · ไม่พบ = -1 */
export function sourceDocIndex(sourceRef: string, fileNames: readonly string[]): number {
  const ref = sourceRef.toLowerCase();
  let best = -1;
  let bestLen = 0;
  fileNames.forEach((f, i) => {
    const s = stem(f);
    if (s && ref.includes(s) && s.length > bestLen) {
      best = i;
      bestLen = s.length;
    }
  });
  return best;
}

/** นับว่าแต่ละชุดมาจากไฟล์ไหนกี่ข้อ — `[ชุด][ไฟล์]` · `unknown[ชุด]` = ข้อที่ระบุไฟล์ไม่ได้ */
export function coverage(forms: readonly (readonly { sourceRef: string }[])[], fileNames: readonly string[]) {
  const counts = forms.map(() => new Array<number>(fileNames.length).fill(0));
  const unknown = forms.map(() => 0);
  forms.forEach((qs, f) => {
    for (const q of qs) {
      const i = sourceDocIndex(q.sourceRef, fileNames);
      if (i < 0) unknown[f] += 1;
      else counts[f][i] += 1;
    }
  });
  return { counts, unknown };
}

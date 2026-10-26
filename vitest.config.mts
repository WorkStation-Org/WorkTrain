import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // ★ บทเรียนจาก WorkService (21 ก.ย. 2026): vitest นับ hook ที่ timeout เป็น `skipped`
    //   ไม่ใช่ `failed` แล้ว `npm test` จบด้วย exit 0 ทั้งที่เทสต์หนึ่งในสามไม่ได้รัน
    //   ไฟล์ที่ใช้ PGlite รัน migration ทุกไฟล์ใน beforeAll ซึ่งช้าบนเครื่องที่โหลดสูง
    hookTimeout: 60_000,
    // worktree ของ agent อยู่ใต้ `.claude/worktrees/` ในโฟลเดอร์ repo — ไม่กันไว้ vitest จะรันเทสต์ของ branch อื่นปนกับของเรา
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});

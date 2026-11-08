// โหมดสีที่ผู้ใช้เลือกเอง (ปุ่มสลับบนแถบบน) — แบบเดียวกับ WorkPass `src/lib/theme.ts`
// ไม่มีค่า = ตามโหมดของเครื่อง (prefers-color-scheme) · globals.css อ่านจาก <html data-theme>
export const THEME_KEY = "worktrain-theme";
export type ThemeChoice = "light" | "dark";

/** รันใน <head> ก่อนวาดหน้า — อ่านค่าที่เลือกไว้แล้วใส่ data-theme · ค่าแปลก/อ่าน storage ไม่ได้ = ตามเครื่อง */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

/**
 * groupId ของกลุ่ม LINE — รูปแบบที่ GateWay รับ ใช้ร่วมกันทุกที่ที่เก็บหรืออ่าน groupId
 *
 * - กลุ่ม LINE ประจำตัว (เจ้าตัว + หัวหน้า) ที่ตั้งใน WorkID — `fetchOrg()` ตรวจก่อนใช้
 * - `TEST_LINE_GROUP_ID` — `testGroupOverride()` ตรวจก่อนใช้
 */
export const LINE_GROUP_ID = /^C[0-9a-f]{32}$/;

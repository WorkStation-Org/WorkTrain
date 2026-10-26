-- ตารางที่เป็นประวัติ มีแต่ insert — แก้หรือลบ = ฐานปฏิเสธ ไม่ใช่แค่โค้ดสัญญาว่าจะไม่ทำ
-- approval_events: ประวัติการอนุมัติและการแก้ข้อสอบ (spec §4)
-- version_acknowledgements: การรับทราบเปลี่ยนเล็ก (ADR-0008)
-- document_views: log การเปิดเอกสารต้นทาง (ADR-0010)
CREATE FUNCTION wt_insert_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ตาราง % มีแต่ insert — ห้าม %', TG_TABLE_NAME, TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER approval_events_insert_only BEFORE UPDATE OR DELETE ON approval_events FOR EACH ROW EXECUTE FUNCTION wt_insert_only();
--> statement-breakpoint
CREATE TRIGGER version_acknowledgements_insert_only BEFORE UPDATE OR DELETE ON version_acknowledgements FOR EACH ROW EXECUTE FUNCTION wt_insert_only();
--> statement-breakpoint
CREATE TRIGGER document_views_insert_only BEFORE UPDATE OR DELETE ON document_views FOR EACH ROW EXECUTE FUNCTION wt_insert_only();

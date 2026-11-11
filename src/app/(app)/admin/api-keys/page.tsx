import { Badge, buttonClass, Card, EmptyState, PageHeader, SectionTitle, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { listApiKeys, NOTE_MAX } from "@/lib/api-consumers";
import { firstParam, pageActor } from "@/lib/page";
import { formatBangkok } from "@/lib/time";
import { Flash } from "../../sets/ui";
import { revokeApiKeyAction } from "./actions";
import { CreateKeyForm } from "./create-form";

export const dynamic = "force-dynamic";

/**
 * API key ของระบบอื่นในเครือ (ADR-0012) — TG ออก · ดูว่าใช้ล่าสุดเมื่อไร · ถอน · admin เท่านั้น
 * ★ ไม่มีหน้าไหนแสดง key เต็มซ้ำ — หน้านี้เห็นแค่ 4 ตัวท้าย
 */
export default async function ApiKeysPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await pageActor(["admin"]);
  const sp = await searchParams;
  const keys = await listApiKeys();
  const active = keys.filter((k) => !k.revokedAt).length;

  return (
    <main className="mx-auto w-full max-w-5xl space-y-5">
      <PageHeader
        kicker="API keys"
        title="API Key ของระบบอื่น"
        subtitle="ระบบในเครือ (เช่น WorkHR) ใช้ key นี้อ่านข้อมูลจาก WorkTrain ผ่าน /api/v1 — อ่านได้อย่างเดียว แก้ข้อมูลไม่ได้"
      />
      <Flash msg={firstParam(sp.msg)} err={firstParam(sp.err)} />

      <Card>
        <SectionTitle className="mb-4">ออก key ใหม่</SectionTitle>
        <CreateKeyForm noteMax={NOTE_MAX} />
      </Card>

      <section className="space-y-3">
        <SectionTitle right={<span className="text-xs text-muted">ใช้งานอยู่ {active} key</span>}>Key ทั้งหมด</SectionTitle>
        {keys.length === 0 ? (
          <Card>
            <EmptyState icon="key" title="ยังไม่มี key" hint="ทุกคำขอเข้า /api/v1 จะถูกปฏิเสธจนกว่าจะออก key ให้ระบบปลายทาง" compact />
          </Card>
        ) : (
          <Table minWidth="min-w-[760px]">
            <THead>
              <tr>
                <TH>ระบบ</TH>
                <TH>Key</TH>
                <TH>ออกโดย</TH>
                <TH>ใช้ล่าสุด</TH>
                <TH>สถานะ</TH>
                <TH align="right" />
              </tr>
            </THead>
            <TBody>
              {keys.map((k) => (
                <TR key={k.id}>
                  <TD>
                    <span className="font-medium text-fg">{k.name}</span>
                    {k.note && <span className="block text-xs text-muted">{k.note}</span>}
                  </TD>
                  <TD>
                    <code className="font-mono text-xs text-muted">wtr_…{k.keyHint}</code>
                  </TD>
                  <TD>
                    {k.createdByName}
                    <span className="block text-xs text-muted">{formatBangkok(k.createdAt)}</span>
                  </TD>
                  <TD className="text-muted">{k.lastUsedAt ? formatBangkok(k.lastUsedAt) : "ยังไม่เคยใช้"}</TD>
                  <TD>
                    {k.revokedAt ? (
                      <>
                        <Badge tone="neutral" label="ถอนแล้ว" />
                        <span className="block pt-1 text-xs text-muted">
                          {formatBangkok(k.revokedAt)}
                          {k.revokedByName ? ` · ${k.revokedByName}` : ""}
                        </span>
                      </>
                    ) : (
                      <Badge tone="success" label="ใช้งานอยู่" />
                    )}
                  </TD>
                  <TD align="right">
                    {!k.revokedAt && (
                      <details className="inline-block text-left">
                        <summary className={`${buttonClass("danger-ghost", "sm")} list-none`}>ถอน</summary>
                        <form action={revokeApiKeyAction} className="mt-2 w-56 space-y-2 rounded-lg border border-line bg-raised p-3 text-xs text-muted">
                          <input type="hidden" name="id" value={k.id} />
                          <p>{k.name} จะเรียก API ด้วย key นี้ไม่ได้ทันที และเปิดคืนไม่ได้</p>
                          <button type="submit" className={buttonClass("danger", "sm")}>
                            ยืนยันถอน key
                          </button>
                        </form>
                      </details>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </main>
  );
}

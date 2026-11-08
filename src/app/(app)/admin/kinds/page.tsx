import Link from "next/link";
import { Badge, buttonClass, Card, FIELD_HINT_CLASS, FIELD_LABEL_CLASS, INPUT_CLASS, PageHeader, SectionTitle } from "@/components/ui";
import { LEVELS } from "@/db/schema";
import { LEVEL_LABELS, QUESTIONS_PER_FORM, TOPIC_MAX, topicLabel, topicsOf, type Blueprint } from "@/domain/blueprint";
import { KIND_NAME_MAX, listKinds } from "@/lib/kind-service";
import { firstParam, pageActor } from "@/lib/page";
import { Flash } from "../../sets/ui";
import { createKindAction, setKindActiveAction, updateKindAction } from "./actions";
import { BlueprintEditor, type EditorRow } from "./blueprint-editor";

export const dynamic = "force-dynamic";

const LEVEL_OPTIONS = LEVELS.map((key) => ({ key, label: LEVEL_LABELS[key] }));

/** แม่แบบ → แถวของตาราง (หัวข้อละแถว) · รหัสหัวข้อเดิมแสดงเป็นชื่อ */
function toRows(b: Blueprint): EditorRow[] {
  return topicsOf(b).map((t) => ({
    topic: topicLabel(t),
    counts: Object.fromEntries(LEVELS.map((l) => [l, b.filter((c) => c.topic === t && c.level === l).reduce((n, c) => n + c.count, 0)])),
  }));
}

function Summary({ blueprint }: { blueprint: Blueprint }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {topicsOf(blueprint).map((t) => (
        <li key={t} className="rounded-md bg-subtle px-2 py-1 text-xs text-muted">
          {topicLabel(t)} · {blueprint.filter((c) => c.topic === t).reduce((n, c) => n + c.count, 0)} ข้อ
        </li>
      ))}
    </ul>
  );
}

function KindFields({ name, allowPricelist, rows }: { name: string; allowPricelist: boolean; rows: EditorRow[] }) {
  return (
    <div className="space-y-4">
      <label className="block">
        <span className={FIELD_LABEL_CLASS}>ชื่อชนิด</span>
        <input name="name" required maxLength={KIND_NAME_MAX} defaultValue={name} placeholder="เช่น ความปลอดภัยในการทำงาน" className={INPUT_CLASS} />
      </label>
      <div>
        <span className={FIELD_LABEL_CLASS}>แม่แบบข้อสอบ (ชุดละ {QUESTIONS_PER_FORM} ข้อ)</span>
        <BlueprintEditor initial={rows} levels={LEVEL_OPTIONS} total={QUESTIONS_PER_FORM} topicMax={TOPIC_MAX} />
        <span className={FIELD_HINT_CLASS}>
          จำ = ถามข้อเท็จจริง · เข้าใจ = เปรียบเทียบหรืออธิบายเหตุผล · สถานการณ์ = เจอเหตุการณ์ในงานแบบนี้ควรทำอะไร · ผู้สร้างปรับสัดส่วนของชุดตัวเองได้ภายหลัง
        </span>
      </div>
      <label className="flex items-start gap-2.5 text-[13px]">
        <input type="checkbox" name="allowPricelist" defaultChecked={allowPricelist} className="mt-0.5 size-4" />
        <span>
          <span className="font-medium text-fg">แนบ Pricelist ได้</span>
          <span className="block text-xs text-muted">ไฟล์ราคาที่ผู้เรียนเปิดดูได้อย่างเดียว ประทับลายน้ำทุกหน้า ดาวน์โหลดไม่ได้</span>
        </span>
      </label>
    </div>
  );
}

/**
 * ชนิดของชุดการเรียนรู้ (ADR-0011) — TG เพิ่ม · แก้ชื่อ · ตั้งแม่แบบข้อสอบ · เปิด/ปิด · admin เท่านั้น
 * ★ แม่แบบที่นี่เป็นค่าตั้งต้นของชุดที่สร้างใหม่ — ชุดที่สร้างแล้วเก็บแม่แบบของตัวเอง
 */
export default async function KindsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await pageActor(["admin"]);
  const sp = await searchParams;
  const kinds = await listKinds();

  return (
    <main className="mx-auto w-full max-w-4xl space-y-5">
      <PageHeader
        kicker="Set types"
        title="ชนิดของชุดการเรียนรู้"
        subtitle="ผู้สร้างเลือกชนิดตอนสร้างชุด แล้วได้แม่แบบข้อสอบของชนิดนั้นเป็นค่าตั้งต้น — แก้แม่แบบที่นี่มีผลกับชุดที่สร้างใหม่เท่านั้น"
        actions={
          <Link href="/sets" className="text-[13px] text-muted underline">
            ชุดการเรียนรู้
          </Link>
        }
      />
      <Flash msg={firstParam(sp.msg)} err={firstParam(sp.err)} />

      <ul className="space-y-3">
        {kinds.map((k) => (
          <li key={k.id}>
            <Card>
              <SectionTitle
                className="mb-2"
                right={
                  <div className="flex flex-wrap items-center gap-1.5">
                    {k.allowPricelist && <Badge tone="info" label="แนบ Pricelist ได้" />}
                    <Badge tone={k.active ? "success" : "neutral"} label={k.active ? "เปิดอยู่" : "ปิดอยู่"} />
                  </div>
                }
              >
                {k.name}
              </SectionTitle>
              <p className="mb-3 text-xs text-muted">ใช้กับ {k.setCount} ชุด</p>
              <Summary blueprint={k.blueprint} />

              <details className="group mt-4 border-t border-line pt-3">
                <summary className="cursor-pointer text-[13px] font-medium text-fg select-none">แก้ไข</summary>
                <form action={updateKindAction} className="mt-4 space-y-4">
                  <input type="hidden" name="kindId" value={k.id} />
                  <KindFields name={k.name} allowPricelist={k.allowPricelist} rows={toRows(k.blueprint)} />
                  <button type="submit" className={buttonClass("primary")}>
                    บันทึก
                  </button>
                </form>
                <form action={setKindActiveAction} className="mt-4 border-t border-line pt-3">
                  <input type="hidden" name="kindId" value={k.id} />
                  <input type="hidden" name="active" value={k.active ? "0" : "1"} />
                  <p className="mb-2 text-xs text-muted">
                    {k.active ? "ปิดแล้วผู้สร้างเลือกชนิดนี้ไม่ได้ ชุดที่มีอยู่ไม่กระทบ" : "เปิดแล้วผู้สร้างเลือกชนิดนี้ได้อีก"}
                  </p>
                  <button type="submit" className={buttonClass(k.active ? "danger-ghost" : "secondary", "sm")}>
                    {k.active ? "ปิดชนิดนี้" : "เปิดชนิดนี้"}
                  </button>
                </form>
              </details>
            </Card>
          </li>
        ))}
      </ul>

      <Card>
        <SectionTitle className="mb-4">เพิ่มชนิดใหม่</SectionTitle>
        <form action={createKindAction} className="space-y-4">
          <KindFields name="" allowPricelist={false} rows={[]} />
          <button type="submit" className={buttonClass("primary")}>
            เพิ่มชนิด
          </button>
        </form>
      </Card>
    </main>
  );
}

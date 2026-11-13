"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, INPUT_CLASS } from "@/components/ui";
import type { DocumentKind } from "@/db/schema";
import {
  aiReadable,
  DOCUMENT_KIND_LABELS,
  DOCUMENT_MIMES,
  formatBytesLimit,
  formatDuration,
  isDocumentMime,
  isVideoMime,
  kindAllowsMime,
  maxBytesFor,
} from "@/domain/document";
import { confirmUploadAction, moveDocumentAction, removeDocumentAction, requestUploadAction, updateDocumentAction } from "../actions";
import { captureCoverFromFile, CoverEditor, saveCover } from "./cover-picker";

/**
 * เอกสารต้นทาง — ลากวางได้ทีละหลายไฟล์ (ดูชนิดไฟล์ให้เอง) · รายการตามลำดับที่ผู้เรียนเห็นพร้อมป้าย "ใช้ทำอะไร" ·
 * คลิกไฟล์แล้วแก้ในแผงด้านขวา (ชื่อที่ผู้เรียนเห็น · ใช้ทำอะไร · น้ำหนัก · ปกคลิป · ลบ)
 *
 * ★ อัปทางเดิม: ขอลิงก์ → PUT ตรงเข้า R2 → ยืนยัน · วิดีโอได้ปกอัตโนมัติจากเฟรมที่ 10% ของไฟล์ในเครื่อง (ไม่ต้องพึ่ง CORS)
 */

export interface DocItem {
  id: number;
  fileName: string;
  kind: DocumentKind;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  durationSeconds: number | null;
  coverUrl: string | null;
  examWeight: number;
}

interface QueueItem {
  key: string;
  name: string;
  percent: number;
  status: "uploading" | "checking" | "done" | "error";
  error?: string;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

function roleOf(d: Pick<DocItem, "kind" | "mimeType">): { label: string; tone: string } {
  if (d.kind === "pricelist") return { label: aiReadable(d.mimeType) ? "Pricelist · AI ใช้ด้วย" : "Pricelist · ดูอย่างเดียว", tone: "bg-danger-soft text-danger" };
  if (isVideoMime(d.mimeType)) return { label: "ผู้เรียนต้องดู", tone: "bg-subtle text-ink-2" };
  if (aiReadable(d.mimeType)) return { label: "AI ใช้ออกข้อสอบ", tone: "bg-success-soft text-success" };
  return { label: "ผู้เรียนต้องอ่าน", tone: "bg-subtle text-ink-2" };
}

function metaOf(d: DocItem): string {
  if (isVideoMime(d.mimeType)) return `วิดีโอ ${formatDuration(d.durationSeconds ?? 0)} · ${mb(d.sizeBytes)}`;
  const type = d.mimeType === "application/pdf" ? "PDF" : "Excel";
  return `${type}${d.pageCount ? ` ${d.pageCount} หน้า` : ""} · ${mb(d.sizeBytes)}`;
}

export function DocsManager({
  setId,
  docs,
  editable,
  canSetCover,
  allowPricelist,
  customWeights,
}: {
  setId: number;
  docs: DocItem[];
  editable: boolean;
  canSetCover: boolean;
  allowPricelist: boolean;
  /** ชุดนี้เฉลี่ยข้อสอบแบบกำหนดเอง — แสดงช่องน้ำหนัก */
  customWeights: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<number | null>(docs[0]?.id ?? null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sel = docs.find((d) => d.id === selected) ?? docs[0];

  const videos = docs.filter((d) => isVideoMime(d.mimeType));
  const pdfs = docs.filter((d) => aiReadable(d.mimeType));
  const noCover = videos.filter((d) => !d.coverUrl).length;
  const minutes = Math.round(
    (videos.reduce((n, d) => n + (d.durationSeconds ?? 0), 0) + docs.filter((d) => !isVideoMime(d.mimeType)).reduce((n, d) => n + (d.pageCount ?? 0) * 60, 0)) / 60,
  );

  function patchQueue(key: string, patch: Partial<QueueItem>) {
    setQueue((q) => q.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  }

  async function uploadOne(file: File, key: string) {
    const fail = (error: string) => patchQueue(key, { status: "error", error });
    if (!isDocumentMime(file.type)) return fail("รับเฉพาะ PDF · Excel · วิดีโอ MP4");
    if (file.size > maxBytesFor(file.type)) return fail(`${isVideoMime(file.type) ? "วิดีโอ" : "ไฟล์"}ต้องไม่เกิน ${formatBytesLimit(maxBytesFor(file.type))}`);
    const req = await requestUploadAction({ setId, docKind: "catalog", fileName: file.name, mime: file.type, size: file.size }).catch(() => null);
    if (!req?.ok) return fail(req?.error ?? "ขอลิงก์อัปไม่สำเร็จ");
    const status = await put(req.uploadUrl, file, (percent) => patchQueue(key, { percent }));
    if (status < 200 || status >= 300) return fail(`อัปไม่สำเร็จ (${status || "เครือข่ายขาด"})`);
    patchQueue(key, { status: "checking", percent: 100 });
    const done = await confirmUploadAction({ setId, token: req.token }).catch(() => null);
    if (!done?.ok) return fail(done?.error ?? "ยืนยันไฟล์ไม่สำเร็จ");
    if (isVideoMime(file.type)) {
      const cover = await captureCoverFromFile(file);
      if (cover) await saveCover(setId, done.documentId, cover.blob, cover.ms).catch(() => null);
    }
    patchQueue(key, { status: "done" });
  }

  async function addFiles(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    const items = list.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, percent: 0, status: "uploading" as const }));
    setQueue((q) => [...q.filter((x) => x.status !== "done"), ...items]);
    // ทีละไฟล์ — วิดีโอใหญ่หลายไฟล์พร้อมกันแย่งแบนด์วิดท์จนช้าทุกไฟล์
    for (const [i, f] of list.entries()) await uploadOne(f, items[i].key);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <ul aria-label="ความพร้อม" className="flex flex-wrap gap-2 text-[12px]">
        <li className={`rounded-full px-2.5 py-1 font-semibold ${pdfs.length ? "bg-success-soft text-success" : "bg-warn-soft text-warn"}`}>
          {pdfs.length ? "✓ มี PDF ให้ AI ออกข้อสอบ" : "⚠ ยังไม่มี PDF — AI ออกข้อสอบไม่ได้"}
        </li>
        {noCover > 0 && <li className="rounded-full bg-warn-soft px-2.5 py-1 font-semibold text-warn">⚠ {noCover} คลิปยังไม่มีปก</li>}
        {docs.length > 0 && <li className="rounded-full border border-line px-2.5 py-1 text-ink-2">ผู้เรียนใช้เวลาราว {Math.max(1, minutes)} นาที</li>}
      </ul>

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[999_1_520px] space-y-3">
          {editable && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void addFiles(e.dataTransfer.files);
              }}
              className={`flex flex-wrap items-center gap-4 rounded-[13px] border-2 border-dashed p-5 ${dragOver ? "border-fg bg-subtle" : "border-ink-4 bg-raised"}`}
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-subtle text-fg">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 16V4M7 9l5-5 5 5" />
                  <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
                </svg>
              </span>
              <span className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
                <span className="text-[15px] font-semibold text-fg">ลากไฟล์มาวางตรงนี้ — ได้ทีละหลายไฟล์</span>
                <span className="text-[12px] text-muted">ระบบดูชนิดไฟล์ให้เอง: PDF · Excel ไม่เกิน 30 MB · วิดีโอ MP4 ไม่เกิน 2 GB (ได้ปกจากเฟรมในคลิปอัตโนมัติ)</span>
              </span>
              <Button type="button" variant="primary" onClick={() => fileInput.current?.click()}>
                เลือกไฟล์
              </Button>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={Object.keys(DOCUMENT_MIMES).join(",")}
                className="sr-only"
                tabIndex={-1}
                onChange={(e) => {
                  const files = e.currentTarget.files;
                  if (files) void addFiles(files);
                  e.currentTarget.value = "";
                }}
              />
            </div>
          )}

          {queue.length > 0 && (
            <ul aria-label="ไฟล์ที่กำลังอัป" className="space-y-1.5 rounded-[13px] border border-line bg-raised p-3">
              {queue.map((q) => (
                <li key={q.key} className="space-y-1 text-[13px]">
                  <div className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">{q.name}</span>
                    <span className={q.status === "error" ? "text-danger" : q.status === "done" ? "text-success" : "text-muted"}>
                      {q.status === "error" ? q.error : q.status === "done" ? "✓ อัปแล้ว" : q.status === "checking" ? "กำลังตรวจไฟล์…" : `${q.percent}%`}
                    </span>
                  </div>
                  {(q.status === "uploading" || q.status === "checking") && (
                    <span className="block h-1 overflow-hidden rounded-full bg-subtle">
                      <span className="block h-full bg-fg transition-[width]" style={{ width: `${q.percent}%` }} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="overflow-hidden rounded-[13px] border border-line bg-raised">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
              <span className="text-[14px] font-semibold text-fg">ลำดับที่ผู้เรียนเห็น</span>
              <span className="text-[12px] text-muted">
                {videos.length ? `${videos.length} วิดีโอ · ${formatDuration(videos.reduce((n, d) => n + (d.durationSeconds ?? 0), 0))}` : ""}
                {videos.length && docs.length > videos.length ? " · " : ""}
                {docs.length > videos.length ? `${docs.length - videos.length} เอกสาร` : ""}
              </span>
            </div>
            {docs.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-muted">ยังไม่มีเอกสาร{editable ? " — ลากไฟล์มาวางด้านบน" : ""}</p>
            ) : (
              <ol className="p-1.5">
                {docs.map((d, i) => {
                  const role = roleOf(d);
                  const video = isVideoMime(d.mimeType);
                  const current = sel?.id === d.id;
                  return (
                    <li key={d.id} className={`flex items-center gap-2 rounded-[10px] ${current ? "bg-subtle ring-1 ring-fg" : ""}`}>
                      {editable && (
                        <span className="flex shrink-0 flex-col pl-1">
                          <button
                            type="button"
                            aria-label={`เลื่อน ${d.fileName} ขึ้น`}
                            disabled={i === 0}
                            onClick={async () => {
                              await moveDocumentAction({ setId, documentId: d.id, direction: -1 });
                              router.refresh();
                            }}
                            className="flex size-7 items-center justify-center rounded text-muted hover:bg-line disabled:opacity-30"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            aria-label={`เลื่อน ${d.fileName} ลง`}
                            disabled={i === docs.length - 1}
                            onClick={async () => {
                              await moveDocumentAction({ setId, documentId: d.id, direction: 1 });
                              router.refresh();
                            }}
                            className="flex size-7 items-center justify-center rounded text-muted hover:bg-line disabled:opacity-30"
                          >
                            ▼
                          </button>
                        </span>
                      )}
                      <button type="button" onClick={() => setSelected(d.id)} aria-current={current ? "true" : undefined} className="flex min-h-16 min-w-0 flex-1 items-center gap-3 p-2 text-left">
                        <span className={`relative flex aspect-video w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-md ${video ? "bg-[#2c2e32] text-white" : "border border-line bg-subtle text-muted"}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- ภาพผ่าน route ที่ตรวจสิทธิ์ */}
                          {d.coverUrl && <img src={d.coverUrl} alt="" className="absolute inset-0 size-full object-cover" />}
                          {video ? (
                            <>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="relative" aria-hidden>
                                <path d="M8 5v14l11-7z" />
                              </svg>
                              <span className="absolute bottom-0.5 right-1 rounded-[3px] bg-black/60 px-1 text-[10px] leading-4">{formatDuration(d.durationSeconds ?? 0)}</span>
                            </>
                          ) : (
                            <span className="text-[10px] font-bold">{DOCUMENT_MIMES[d.mimeType as keyof typeof DOCUMENT_MIMES]?.toUpperCase() ?? "FILE"}</span>
                          )}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-[14px] font-semibold text-fg">{d.fileName}</span>
                          <span className="text-[12px] text-muted">{metaOf(d)}</span>
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${role.tone}`}>{role.label}</span>
                        {video && !d.coverUrl && <span className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn">ยังไม่มีปก</span>}
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>

        {sel && (
          <DocPanel
            key={sel.id}
            setId={setId}
            doc={sel}
            editable={editable}
            canSetCover={canSetCover}
            allowPricelist={allowPricelist}
            customWeights={customWeights}
          />
        )}
      </div>
    </div>
  );
}

/** แผงรายละเอียดของไฟล์ที่เลือก */
function DocPanel({
  setId,
  doc,
  editable,
  canSetCover,
  allowPricelist,
  customWeights,
}: {
  setId: number;
  doc: DocItem;
  editable: boolean;
  canSetCover: boolean;
  allowPricelist: boolean;
  customWeights: boolean;
}) {
  const router = useRouter();
  const video = isVideoMime(doc.mimeType);
  const [name, setName] = useState(doc.fileName);
  const [kind, setKind] = useState<DocumentKind>(doc.kind);
  const [weight, setWeight] = useState(doc.examWeight);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = name.trim() !== doc.fileName || kind !== doc.kind || weight !== doc.examWeight;

  useEffect(() => setMsg(null), [name, kind, weight]);

  async function save() {
    setBusy(true);
    const out = await updateDocumentAction({ setId, documentId: doc.id, fileName: name, kind, examWeight: weight }).catch(() => null);
    setBusy(false);
    if (!out?.ok) return setMsg({ ok: false, text: out?.error ?? "บันทึกไม่สำเร็จ" });
    setMsg({ ok: true, text: "✓ บันทึกแล้ว" });
    router.refresh();
  }

  const kinds: DocumentKind[] = ["catalog", "pricelist", "other"];
  const help =
    kind === "pricelist"
      ? "Pricelist — ผู้เรียนดูได้อย่างเดียว ประทับลายน้ำชื่อคนเปิดทุกหน้า · AI ใช้ออกข้อสอบเรื่องราคาด้วย (ระบบเทียบราคาให้)"
      : video
        ? "วิดีโอ — ผู้เรียนต้องดูครบทุกช่วง · AI ไม่ดูวิดีโอ (ใส่เนื้อหาที่อยากออกข้อสอบไว้ใน PDF)"
        : aiReadable(doc.mimeType)
          ? "ผู้เรียนต้องอ่านครบทุกหน้า · AI ใช้ออกข้อสอบ"
          : "ผู้เรียนเปิดดูได้ · AI ยังอ่านไฟล์ชนิดนี้ไม่ได้";

  return (
    <aside aria-label="รายละเอียดไฟล์ที่เลือก" className="min-w-0 flex-[1_1_340px] overflow-hidden rounded-[13px] border border-line bg-raised">
      <div className={`relative flex aspect-video items-center justify-center ${video ? "bg-[#2c2e32]" : "bg-canvas"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- ภาพผ่าน route ที่ตรวจสิทธิ์ */}
        {doc.coverUrl && <img src={doc.coverUrl} alt={`ปกของ ${doc.fileName}`} className="absolute inset-0 size-full object-cover" />}
        {!doc.coverUrl && (
          <span className={`text-[13px] ${video ? "text-[#c9cbcf]" : "text-muted"}`}>{video ? "ยังไม่มีปก" : metaOf(doc)}</span>
        )}
      </div>
      <div className="space-y-4 p-4">
        <label className="block space-y-1.5">
          <span className="text-[12px] text-ink-2">ชื่อที่ผู้เรียนเห็น</span>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={!editable} maxLength={200} className={INPUT_CLASS} />
        </label>

        <fieldset className="space-y-1.5">
          <legend className="text-[12px] text-ink-2">ใช้ทำอะไร</legend>
          <div className="flex gap-1 rounded-[10px] bg-subtle p-1">
            {kinds.map((k) => {
              const disabled = !editable || (k === "pricelist" && (!allowPricelist || (isDocumentMime(doc.mimeType) && !kindAllowsMime(k, doc.mimeType))));
              return (
                <label
                  key={k}
                  className={`flex min-h-9 flex-1 cursor-pointer items-center justify-center rounded-lg px-2 text-[13px] has-[:disabled]:cursor-not-allowed has-[:disabled]:text-ink-4 ${kind === k ? "bg-raised font-semibold text-fg shadow-sm" : "text-ink-2"}`}
                >
                  <input type="radio" name={`kind-${doc.id}`} value={k} checked={kind === k} disabled={disabled} onChange={() => setKind(k)} className="sr-only" />
                  {DOCUMENT_KIND_LABELS[k]}
                </label>
              );
            })}
          </div>
          <p className="text-[12px] leading-relaxed text-muted">{help}</p>
        </fieldset>

        {customWeights && aiReadable(doc.mimeType) && (
          <div className="space-y-1.5">
            <span className="text-[12px] text-ink-2">น้ำหนักตอนเฉลี่ยข้อสอบ (0 = ไม่ออกจากไฟล์นี้)</span>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center overflow-hidden rounded-lg border border-line-strong">
                <button type="button" aria-label="ลดน้ำหนัก" disabled={!editable || weight <= 0} onClick={() => setWeight((w) => w - 1)} className="size-9 hover:bg-subtle disabled:opacity-30">
                  −
                </button>
                <span className="w-8 text-center font-semibold">{weight}</span>
                <button type="button" aria-label="เพิ่มน้ำหนัก" disabled={!editable || weight >= 5} onClick={() => setWeight((w) => w + 1)} className="size-9 hover:bg-subtle disabled:opacity-30">
                  +
                </button>
              </span>
            </div>
          </div>
        )}

        {video && (
          <div className="space-y-1.5">
            <span className="text-[12px] text-ink-2">ปกคลิป</span>
            <CoverEditor setId={setId} documentId={doc.id} coverUrl={doc.coverUrl} canEdit={canSetCover} />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          {editable && (
            <Button type="button" variant="primary" size="sm" onClick={save} disabled={busy || !dirty}>
              {busy ? "กำลังบันทึก…" : "บันทึก"}
            </Button>
          )}
          {msg && <span className={`text-[12px] ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</span>}
          {editable && (
            <form action={removeDocumentAction} className="ml-auto" onSubmit={(e) => !confirm(`ลบ ${doc.fileName}?`) && e.preventDefault()}>
              <input type="hidden" name="setId" value={setId} />
              <input type="hidden" name="documentId" value={doc.id} />
              <input type="hidden" name="tab" value="docs" />
              <Button type="submit" size="sm" variant="danger-ghost">
                ลบไฟล์นี้
              </Button>
            </form>
          )}
        </div>
      </div>
    </aside>
  );
}

/** PUT ไฟล์ตรงเข้าที่เก็บพร้อมรายงานเปอร์เซ็นต์ · คืน HTTP status (0 = เครือข่ายขาด) */
function put(url: string, file: File, onProgress: (percent: number) => void): Promise<number> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.floor((e.loaded / e.total) * 100));
    xhr.onload = () => resolve(xhr.status);
    xhr.onerror = () => resolve(0);
    xhr.send(file);
  });
}

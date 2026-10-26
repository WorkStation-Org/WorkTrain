"use client";

import "@aws-amplify/ui-react/styles.css";
import { FaceLivenessDetectorCore } from "@aws-amplify/ui-react-liveness";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import {
  beginScanAction,
  devScanAction,
  finishScanAction,
  livenessCredentialsAction,
  startExamWithScanAction,
  startStudyWithScanAction,
} from "./actions";

/**
 * ปุ่มสแกนใบหน้า → ทำต่อตามจุดประสงค์ (ADR-0006)
 * - `aws`: FaceLivenessDetector (ให้ขยับหน้าตามจอ — กันรูปถ่าย) → เซิร์ฟเวอร์เทียบกับใบหน้าที่ลงทะเบียน
 * - `dev`: ปุ่มผ่านทันที (เครื่อง dev ที่ไม่มี AWS) · `off`: ปิดใช้ บอกตรง ๆ
 *
 * `confirmedScanId` = TG ตรวจภาพแล้วยืนยันว่าเป็นตัวจริง — เริ่มได้โดยไม่ต้องสแกนอีก (ครั้งเดียว · ภายใน 24 ชม.)
 */
export type ScanMode = "aws" | "dev" | "off";

export function ScanFlow(props: {
  mode: ScanMode;
  purpose: "study" | "exam" | "enroll";
  assignmentId?: number;
  label: string;
  confirmedScanId?: number | null;
}) {
  const router = useRouter();
  const [live, setLive] = useState<{ sessionId: string; region: string; ticket: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /** ได้ผลสแกนที่ผ่านแล้ว → ทำต่อตามจุดประสงค์ */
  async function proceed(scanId: number) {
    if (props.purpose === "study") {
      const out = await startStudyWithScanAction({ scanId });
      if (!out.ok) return setMessage(out.error);
      return router.refresh();
    }
    if (props.purpose === "exam" && props.assignmentId) {
      const out = await startExamWithScanAction({ assignmentId: props.assignmentId, scanId });
      if (!out.ok) return setMessage(out.error);
      return router.push(`/learn/${props.assignmentId}/exam/${out.attemptId}`);
    }
    router.refresh();
  }

  async function start() {
    setBusy(true);
    setMessage(null);
    try {
      if (props.mode === "dev") {
        const out = await devScanAction(props.purpose);
        if (!out.ok) return setMessage(out.error);
        return await proceed(out.scanId);
      }
      const out = await beginScanAction(props.purpose);
      if (!out.ok) return setMessage(out.error);
      setLive(out);
    } finally {
      setBusy(false);
    }
  }

  async function analysed() {
    if (!live) return;
    const out = await finishScanAction(live.ticket);
    setLive(null);
    if (!out.ok) return setMessage(out.error);
    if (!out.passed) return setMessage("สแกนไม่ผ่าน — ลองใหม่ในที่ที่มีแสงพอ หน้าตรง ไม่สวมแมสก์ (ไม่ผ่าน 3 ครั้งติด TG จะตรวจภาพให้)");
    if (out.enrollment === "pending") {
      setMessage("ส่งคำขอลงทะเบียนใบหน้าใหม่แล้ว — รอ TG อนุมัติ");
      return router.refresh();
    }
    await proceed(out.scanId);
  }

  if (props.mode === "off") {
    return <p className="text-[13px] text-danger">ยังไม่ได้ตั้งระบบสแกนใบหน้าบนเซิร์ฟเวอร์นี้ — ติดต่อ TG</p>;
  }

  if (live) {
    return (
      <div className="overflow-hidden rounded-lg border border-line">
        <FaceLivenessDetectorCore
          sessionId={live.sessionId}
          region={live.region}
          onAnalysisComplete={analysed}
          onUserCancel={() => setLive(null)}
          onError={(e) => {
            setLive(null);
            setMessage(`กล้องหรือการสแกนมีปัญหา (${e.state}) — ถ้าเครื่องนี้ไม่มีกล้อง ให้เปิดหน้านี้บนมือถือผ่าน LINE`);
          }}
          config={{
            credentialProvider: async () => {
              const c = await livenessCredentialsAction();
              return { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, sessionToken: c.sessionToken, expiration: new Date(c.expiration) };
            },
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="primary" disabled={busy} onClick={start}>
          {busy ? "กำลังเปิดกล้อง…" : props.mode === "dev" ? `${props.label} (dev — ข้ามกล้อง)` : props.label}
        </Button>
        {props.confirmedScanId && (
          <Button type="button" disabled={busy} onClick={() => proceed(props.confirmedScanId!)}>
            TG ยืนยันตัวตนแล้ว — เริ่มโดยไม่ต้องสแกน
          </Button>
        )}
      </div>
      {message && <p className="text-[13px] text-danger">{message}</p>}
    </div>
  );
}

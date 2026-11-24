"use client";

import type { CvDescribeKind, CvLanguage } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Button, Icon, useToast } from "@unimate/ui";
import { useEffect, useRef, useState } from "react";
import { EdgeNotice } from "@/components/EdgeNotice";
import type { EdgeError } from "@/lib/edge";
import { cvDescribe } from "@/lib/edge-client";
import { getBrowserClient } from "@/lib/supabase/browser";

/** Splits AI text into experience bullets: one per line, bullet markers stripped, max 8 x 300 characters. */
export const toBullets = (text: string): string[] =>
  text
    .split("\n")
    .map((x) => x.replace(/^\s*[-*•]\s*/, "").trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 8);

/**
 * "Write with AI" for one description field. The result is shown as a PREVIEW; the field only changes when the user accepts.
 * `lines` fields (bullets) are split into at most 8 bullets of 300 characters.
 */
export function AiWrite({ kind, language, context, current, lines, onText }: { kind: CvDescribeKind; language: CvLanguage; context: Record<string, string>; current: string; lines?: boolean; onText: (text: string) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<EdgeError | string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const run = async () => {
    const ctx = Object.fromEntries(Object.entries(context).map(([k, v]) => [k, v.trim().slice(0, 200)]).filter(([, v]) => v));
    // the server refuses to write from nothing (no invented facts); say so instead of a generic failure
    if (!Object.keys(ctx).length && !current.trim()) return setError(t("career.cv.ai.needContext"));
    setBusy(true);
    setError(null);
    const r = await cvDescribe({ kind, language, context: ctx, ...(current.trim() ? { current: current.trim().slice(0, 1500) } : {}) });
    setBusy(false);
    if (r.ok) setPreview(r.data.text);
    else setError(r.error);
  };
  const shown = preview === null ? "" : lines ? toBullets(preview).join("\n") : preview;
  return (
    <div className="stack" style={{ minWidth: 0, gap: 4 }}>
      <div className="row">
        <Button size="sm" variant="secondary" loading={busy} onClick={() => void run()}>
          <Icon name="ai-chat" size="sm" />
          {busy ? t("career.cv.ai.working") : current.trim() ? t("career.cv.ai.improve") : t("career.cv.ai.write")}
        </Button>
      </div>
      {preview !== null ? (
        <div className="stack" role="group" aria-label={t("cvWeb.ai.preview")} style={{ gap: 6, padding: 10, border: "1px dashed var(--primary)", borderRadius: "var(--radius-md)" }}>
          <strong style={{ fontSize: "var(--text-sm)" }}>{t("cvWeb.ai.preview")}</strong>
          <p className="ds" style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{shown}</p>
          <span className="um-muted" style={{ fontSize: "var(--text-xs)" }}>
            {lines ? t("cvWeb.ai.bulletsHint") : t("cvWeb.ai.previewHint")}
          </span>
          <div className="row">
            <Button
              size="sm"
              onClick={() => {
                onText(shown);
                setPreview(null);
              }}
            >
              {t("cvWeb.ai.accept")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setPreview(null)}>
              {t("cvWeb.ai.discard")}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? typeof error === "string" ? <p className="err-box" role="alert">{error}</p> : <EdgeNotice error={error} /> : null}
    </div>
  );
}

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Center-crop to a square, resize to ~400px and re-encode as JPEG. */
async function squareJpeg(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(400, side);
  canvas.getContext("2d")!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/jpeg", 0.85));
}

/** Optional CV photo in the public 'avatars' bucket at `<uid>/cv-<uuid>.jpg` (owner-only writes). */
export const CV_PHOTO_URL_TTL_S = 600;
export function CvPhoto({ uid, url, path, onChange }: { uid: string; url: string; path: string; onChange: (p: { photoUrl: string; photoPath: string }) => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [signed, setSigned] = useState("");
  useEffect(() => {
    let live = true;
    if (!path) setSigned("");
    else void getBrowserClient().storage.from("cv-photos").createSignedUrl(path, CV_PHOTO_URL_TTL_S).then((r) => live && setSigned(r.data?.signedUrl ?? ""));
    return () => {
      live = false;
    };
  }, [path]);
  const shown = path ? signed : url; // legacy https photoUrl still previews
  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type) || file.size > MAX_PHOTO_BYTES) return toast(t("mobile.profile.avatarFailed"), "error");
    setBusy(true);
    try {
      const sb = getBrowserClient();
      const next = `${uid}/${crypto.randomUUID()}.jpg`;
      const up = await sb.storage.from("cv-photos").upload(next, await squareJpeg(file), { contentType: "image/jpeg", upsert: false });
      if (up.error) throw new Error(up.error.message);
      onChange({ photoUrl: "", photoPath: next });
    } catch {
      toast(t("mobile.profile.avatarFailed"), "error");
    } finally {
      setBusy(false);
    }
  };
  const remove = () => {
    onChange({ photoUrl: "", photoPath: "" });
  };
  return (
    <div className="row" style={{ gap: 12, minWidth: 0 }}>
      {shown ? (
        // eslint-disable-next-line @next/next/no-img-element -- small user photo (signed URL or legacy https link)
        <img src={shown} alt="" width={64} height={64} style={{ borderRadius: "50%", objectFit: "cover", flex: "none" }} />
      ) : null}
      <div className="stack" style={{ minWidth: 0, gap: 4 }}>
        <div className="row">
          <input ref={input} type="file" accept={PHOTO_TYPES.join(",")} hidden onChange={(e) => void pick(e.target.files?.[0])} />
          <Button size="sm" variant="secondary" loading={busy} onClick={() => input.current?.click()}>
            {t("career.cv.photo.add")}
          </Button>
          {shown || path ? (
            <Button size="sm" variant="danger" disabled={busy} onClick={remove}>
              {t("career.cv.photo.remove")}
            </Button>
          ) : null}
        </div>
        <span className="um-muted" style={{ fontSize: "var(--text-sm)" }}>
          {t("career.cv.photo.hint")}
        </span>
      </div>
    </div>
  );
}

"use client";

import { CV_LANGUAGES, cvMissingRequired, resolveCvDesign, type CvData, type CvDesign, type CvLanguage } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Button, Card, Dialog, EmptyState, ErrorState, Icon, Input, Skeleton, useToast } from "@unimate/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useUser } from "@/components/user";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { CV_UNREADABLE, getCv, type CvDoc } from "./api";
import { AssistantPanel } from "./AssistantPanel";
import { saveCvGuarded, type SaveOutcome } from "./cv-autosave";
import { initHistory, pushHistory, redo, undo, type History } from "./cv-history";
import { CvForm } from "./CvForm";
import { CvPreview, useCvPhotoUrl, type CvZoom } from "./cv-preview";
import { patchDesign } from "./cv-sections";
import { CustomisePanel } from "./CustomisePanel";
import { ImportDialog } from "./ImportDialog";
import { Chips } from "./parts";
import { TemplateGallery } from "./TemplateGallery";

interface Snap {
  data: CvData;
  design: CvDesign;
  template: string;
}
type Status = "saved" | "saving" | "unsaved" | "offline" | "error" | "conflict";
type Side = "content" | "customise" | "assistant";

const AUTOSAVE_MS = 1200;
const COALESCE_MS = 800;
/** Style keys a template switch resets (section order and hidden sections are the user's structure and stay). */
const STYLE_KEYS = ["font", "fontSize", "headingScale", "primary", "accent", "background", "spacing", "margins", "columns", "showPhoto", "photoShape", "mode"] as const;

const cleanForSave = (d: CvData): CvData => ({ ...d, skills: d.skills.filter((s) => s.name.trim() !== "") });

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
function useWide(): boolean {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 900px)");
    const on = () => setWide(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

function EditorInner({ doc, onReload }: { doc: CvDoc; onReload: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const user = useUser();
  const { toast } = useToast();
  const wide = useWide();
  const sb = useRef(getBrowserClient()).current;

  const [hist, setHist] = useState<History<Snap>>(() => initHistory({ data: doc.data, design: doc.design, template: doc.template }));
  const [title, setTitle] = useState(doc.title);
  const [language, setLanguage] = useState<CvLanguage>(doc.language);
  const [rev, setRev] = useState(0);
  const [status, setStatus] = useState<Status>("saved");
  const [side, setSide] = useState<Side>("content");
  const [mobileTab, setMobileTab] = useState<"edit" | "preview">("edit");
  const [zoom, setZoom] = useState<CvZoom>("fit");
  const [gallery, setGallery] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exportBlocked, setExportBlocked] = useState(false);

  const snap = hist.present;
  const resolved = resolveCvDesign(snap.template, snap.design);

  // ---- save machinery: everything the async code needs lives in refs
  const latest = useRef({ snap, title, language });
  latest.current = { snap, title, language };
  const histRef = useRef(hist);
  histRef.current = hist;
  const savedSnap = useRef(JSON.stringify(hist.present));
  const version = useRef(0);
  const savedVersion = useRef(0);
  const loadedAt = useRef(doc.updatedAt);
  const inflight = useRef<Promise<boolean> | null>(null);
  const conflict = useRef(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const lastPush = useRef(0);

  // cv-photos: never delete an object undo could restore while the editor is open; on unmount delete uploads nobody references.
  // Only objects uploaded in THIS session are deletable: the loaded photo may be shared with a duplicated CV.
  const seenPhotos = useRef(new Set<string>());
  const savedPhoto = useRef(doc.data.personal.photoPath);

  const flush = useCallback(async (): Promise<boolean> => {
    for (;;) {
      if (inflight.current) {
        await inflight.current;
        continue;
      }
      if (conflict.current) return false;
      if (version.current === savedVersion.current) return true;
      const v = version.current;
      const { snap: s, title: ti, language: lg } = latest.current;
      setStatus("saving");
      const run = async (): Promise<boolean> => {
        const o: SaveOutcome = await saveCvGuarded(sb, doc.id, { title: ti, language: lg, template: s.template as never, data: cleanForSave(s.data), design: s.design }, loadedAt.current);
        if (o.kind === "saved") {
          loadedAt.current = o.updatedAt;
          savedVersion.current = v;
          savedPhoto.current = s.data.personal.photoPath;
          savedSnap.current = JSON.stringify(s);
          setStatus(version.current === v ? "saved" : "unsaved");
          return true;
        }
        if (o.kind === "conflict") {
          conflict.current = true;
          setStatus("conflict");
          setConflictOpen(true);
        } else if (o.kind === "offline") setStatus("offline");
        else {
          setStatus("error");
          toast(o.kind === "empty" ? t("cvWeb.editor.emptyOverwrite") : o.kind === "too_large" ? t("career.cv.tooLarge") : o.kind === "invalid" ? t("career.cv.invalid") : t("career.cv.saveFailed"), "error");
        }
        return false;
      };
      inflight.current = run();
      const ok = await inflight.current;
      inflight.current = null;
      if (!ok) return false;
    }
  }, [doc.id, sb, t, toast]);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const markDirty = () => {
    version.current++;
    setStatus((s) => (s === "conflict" ? s : "unsaved"));
  };
  const commit = (fn: (s: Snap) => Snap, structural = false) => {
    const now = Date.now();
    const co = !structural && now - lastPush.current < COALESCE_MS;
    lastPush.current = structural ? 0 : now;
    setHist((h) => pushHistory(h, fn(h.present), co));
    if (structural) setRev((r) => r + 1);
    markDirty();
  };
  const jump = (fn: (h: History<Snap>) => History<Snap>) => {
    setHist(fn);
    setRev((r) => r + 1);
    lastPush.current = 0;
    if (JSON.stringify(fn(histRef.current).present) !== savedSnap.current) markDirty(); // undo back to the saved state needs no save
  };
  const updateData = (fn: (cv: CvData) => CvData, structural = false) => commit((s) => ({ ...s, data: fn(s.data) }), structural);
  const setDesign = (patch: Partial<Record<keyof CvDesign, unknown>>, structural = false) => commit((s) => ({ ...s, design: patchDesign(s.design, patch) }), structural);

  // debounced autosave; retries while offline
  useEffect(() => {
    if (status !== "unsaved" && status !== "offline") return;
    const id = setTimeout(() => void flushRef.current(), status === "offline" ? 15000 : AUTOSAVE_MS);
    return () => clearTimeout(id);
  }, [status, hist, title, language]);
  useEffect(() => {
    const online = () => void flushRef.current();
    const hide = () => document.visibilityState === "hidden" && void flushRef.current();
    const warn = (e: BeforeUnloadEvent) => {
      if (version.current !== savedVersion.current) {
        void flushRef.current();
        e.preventDefault();
      }
    };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("beforeunload", warn);
    const up = seenPhotos.current;
    return () => {
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("beforeunload", warn);
      void flushRef.current(); // route change: flush what is pending
      const keep = new Set([savedPhoto.current, latest.current.snap.data.personal.photoPath]);
      const orphans = [...up].filter((p) => !keep.has(p));
      if (orphans.length) void sb.storage.from("cv-photos").remove(orphans);
    };
  }, [sb]);

  // Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z, Ctrl+Y
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) jump(undo);
      else if ((k === "z" && e.shiftKey) || k === "y") jump(redo);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jump only uses stable setters and refs
  }, []);

  const preview = useDebounced({ data: snap.data, design: snap.design, template: snap.template, language }, 150);
  const photoSrc = useCvPhotoUrl(preview.data.personal.photoPath, preview.data.personal.photoUrl);

  const missing = cvMissingRequired(snap.data);
  const exportPdf = async (mode: "designed" | "ats") => {
    setExportBlocked(missing.length > 0);
    if (missing.length) return;
    if (await flush()) router.push(`/career/cv/${doc.id}/print?autoprint=1${mode === "ats" ? "&mode=ats" : ""}`);
  };
  const pickTemplate = (id: string) => {
    setGallery(false);
    if (id === snap.template) return;
    commit((s) => ({ ...s, template: id, design: patchDesign(s.design, Object.fromEntries(STYLE_KEYS.map((k) => [k, undefined]))) }), true);
  };
  const statusText: Record<Status, string> = {
    saved: t("cvWeb.editor.saved"),
    saving: t("cvWeb.editor.saving"),
    unsaved: t("cvWeb.editor.unsaved"),
    offline: t("cvWeb.editor.offline"),
    error: t("cvWeb.editor.failed"),
    conflict: t("cvWeb.editor.conflictTitle"),
  };
  const zoomBy = (d: number) => setZoom((z) => Math.max(0.4, Math.min(2, Math.round(((typeof z === "number" ? z : 0.7) + d) * 10) / 10)));

  const toolbar = (
    <div className="row" role="toolbar" aria-label={t("cvWeb.editor.toolbar")} style={{ gap: 8, alignItems: "flex-end" }}>
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
        <Input
          label={t("career.cv.title")}
          value={title}
          maxLength={120}
          onChange={(e) => {
            setTitle(e.target.value);
            markDirty();
          }}
        />
      </div>
      <Button variant="secondary" onClick={() => setGallery(true)}>
        {t("cvWeb.gallery.change")}
      </Button>
      <Button variant="secondary" disabled={hist.past.length === 0} onClick={() => jump(undo)} aria-label={t("cvWeb.editor.undo")}>
        ↶ {t("cvWeb.editor.undo")}
      </Button>
      <Button variant="secondary" disabled={hist.future.length === 0} onClick={() => jump(redo)} aria-label={t("cvWeb.editor.redo")}>
        ↷ {t("cvWeb.editor.redo")}
      </Button>
      <Button onClick={() => void exportPdf("designed")}>
        <Icon name="download" size="sm" />
        {t("cvWeb.editor.designed")}
      </Button>
      <Button variant="secondary" onClick={() => void exportPdf("ats")}>
        <Icon name="download" size="sm" />
        {t("cvWeb.editor.atsExport")}
      </Button>
      <span role="status" aria-live="polite" className={status === "offline" || status === "error" || status === "conflict" ? "warn-box" : "um-muted"} style={{ fontSize: "var(--text-sm)" }}>
        {statusText[status]}
      </span>
    </div>
  );

  const editPane = (
    <div className="stack" style={{ minWidth: 0 }}>
      <Chips
        label={t("career.cv.language")}
        value={language}
        onChange={(v) => {
          setLanguage(v);
          markDirty();
        }}
        options={CV_LANGUAGES.map((l) => ({ value: l, label: t(`career.lang.${l}`) }))}
      />
      <Chips
        label={t("cvWeb.editor.sections")}
        value={side}
        onChange={setSide}
        options={[
          { value: "content" as const, label: t("cvWeb.editor.sections") },
          { value: "customise" as const, label: t("cvWeb.editor.customise") },
          { value: "assistant" as const, label: t("cvWeb.editor.assistant") },
        ]}
      />
      {side === "content" ? (
        <>
          <div className="row">
            <Button size="sm" variant="secondary" onClick={() => setImporting(true)}>
              {t("cvWeb.imp.open")}
            </Button>
          </div>
          {exportBlocked && missing.length ? (
            <p className="err-box" role="alert">
              {`${missing.map((k) => t(`career.cv.field.${k}`)).join(", ")}: ${t("career.cv.required")}`}
            </p>
          ) : null}
          <CvForm
            cv={snap.data}
            language={language}
            uid={user.id}
            rev={rev}
            order={resolved.sectionOrder}
            hidden={resolved.hidden}
            exportBlocked={exportBlocked}
            update={updateData}
            setOrder={(order) => setDesign({ sectionOrder: order }, true)}
            setHidden={(hidden) => setDesign({ hidden }, true)}
            onPhotoUploaded={(p) => seenPhotos.current.add(p)}
          />
        </>
      ) : null}
      {side === "customise" ? (
        <Card>
          <CustomisePanel resolved={resolved} onChange={(patch) => setDesign(patch)} onReset={() => commit((s) => ({ ...s, design: patchDesign({}, { sectionOrder: s.design.sectionOrder, hidden: s.design.hidden }) }), true)} />
        </Card>
      ) : null}
      {side === "assistant" ? (
        <Card>
          <AssistantPanel cvId={doc.id} cv={snap.data} language={language} ensureSaved={flush} onApplySummary={(text) => updateData((c) => ({ ...c, summary: text.slice(0, 1500) }), true)} />
        </Card>
      ) : null}
    </div>
  );

  const previewPane = (
    <div className="stack" style={{ minWidth: 0 }}>
      <div className="row" role="group" aria-label={t("cvWeb.editor.live")} style={{ gap: 6 }}>
        <Button size="sm" variant="secondary" onClick={() => zoomBy(-0.1)} aria-label={t("cvWeb.editor.zoomOut")}>
          −
        </Button>
        <Button size="sm" variant="secondary" onClick={() => zoomBy(0.1)} aria-label={t("cvWeb.editor.zoomIn")}>
          +
        </Button>
        <Button size="sm" variant={zoom === "fit" ? "primary" : "secondary"} aria-pressed={zoom === "fit"} onClick={() => setZoom("fit")}>
          {t("cvWeb.editor.fit")}
        </Button>
        {typeof zoom === "number" ? <span className="um-muted">{`${Math.round(zoom * 100)}%`}</span> : null}
      </div>
      <p className="um-muted" style={{ fontSize: "var(--text-xs)" }}>
        {t("cvWeb.editor.pageNote")}
      </p>
      <CvPreview cv={preview.data} template={preview.template} design={preview.design} language={preview.language} photoSrc={photoSrc} zoom={zoom} />
    </div>
  );

  return (
    <div className="stack-lg">
      <p>
        <Link href="/career">← {t("cvWeb.editor.back")}</Link>
      </p>
      {toolbar}
      {wide ? (
        <div style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", alignItems: "start" }}>
          <div style={{ minWidth: 0 }}>{editPane}</div>
          <div style={{ position: "sticky", top: 8, maxHeight: "calc(100dvh - 16px)", overflow: "auto", minWidth: 0 }}>{previewPane}</div>
        </div>
      ) : (
        <>
          <Chips label={t("cvWeb.editor.tabs")} value={mobileTab} onChange={setMobileTab} options={[{ value: "edit" as const, label: t("cvWeb.editor.tabEdit") }, { value: "preview" as const, label: t("cvWeb.editor.tabPreview") }]} />
          {mobileTab === "edit" ? editPane : previewPane}
        </>
      )}

      <Dialog open={gallery} title={t("cvWeb.gallery.title")} onClose={() => setGallery(false)} actions={<Button variant="secondary" onClick={() => setGallery(false)}>{t("common.cancel")}</Button>}>
        <div className="cv-wide">
          <TemplateGallery value={resolved ? snap.template : undefined} language={language} onPick={pickTemplate} />
        </div>
      </Dialog>
      <ImportDialog open={importing} cv={snap.data} onClose={() => setImporting(false)} onApply={(next) => updateData(() => next, true)} />
      <Dialog
        open={conflictOpen}
        title={t("cvWeb.editor.conflictTitle")}
        onClose={() => setConflictOpen(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConflictOpen(false)}>
              {t("common.close")}
            </Button>
            <Button onClick={onReload}>{t("cvWeb.editor.reload")}</Button>
          </>
        }
      >
        <p>{t("cvWeb.editor.conflictBody")}</p>
      </Dialog>
    </div>
  );
}

export function CvEditor({ id }: { id: string }) {
  const { t } = useI18n();
  const doc = useAsync(() => getCv(getBrowserClient(), id), [id]);
  const unreadable = doc.error === CV_UNREADABLE;
  const back = (
    <p>
      <Link href="/career">← {t("career.title")}</Link>
    </p>
  );
  if (doc.loading && !doc.data) {
    return (
      <div className="stack-lg">
        {back}
        <Skeleton height={220} />
      </div>
    );
  }
  if (unreadable) {
    return (
      <div className="stack-lg">
        {back}
        <ErrorState title={t("cvWeb.editor.unreadableTitle")} description={t("cvWeb.editor.unreadableBody")} />
      </div>
    );
  }
  if (doc.error && !doc.data) {
    return (
      <div className="stack-lg">
        {back}
        <ErrorState title={t("career.loadFailed")} description={doc.error} action={<Button onClick={doc.reload}>{t("common.retry")}</Button>} />
      </div>
    );
  }
  if (!doc.data) {
    return (
      <div className="stack-lg">
        {back}
        <EmptyState title={t("career.notFound")} />
      </div>
    );
  }
  return <EditorInner key={doc.data.updatedAt} doc={doc.data} onReload={doc.reload} />;
}

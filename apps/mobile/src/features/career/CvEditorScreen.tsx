import {
  CV_LANGUAGES,
  CV_SECTION_ITEMS_MAX,
  CvCertificateSchema,
  CvCourseSchema,
  CvEducationSchema,
  CvExperienceSchema,
  CvHobbySchema,
  CvHonourSchema,
  CvActivitySchema,
  CvLanguageSchema,
  CvProjectSchema,
  CvPublicationSchema,
  CvReferenceSchema,
  CvVolunteerSchema,
  cvCompleteness,
  cvTemplateMeta,
  type CvData,
  type CvDesign,
  type CvFeedback,
  type CvLanguage,
  type CvTemplate,
} from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EdgeNotice } from "../../components/EdgeNotice";
import { Icon } from "../../components/Icon";
import { PickerField } from "../../components/PickerField";
import { ProgressRing } from "../../components/ProgressRing";
import { AppText, Badge, Button, Card, Dialog, EmptyState, ErrorState, Input, PressableScale, Screen, ScreenHeader, Segmented, Skeleton, useOnline, useToast } from "../../components/ui";
import type { EdgeError } from "../../lib/edge";
import { cvFeedback } from "../../lib/edge-client";
import { kv } from "../../lib/storage";
import { useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { CONTENT_MAX } from "../../theme/tokens";
import { CV_UNREADABLE, deleteCv, duplicateCv, getCv, myTracking, saveCvGuarded } from "./api";
import { CvCustomise } from "./CvCustomise";
import { ACTIVITY, AI, AiWrite, CERT, COURSE, EDU, EXP, Entries, HOBBY, HONOUR, LANG, PROJ, PUBLICATION, PhotoField, Proposal, REFERENCE, SKILL, Socials, VOLUNTEER, type Obj } from "./CvEntries";
import { buildCvHtml, exportCvPdf, previewCv } from "./cv-export";
import { CvWebPreview } from "./CvWebPreview";
import {
  IMPORT_FIELDS,
  draftKey,
  historyInit,
  historyPush,
  historyRedo,
  historyUndo,
  mergeEducation,
  mergeImport,
  orphanPaths,
  parseDraft,
  serializeDraft,
  toggleIn,
  type CvDocState,
  type History,
  type ImportField,
} from "./cv-helpers";
import { TemplateGallery } from "./TemplatePicker";

const AUTOSAVE_MS = 1500;
const COALESCE_MS = 1200;
type Status = "saved" | "saving" | "unsaved" | "offline" | "error" | "conflict";
type ListKey = "education" | "experience" | "languages" | "projects" | "certificates" | "hobbies" | "honours" | "activities" | "volunteer" | "publications" | "courses" | "references";
const snapshot = (d: CvDocState): string => JSON.stringify(d);

function FeedbackPanel({ cvId, language, ensureSaved, onApplySummary }: { cvId: string; language: CvLanguage; ensureSaved: () => Promise<boolean>; onApplySummary: (v: string) => void }) {
  const { t } = useI18n();
  const { supabase: sb } = useUser();
  const tracked = useAsync(() => myTracking(sb), [sb]);
  const [target, setTarget] = useState("");
  const [lang, setLang] = useState<CvLanguage>(language);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<EdgeError | null>(null);
  const [out, setOut] = useState<{ feedback: CvFeedback; cached: boolean } | null>(null);
  const [proposal, setProposal] = useState<string | null>(null);
  const listings = (tracked.data ?? []).filter((i) => i.listingState === "published" && i.opportunityId);
  const run = async () => {
    setBusy(true);
    setError(null);
    setProposal(null);
    if (!(await ensureSaved())) return setBusy(false);
    const r = await cvFeedback(cvId, { ...(target ? { opportunityId: target } : {}), outputLanguage: lang });
    setBusy(false);
    if (r.ok) setOut(r.data);
    else setError(r.error);
  };
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name="ai-chat" size="md" />
        <AppText variant="heading">{t("career.ai.cvTitle")}</AppText>
      </View>
      <AppText muted>{t("career.ai.cvBody")}</AppText>
      {listings.length ? (
        <PickerField
          label={t("career.ai.target")}
          sections={[{ data: [{ id: "", label: t("career.ai.targetNone") }, ...listings.map((l) => ({ id: l.opportunityId!, label: `${l.title} · ${l.organization}` }))] }]}
          value={target}
          onChange={setTarget}
        />
      ) : null}
      <Segmented label={t("career.ai.language")} value={lang} onChange={setLang} options={CV_LANGUAGES.map((l) => ({ value: l, label: t(`career.lang.${l}`) }))} />
      <Button title={busy ? t("career.ai.working") : t("career.ai.action")} loading={busy} onPress={() => void run()} />
      {error ? <EdgeNotice error={error} /> : null}
      {out ? (
        <View style={{ gap: 8 }}>
          {out.cached ? (
            <AppText variant="caption" muted>
              {t("career.ai.cached")}
            </AppText>
          ) : null}
          <AppText variant="label">{t("career.ai.overall")}</AppText>
          <AppText>{out.feedback.overall}</AppText>
          <AppText variant="label">{t("career.ai.strengths")}</AppText>
          {out.feedback.strengths.map((s, i) => (
            <AppText key={`s${i}`}>{`• ${s}`}</AppText>
          ))}
          <AppText variant="label">{t("career.ai.improvements")}</AppText>
          {out.feedback.improvements.map((s, i) => (
            <View key={`i${i}`} style={{ gap: 4 }}>
              <Badge tone="info">{s.section === "general" ? t("career.ai.sectionGeneral") : t(`career.cv.section.${s.section}`)}</Badge>
              <AppText>{s.suggestion}</AppText>
            </View>
          ))}
          {out.feedback.missingKeywords.length ? (
            <>
              <AppText variant="label">{t("career.ai.keywords")}</AppText>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                {out.feedback.missingKeywords.map((k) => (
                  <Badge key={k} tone="warning">
                    {k}
                  </Badge>
                ))}
              </View>
            </>
          ) : null}
          {out.feedback.rewrittenSummary ? (
            <>
              <AppText variant="label">{t("career.ai.summary")}</AppText>
              {proposal === null ? (
                <>
                  <AppText muted>{out.feedback.rewrittenSummary}</AppText>
                  <View style={{ alignItems: "flex-start" }}>
                    <Button small variant="secondary" title={t("cvMobile.useSummary")} onPress={() => setProposal(out.feedback.rewrittenSummary)} />
                  </View>
                </>
              ) : (
                <Proposal
                  text={proposal}
                  onAccept={() => {
                    onApplySummary(proposal.slice(0, 1500));
                    setProposal(null);
                  }}
                  onDiscard={() => setProposal(null)}
                />
              )}
            </>
          ) : null}
          <AppText variant="caption" muted>
            {t("career.ai.disclaimer")}
          </AppText>
        </View>
      ) : null}
    </Card>
  );
}

/** Profile import: only the user's own account data; ticked fields; fills empty fields unless overwrite is ticked; the profile is never modified. */
function ImportDialog({ open, onClose, onApply }: { open: boolean; onClose: () => void; onApply: (source: Partial<Record<ImportField, string>>, picked: ImportField[], overwrite: boolean, edu: { institution: string; field: string } | null) => void }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { user, profile, supabase: sb } = useUser();
  // Own profile only: university name and, when set, the major with its faculty (same reads as the profile and BOSS.AZ screens).
  const eduInfo = useAsync(async () => {
    const uni = profile?.university_id ? (await sb.from("universities").select("name").eq("id", profile.university_id).maybeSingle<{ name: string }>()).data?.name ?? "" : "";
    const major = profile?.major_id ? (await sb.from("majors").select("name, faculties(name)").eq("id", profile.major_id).maybeSingle<{ name: string; faculties: { name: string } | { name: string }[] | null }>()).data : null;
    const fac = Array.isArray(major?.faculties) ? major?.faculties[0]?.name : major?.faculties?.name;
    return { institution: uni, field: [major?.name, fac].filter(Boolean).join(", ") };
  }, [profile?.university_id, profile?.major_id, sb], open);
  const edu = eduInfo.data?.institution ? eduInfo.data : null;
  const [pickEdu, setPickEdu] = useState(true);
  const source: Partial<Record<ImportField, string>> = { fullName: profile?.display_name ?? "", email: user.email ?? "", phone: user.phone ?? "" };
  const available = IMPORT_FIELDS.filter((k) => (source[k] ?? "").trim());
  const [picked, setPicked] = useState<ImportField[]>([...IMPORT_FIELDS]);
  const [overwrite, setOverwrite] = useState(false);
  const box = (on: boolean, label: string, onPress: () => void) => (
    <PressableScale accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={label} onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 }}>
      <Icon name={on ? "check" : "add"} size="sm" color={on ? theme.success : theme.textMuted} />
      <AppText style={{ flex: 1 }}>{label}</AppText>
    </PressableScale>
  );
  return (
    <Dialog
      open={open}
      title={t("cvMobile.importTitle")}
      onClose={onClose}
      actions={
        <>
          <Button small title={t("cvMobile.importApply")} disabled={!available.some((k) => picked.includes(k)) && !(edu && pickEdu)} onPress={() => onApply(source, picked, overwrite, edu && pickEdu ? edu : null)} />
          <Button small variant="secondary" title={t("common.cancel")} onPress={onClose} />
        </>
      }
    >
      <AppText variant="caption" muted>
        {t("cvMobile.importBody")}
      </AppText>
      {available.length === 0 && !edu ? <AppText>{t("cvMobile.importNothing")}</AppText> : null}
      {available.map((k) => box(picked.includes(k), `${t(`career.cv.field.${k}`)}: ${source[k]}`, () => setPicked((p) => toggleIn(p, k))))}
      {edu ? box(pickEdu, `${t("career.cv.section.education")}: ${[edu.institution, edu.field].filter(Boolean).join(" - ")}`, () => setPickEdu((v) => !v)) : null}
      {box(overwrite, t("cvMobile.importOverwrite"), () => setOverwrite((v) => !v))}
    </Dialog>
  );
}

export function CvEditorScreen({ id }: { id: string }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const router = useRouter();
  const { toast } = useToast();
  const online = useOnline();
  const { user, supabase: sb } = useUser();
  const doc = useAsync(() => getCv(sb, id), [sb, id]);
  const [hist, setHist] = useState<History<CvDocState> | null>(null);
  const [status, setStatus] = useState<Status>("saved");
  const [statusNote, setStatusNote] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [rev, setRev] = useState(0);
  const [gallery, setGallery] = useState(false);
  const [customise, setCustomise] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Live copies for timers, AppState and unmount (closures would be stale there).
  const cur = hist?.present ?? null;
  const curRef = useRef<CvDocState | null>(null);
  curRef.current = cur;
  const baseUpdated = useRef("");
  const savedJson = useRef("");
  const inflight = useRef(false);
  const queued = useRef(false);
  const conflict = useRef(false);
  const localDraft = useRef(false);
  const needInit = useRef(true);
  const lastGroup = useRef<{ g: string; at: number } | null>(null);
  // cv-photos objects: every photo path seen in this session. Nothing is deleted while the editor is open (undo may bring one back);
  // on close, anything neither the saved CV nor a kept offline draft references is removed.
  const savedPhoto = useRef("");
  const known = useRef(new Set<string>());
  const sbRef = useRef(sb);
  const dKey = draftKey(user.id, id);

  useEffect(() => {
    if (!doc.data || !needInit.current) return;
    needInit.current = false;
    const d = doc.data;
    const server: CvDocState = { title: d.title, language: d.language, template: d.template, design: d.design, data: d.data };
    baseUpdated.current = d.updatedAt;
    savedJson.current = snapshot(server);
    savedPhoto.current = d.data.personal.photoPath;
    conflict.current = false;
    setConflictOpen(false);
    void kv.getItem(dKey).then((raw) => {
      const parsedDraft = parseDraft(raw, d.updatedAt);
      const draft = parsedDraft?.doc;
      if (draft && parsedDraft.stale) {
        // The CV changed on the server since this draft was made: keep the draft and let the user choose.
        localDraft.current = true;
        conflict.current = true;
        setHist(historyInit(draft));
        setStatus("conflict");
        setConflictOpen(true);
      } else if (draft && snapshot(draft) !== savedJson.current) {
        localDraft.current = true;
        setHist(historyInit(draft));
        setStatus("unsaved");
        toast(t("cvMobile.draftRestored"));
      } else {
        void kv.removeItem(dKey);
        setHist(historyInit(server));
        setStatus("saved");
      }
      setRev((r) => r + 1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when a (re)load delivers a new document
  }, [doc.data]);

  /** Writes the current state; optimistic concurrency on updated_at. Returns true when nothing is left unsaved. */
  const flush = async (): Promise<boolean> => {
    const c = curRef.current;
    if (!c) return true;
    if (snapshot(c) === savedJson.current) return true;
    if (conflict.current) return false;
    if (inflight.current) {
      queued.current = true;
      return false;
    }
    inflight.current = true;
    setStatus("saving");
    localDraft.current = true;
    void kv.setItem(dKey, serializeDraft(baseUpdated.current, c)); // keep the draft on the device until the server has it
    const clean: CvDocState = { ...c, data: { ...c.data, skills: c.data.skills.filter((s) => s.name.trim()) } }; // a blank skill row is not a skill yet
    const r = await saveCvGuarded(sb, id, { title: c.title, language: c.language, template: c.template, data: clean.data }, c.design, baseUpdated.current);
    inflight.current = false;
    let ok = false;
    if (r.kind === "saved") {
      baseUpdated.current = r.updatedAt;
      savedJson.current = snapshot(c);
      savedPhoto.current = c.data.personal.photoPath;
      ok = true;
      if (snapshot(curRef.current ?? c) === savedJson.current) {
        localDraft.current = false;
        void kv.removeItem(dKey);
        setStatus("saved");
      } else setStatus("unsaved");
    } else if (r.kind === "conflict") {
      conflict.current = true;
      setStatus("conflict");
      setConflictOpen(true);
    } else if (r.kind === "offline") setStatus("offline");
    else {
      setStatus("error");
      setStatusNote(r.kind === "empty" ? t("cvMobile.emptyOverwrite") : r.kind === "invalid" ? t(r.error === "too_large" ? "career.cv.tooLarge" : "career.cv.invalid") : t("cvMobile.saveError"));
    }
    if (queued.current && r.kind === "saved") {
      queued.current = false;
      return flush();
    }
    queued.current = false;
    return ok && snapshot(curRef.current ?? c) === savedJson.current;
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const dirty = cur !== null && snapshot(cur) !== savedJson.current;
  // Autosave: debounce while editing; retry when connectivity returns.
  useEffect(() => {
    if (!dirty || conflict.current || status === "saving") return;
    if (status === "saved") setStatus("unsaved");
    const timer = setTimeout(() => void flushRef.current(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- status only gates; edits and connectivity re-arm the timer
  }, [cur, online]);
  // Save when the app goes to the background.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") void flushRef.current();
    });
    return () => sub.remove();
  }, []);
  // Save on leave, then remove photo uploads nothing references.
  useEffect(() => {
    const client = sbRef.current;
    const knownPhotos = known.current;
    return () => {
      void flushRef.current().finally(() => {
        const draftPhoto = localDraft.current ? curRef.current?.data.personal.photoPath : undefined;
        const orphans = orphanPaths(knownPhotos, [savedPhoto.current, draftPhoto]);
        if (orphans.length) void client.storage.from("cv-photos").remove(orphans);
      });
    };
  }, []);

  // Live preview: re-render the shared renderer's HTML ~300ms after the last change.
  useEffect(() => {
    if (mode !== "preview" || !cur) return;
    let live = true;
    const timer = setTimeout(() => void buildCvHtml(sb, cur).then((h) => live && setPreviewHtml(h)).catch(() => undefined), 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [mode, cur, sb]);

  const header = <ScreenHeader title={t("career.tabs.cv")} onBack={() => router.back()} />;
  if (doc.loading && !doc.data) {
    return (
      <Screen>
        {header}
        <Skeleton height={220} />
      </Screen>
    );
  }
  if (doc.error === CV_UNREADABLE) {
    return (
      <Screen>
        {header}
        <ErrorState title={t("cvMobile.unreadableTitle")} description={t("cvMobile.unreadableBody")} />
      </Screen>
    );
  }
  if (doc.error) {
    return (
      <Screen>
        {header}
        <ErrorState title={t("career.loadFailed")} description={doc.error} action={<Button title={t("common.retry")} onPress={doc.reload} />} />
      </Screen>
    );
  }
  if (!doc.data || !hist || !cur) {
    return (
      <Screen>
        {header}
        {doc.data ? <Skeleton height={220} /> : <EmptyState title={t("career.notFound")} />}
      </Screen>
    );
  }

  const cv = cur.data;
  const score = cvCompleteness(cv);
  /** Applies an edit. Edits with the same group inside COALESCE_MS share one undo step (typing); others each get their own. */
  const edit = (fn: (d: CvDocState) => CvDocState, group?: string) => {
    const now = Date.now();
    const same = !!group && lastGroup.current?.g === group && now - lastGroup.current.at < COALESCE_MS;
    lastGroup.current = group ? { g: group, at: now } : null;
    setHist((h) => {
      if (!h) return h;
      const next = fn(h.present);
      return same ? { ...h, present: next } : historyPush(h, next);
    });
  };
  const setData = <K extends keyof CvData>(k: K, v: CvData[K], group?: string) => edit((d) => ({ ...d, data: { ...d.data, [k]: v } }), group);
  const setPersonal = <K extends keyof CvData["personal"]>(k: K, v: CvData["personal"][K]) => setData("personal", { ...cv.personal, [k]: v }, `personal.${k}`);
  const list = (k: ListKey) => (next: Obj[], group?: string) => {
    if (next.length !== cv[k].length) setRev((r) => r + 1);
    setData(k, next as CvData[ListKey] as never, group);
  };
  const jump = (fn: (h: History<CvDocState>) => History<CvDocState>) => {
    lastGroup.current = null;
    setHist((h) => (h ? fn(h) : h));
    setRev((r) => r + 1); // text fields keep their own text; remount them with the restored state
  };
  const useTemplate = (tpl: CvTemplate) => {
    edit((d) => ({ ...d, template: tpl })); // data and design are untouched
    setGallery(false);
  };
  const setDesign = (design: CvDesign) => edit((d) => ({ ...d, design }), "design");
  const exportAs = async (m: "designed" | "ats") => {
    setExportMenu(false);
    setBusy(true);
    try {
      const r = await exportCvPdf(sb, cur, m);
      if (r.kind === "missing") toast(`${t("career.cv.required")}: ${r.fields.map((k) => t(`career.cv.field.${k as "fullName"}`)).join(", ")}`, "error");
      else if (r.kind === "unavailable") toast(t("career.cv.sharingUnavailable"), "error");
    } catch {
      toast(t("career.cv.exportFailed"), "error");
    } finally {
      setBusy(false);
    }
  };
  const openPreview = async () => {
    setBusy(true);
    try {
      await previewCv(sb, cur);
    } catch {
      toast(t("career.cv.exportFailed"), "error");
    } finally {
      setBusy(false);
    }
  };
  const reloadLatest = () => {
    void kv.removeItem(dKey);
    localDraft.current = false;
    needInit.current = true;
    setConflictOpen(false);
    doc.reload();
  };
  const duplicate = async () => {
    if (!(await flush())) return toast(t("career.cv.saveFailed"), "error");
    const res = await duplicateCv(sb, user.id, id, "(2)");
    if (res.ok) {
      toast(t("career.cv.duplicated"), "success");
      router.replace(`/career/cv/${res.id}` as never);
    } else toast(res.error === "limit" ? t("career.cv.limit") : t("career.cv.saveFailed"), "error");
  };
  const remove = async () => {
    setConfirmDelete(false);
    try {
      await deleteCv(sb, id);
      localDraft.current = false;
      curRef.current = null; // nothing left to save on leave
      void kv.removeItem(dKey);
      router.back();
    } catch {
      toast(t("career.cv.saveFailed"), "error");
    }
  };
  const statusText = status === "error" && statusNote ? statusNote : status === "conflict" ? t("cvMobile.conflictTitle") : t(status === "saved" ? "cvMobile.saved" : status === "saving" ? "cvMobile.saving" : status === "offline" ? "cvMobile.offline" : "cvMobile.unsaved");
  const entries = (k: ListKey, fields: Parameters<typeof Entries>[0]["fields"], make: () => Obj) => (
    <Entries key={k} group={k} title={t(`career.cv.section.${k}`)} items={cv[k] as Obj[]} fields={fields} rev={rev} language={cur.language} {...(AI[k] ? { ai: AI[k] } : {})} make={make} onChange={list(k)} />
  );
  const meta = cvTemplateMeta(cur.template);

  const iconBtn = (glyph: string, label: string, onPress: () => void, disabled = false) => (
    <PressableScale accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} onPress={disabled ? () => undefined : onPress} style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: theme.primarySoft, opacity: disabled ? 0.45 : 1 }}>
      <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 22, color: theme.text }}>
        {glyph}
      </Text>
    </PressableScale>
  );
  return (
    <View style={{ flex: 1 }}>
    <Screen>
      {header}
      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <Badge tone={status === "saved" ? "success" : status === "error" || status === "conflict" ? "danger" : "warning"}>{statusText}</Badge>
          {status === "conflict" ? <Button small title={t("cvMobile.conflictReload")} onPress={reloadLatest} /> : null}
          {dirty && status !== "conflict" ? <Button small variant="secondary" title={t("career.cv.save")} loading={status === "saving"} onPress={() => void flush()} /> : null}
        </View>
        <Segmented
          label={t("cvMobile.edit")}
          value={mode}
          onChange={setMode}
          options={[
            { value: "edit", label: t("cvMobile.edit") },
            { value: "preview", label: t("cvMobile.preview") },
          ]}
        />
      </Card>

      <Dialog
        open={moreOpen}
        title={t("cvMobile.more")}
        onClose={() => setMoreOpen(false)}
        actions={
          <>
            <Button small variant="secondary" title={t("cvMobile.template")} onPress={() => { setMoreOpen(false); setGallery(true); }} />
            <Button small variant="secondary" title={t("cvMobile.customise")} onPress={() => { setMoreOpen(false); setCustomise(true); }} />
            <Button small variant="secondary" title={t("common.close")} onPress={() => setMoreOpen(false)} />
          </>
        }
      >
        <AppText variant="caption" muted>
          {`${t("career.cv.template")}: ${t(meta.nameKey)}`}
        </AppText>
      </Dialog>
      <TemplateGallery open={gallery} current={cur.template} actionLabel={t("cvMobile.useTemplate")} onClose={() => setGallery(false)} onUse={useTemplate} />
      <CvCustomise open={customise} template={cur.template} design={cur.design} onChange={setDesign} onClose={() => setCustomise(false)} />
      <Dialog
        open={exportMenu}
        title={t("cvMobile.export")}
        onClose={() => setExportMenu(false)}
        actions={
          <>
            <Button small title={t("cvMobile.exportDesigned")} onPress={() => void exportAs("designed")} />
            <Button small variant="secondary" title={t("cvMobile.exportAts")} onPress={() => void exportAs("ats")} />
            <Button small variant="secondary" title={t("common.cancel")} onPress={() => setExportMenu(false)} />
          </>
        }
      >
        <AppText variant="caption" muted>
          {t("career.cv.design.atsHint")}
        </AppText>
      </Dialog>
      <Dialog
        open={conflictOpen}
        title={t("cvMobile.conflictTitle")}
        onClose={() => setConflictOpen(false)}
        actions={
          <>
            <Button small title={t("cvMobile.conflictReload")} onPress={reloadLatest} />
            <Button small variant="secondary" title={t("cvMobile.conflictKeep")} onPress={() => setConflictOpen(false)} />
          </>
        }
      >
        <AppText>{t("cvMobile.conflictBody")}</AppText>
      </Dialog>
      <ImportDialog
        key={importOpen ? "open" : "closed"}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onApply={(source, picked, overwrite, eduPick) => {
          edit((d) => ({ ...d, data: eduPick ? mergeEducation(mergeImport(d.data, source, picked, overwrite), eduPick) : mergeImport(d.data, source, picked, overwrite) }));
          setRev((r) => r + 1);
          setImportOpen(false);
          toast(t("cvMobile.importDone"), "success");
        }}
      />

      {mode === "preview" ? (
        <>
          <Card>
            <AppText variant="heading">{t(meta.nameKey)}</AppText>
            <AppText variant="caption" muted>
              {t("cvMobile.previewHint")}
            </AppText>
            <CvWebPreview html={previewHtml} />
            <Button variant="secondary" title={t("cvMobile.printPreview")} loading={busy} icon={<Icon name="eye" size="sm" />} onPress={() => void openPreview()} />
          </Card>
        </>
      ) : (
        <>
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
              <ProgressRing fraction={score.score / 100} track={theme.border} from={theme.primary} to={theme.info} label={t("career.cv.score")}>
                {`${score.score}%`}
              </ProgressRing>
              <View style={{ flex: 1, gap: 4 }}>
                <AppText variant="heading">{t("career.cv.scoreValue", { n: score.score })}</AppText>
                {score.missing.length ? <AppText variant="label">{t("career.cv.improve")}</AppText> : null}
                {score.missing.filter((k) => ["personal", "summary", "education", "experience", "skills", "languages", "projects", "certificates"].includes(k)).slice(0, 3).map((k) => (
                  <AppText key={k} variant="caption" muted>
                    {`• ${t(`career.cv.tip.${k as "personal"}`)}`}
                  </AppText>
                ))}
              </View>
            </View>
          </Card>

          <Card>
            <Input label={t("career.cv.title")} value={cur.title} onChangeText={(v) => edit((d) => ({ ...d, title: v }), "title")} maxLength={120} />
            <Segmented label={t("career.cv.language")} value={cur.language} onChange={(v) => edit((d) => ({ ...d, language: v }))} options={CV_LANGUAGES.map((l) => ({ value: l, label: t(`career.lang.${l}`) }))} />
            <AppText variant="caption" muted>
              {`${t("career.cv.template")}: ${t(meta.nameKey)}`}
            </AppText>
          </Card>

          <Card>
            <AppText variant="heading">{t("career.cv.section.personal")}</AppText>
            <Button small variant="secondary" title={t("cvMobile.importTitle")} onPress={() => setImportOpen(true)} />
            <PhotoField
              url={cv.personal.photoUrl}
              path={cv.personal.photoPath}
              uid={user.id}
              onChange={(p) => {
                if (p.photoPath) known.current.add(p.photoPath);
                setData("personal", { ...cv.personal, ...p });
              }}
            />
            {(["fullName", "headline", "email", "phone", "city", "address", "idNumber", "birthDate", "nationality", "gender", "linkedin", "github", "portfolio", "website"] as const).map((k) => (
              <Input
                key={`${rev}-${k}`}
                label={k === "fullName" || k === "email" || k === "phone" ? `${t(`career.cv.field.${k}`)} * (${t("career.cv.required")})` : t(`career.cv.field.${k}`)}
                value={cv.personal[k]}
                onChangeText={(v) => setPersonal(k, v)}
                autoCapitalize={k === "email" || k === "linkedin" || k === "website" || k === "github" || k === "portfolio" ? "none" : "words"}
                keyboardType={k === "email" ? "email-address" : k === "phone" ? "phone-pad" : "default"}
              />
            ))}
            <Socials items={cv.personal.socials} onChange={(v) => setPersonal("socials", v)} />
          </Card>
          <Card>
            <AppText variant="heading">{t("career.cv.section.summary")}</AppText>
            <Input key={`sum-${rev}`} label={t("career.cv.field.summary")} value={cv.summary} onChangeText={(v) => setData("summary", v, "summary")} multiline maxLength={1500} style={{ minHeight: 100, textAlignVertical: "top" }} />
            <AiWrite
              kind="summary"
              language={cur.language}
              context={{ ...(cv.personal.headline ? { title: cv.personal.headline.slice(0, 200) } : {}), ...(cv.skills.length ? { skills: cv.skills.map((s) => s.name).join(", ").slice(0, 200) } : {}) }}
              current={cv.summary}
              max={1500}
              onText={(v) => {
                setData("summary", v);
                setRev((r) => r + 1);
              }}
            />
          </Card>
          {entries("experience", EXP, () => CvExperienceSchema.parse({}))}
          {entries("education", EDU, () => CvEducationSchema.parse({}))}
          <Entries group="skills" title={t("career.cv.section.skills")} items={cv.skills as Obj[]} fields={SKILL} rev={rev} language={cur.language} make={() => ({ name: "" })} onChange={(next, g) => {
            if (next.length !== cv.skills.length) setRev((r) => r + 1);
            setData("skills", next.slice(0, CV_SECTION_ITEMS_MAX).map((s) => ({ ...s, name: String(s.name ?? "").slice(0, 50) })) as CvData["skills"], g);
          }} />
          {entries("languages", LANG, () => CvLanguageSchema.parse({}))}
          {entries("certificates", CERT, () => CvCertificateSchema.parse({}))}
          {entries("projects", PROJ, () => CvProjectSchema.parse({}))}
          {entries("honours", HONOUR, () => CvHonourSchema.parse({}))}
          {entries("volunteer", VOLUNTEER, () => CvVolunteerSchema.parse({}))}
          {entries("publications", PUBLICATION, () => CvPublicationSchema.parse({}))}
          {entries("courses", COURSE, () => CvCourseSchema.parse({}))}
          {entries("hobbies", HOBBY, () => CvHobbySchema.parse({}))}
          {entries("activities", ACTIVITY, () => CvActivitySchema.parse({}))}
          {entries("references", REFERENCE, () => CvReferenceSchema.parse({}))}

          <FeedbackPanel
            cvId={id}
            language={cur.language}
            ensureSaved={flush}
            onApplySummary={(v) => {
              setData("summary", v);
              setRev((r) => r + 1);
            }}
          />

          <Button title={t("career.cv.duplicate")} variant="secondary" onPress={() => void duplicate()} />
          <Button title={t("career.cv.delete")} variant="danger" onPress={() => setConfirmDelete(true)} />
          <Dialog
            open={confirmDelete}
            title={t("career.cv.delete")}
            onClose={() => setConfirmDelete(false)}
            actions={
              <>
                <Button small variant="secondary" title={t("common.cancel")} onPress={() => setConfirmDelete(false)} />
                <Button small variant="danger" title={t("common.delete")} onPress={() => void remove()} />
              </>
            }
          >
            <AppText>{t("career.cv.deleteConfirm")}</AppText>
          </Dialog>
        </>
      )}
      <View style={{ height: 96 + insets.bottom }} />
    </Screen>
    {/* Sticky action bar: always reachable, safe-area aware, content capped on tablets. */}
    <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: theme.surface, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 8, paddingBottom: insets.bottom + 8, paddingHorizontal: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, width: "100%", maxWidth: CONTENT_MAX, alignSelf: "center" }}>
        {iconBtn("↶", t("cvMobile.undo"), () => jump(historyUndo), !hist.past.length)}
        {iconBtn("↷", t("cvMobile.redo"), () => jump(historyRedo), !hist.future.length)}
        <Button style={{ flex: 1, minWidth: 0 }} title={t("cvMobile.export")} loading={busy} icon={<Icon name="download" size="sm" />} onPress={() => setExportMenu(true)} />
        {iconBtn("⋯", t("cvMobile.more"), () => setMoreOpen(true))}
      </View>
    </View>
    </View>
  );
}

"use client";

import { Icon, Skeleton, useToast, type IconName } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import type { MessageKey } from "@unimate/i18n";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EdgeNotice } from "@/components/EdgeNotice";
import { useUser } from "@/components/user";
import type { DocumentRow } from "@/lib/db";
import { edgeErrorMessageKey, type EdgeError, type StructuredCitation } from "@/lib/edge";
import { askDocument, generateSummary, processDocument } from "@/lib/edge-client";
import { getBrowserClient } from "@/lib/supabase/browser";
import { unwrap, useAsync } from "@/lib/use-async";
import { useVisibleInterval } from "@/lib/use-visible-interval";
import { DOC_COLUMNS, isInFlight } from "@/features/documents/DocumentsList";
import { precheckFile, storagePathFor } from "@/features/documents/upload";
import { pageLabels } from "./helpers";
import s from "./AiStudyPage.module.css";

interface Bubble { id: string; role: "user" | "assistant"; content: string; citations?: StructuredCitation[]; grounded?: boolean }

export function AiStudyPage() {
  const { t, date, locale } = useI18n();
  const router = useRouter();
  const user = useUser();
  const { toast } = useToast();
  const docs = useAsync<DocumentRow[]>(async () => unwrap(await getBrowserClient().from("documents").select(DOC_COLUMNS).order("created_at", { ascending: false })), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [edgeError, setEdgeError] = useState<EdgeError | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useVisibleInterval(docs.reload, 4000, docs.data?.some((d) => isInFlight(d.status)) ?? false);

  const ready = (docs.data ?? []).filter((d) => d.status === "ready");
  const doc = ready.find((d) => d.id === selectedId) ?? ready[0] ?? null;

  useEffect(() => {
    if (messages.length > 0 || busy) endRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "end" });
  }, [messages, busy]);
  useEffect(() => {
    const a = areaRef.current;
    if (!a) return;
    a.style.height = "auto";
    a.style.height = `${Math.min(a.scrollHeight, 120)}px`; // ~5 lines
  }, [question]);

  function selectDoc(id: string) {
    setPickerOpen(false);
    if (id === doc?.id) return;
    setSelectedId(id);
    setMessages([]); // one conversation per document
    setConversationId(undefined);
    setEdgeError(null);
  }

  const push = (b: Omit<Bubble, "id">) => setMessages((m) => [...m, { ...b, id: crypto.randomUUID() }]);

  async function send() {
    const q = question.trim();
    if (!q || !doc || busy) return;
    setEdgeError(null);
    setQuestion("");
    push({ role: "user", content: q });
    setBusy(true);
    const res = await askDocument(doc.id, q, conversationId);
    setBusy(false);
    if (!res.ok) return setEdgeError(res.error);
    setConversationId(res.data.conversationId);
    push({ role: "assistant", content: res.data.answer, citations: res.data.citations, grounded: res.data.grounded });
  }

  async function summarise() {
    if (!doc || busy) return toast(t("mobile.aiStudy.needDoc"), "info");
    setEdgeError(null);
    push({ role: "user", content: t("mobile.aiStudy.sugSummary") });
    setBusy(true);
    const res = await generateSummary(doc.id, "short", locale);
    setBusy(false);
    if (!res.ok) return setEdgeError(res.error);
    const { summary, key_points } = res.data.output;
    push({ role: "assistant", content: [summary, ...key_points.map((p) => `• ${p}`)].join("\n") });
  }

  const openDoc = () => (doc ? router.push(`/documents/${doc.id}`) : toast(t("mobile.aiStudy.needDoc"), "info"));

  // Same rules as the documents page (precheckFile, same insert/upload/status steps).
  async function onFile(file: File) {
    setUploadError(null);
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const check = precheckFile({ name: file.name, size: file.size, mimeType: file.type, head });
    if (!check.ok) return setUploadError(t(`documents.upload_errors.${check.error}` as MessageKey));
    setUploading(true);
    const sb = getBrowserClient();
    const path = storagePathFor(user.id, crypto.randomUUID(), check.extension);
    try {
      const ins = await sb.from("documents").insert({ user_id: user.id, title: check.title, original_filename: file.name, storage_path: path, mime_type: check.mimeType, size_bytes: file.size, idempotency_key: crypto.randomUUID() }).select("id").single<{ id: string }>();
      if (ins.error) throw new Error(ins.error.message);
      const up = await sb.storage.from("documents").upload(path, file, { contentType: check.mimeType, upsert: false });
      if (up.error) {
        await sb.from("documents").delete().eq("id", ins.data.id);
        throw new Error(up.error.message);
      }
      const upd = await sb.from("documents").update({ status: "uploaded" }).eq("id", ins.data.id);
      if (upd.error) throw new Error(upd.error.message);
      const proc = await processDocument(ins.data.id);
      if (proc.ok) toast(t("documents.uploaded"), "success");
      else toast(t("documents.processStartFailed", { reason: t(edgeErrorMessageKey(proc.error), { message: proc.error.message ?? "" }) }), "error");
      docs.reload();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : t("common.genericError"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const suggestions: { icon: IconName; title: string; hint: string; run: () => void }[] = [
    { icon: "summary", title: t("mobile.aiStudy.sugSummary"), hint: t("mobile.aiStudy.sugSummaryHint"), run: () => void summarise() },
    { icon: "quiz", title: t("mobile.aiStudy.sugQuiz"), hint: t("mobile.aiStudy.sugQuizHint"), run: openDoc },
    { icon: "flashcard", title: t("mobile.aiStudy.sugCards"), hint: t("mobile.aiStudy.sugCardsHint"), run: openDoc },
    { icon: "study-plan", title: t("mobile.aiStudy.sugWriting"), hint: t("mobile.aiStudy.sugWritingHint"), run: () => router.push("/writing") },
  ];
  const canSend = !!doc && question.trim().length > 0 && !busy;
  const placeholder = doc ? t("mobile.aiStudy.askPlaceholder") : t("mobile.aiStudy.composerNoDoc");

  return (
    <div className={s.page}>
      <div className={s.column}>
        <h1 className={s.hero}>
          <span className={s.muted}>{t("mobile.aiStudy.heroMuted")}</span>
          <br />
          {t("mobile.aiStudy.heroStrong")}
        </h1>
        <p className={s.muted}>{t("mobile.aiStudy.subtitle")}</p>

        <div className={s.pills}>
          {docs.loading && !docs.data ? (
            <Skeleton height={36} width={160} />
          ) : doc ? (
            <button type="button" className={`${s.pill} ${s.pillAccent}`} aria-haspopup="listbox" aria-expanded={pickerOpen} onClick={() => setPickerOpen((o) => !o)}>
              <Icon name="materials" size="sm" />
              <span className={s.pillLabel}>{doc.title}</span>
            </button>
          ) : null}
          <Link href="/documents" className={s.pill}>
            {t("mobile.aiStudy.myDocs")}
          </Link>
        </div>
        {pickerOpen ? (
          <ul className={s.picker} role="listbox" aria-label={t("mobile.aiStudy.pickerTitle")}>
            {ready.map((d) => (
              <li key={d.id} role="option" aria-selected={d.id === doc?.id}>
                <button type="button" onClick={() => selectDoc(d.id)}>
                  <span>
                    {d.title}
                    <small className={s.muted}> {date(d.created_at)}</small>
                  </span>
                  {d.id === doc?.id ? <Icon name="check" size="sm" /> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {messages.length === 0 && !busy ? (
          <div className={s.cards}>
            {suggestions.map((x) => (
              <button key={x.icon} type="button" className={s.card} aria-label={`${x.title}. ${x.hint}`} onClick={x.run}>
                <Icon name={x.icon} size={26} />
                <span>
                  <strong>{x.title}</strong>
                  <small className={s.muted}>{x.hint}</small>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <div className={s.list} aria-live="polite">
          {messages.map((m) => {
            const pages = m.citations?.length ? pageLabels(m.citations, t) : "";
            return (
              <div key={m.id} className={`${s.bubble} ${m.role === "user" ? s.mine : s.theirs}`}>
                <p className={s.text}>{m.content}</p>
                {m.citations?.length ? (
                  <small className={s.cite}>
                    {t("chat.sources")}: {pages || m.citations.length}
                  </small>
                ) : null}
                {m.grounded === false ? (
                  <p className="warn-box" role="status">
                    {t("chat.notGrounded")}
                  </p>
                ) : null}
              </div>
            );
          })}
          {busy ? (
            <div className={`${s.bubble} ${s.theirs} ${s.muted}`} role="status">
              {t("chat.thinking")}
            </div>
          ) : null}
        </div>
        {edgeError ? <EdgeNotice error={edgeError} /> : null}
        {uploadError ? (
          <p className="err-box" role="alert">
            {uploadError}
          </p>
        ) : null}
        <div ref={endRef} />
      </div>

      <div className={s.composerWrap}>
        <form
          className={s.composer}
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            ref={fileRef}
            className="um-sr-only"
            type="file"
            tabIndex={-1}
            accept=".pdf,.docx,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
          <button type="button" className={s.round} aria-label={t("mobile.aiStudy.attach")} title={t("documents.uploadHint")} disabled={uploading} aria-busy={uploading} onClick={() => fileRef.current?.click()}>
            <Icon name="upload" />
          </button>
          <div className={s.field}>
            <Icon name="sparkles" size="sm" />
            <textarea
              ref={areaRef}
              rows={1}
              value={question}
              maxLength={2000}
              disabled={!doc}
              aria-label={placeholder}
              placeholder={placeholder}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button type="submit" className={s.send} aria-label={t("mobile.aiStudy.send")} disabled={!canSend}>
              <Icon name="arrow-up" size="sm" />
            </button>
          </div>
          <Link href="/documents" className={s.round} aria-label={t("mobile.aiStudy.more")}>
            <Icon name="more-horizontal" />
          </Link>
        </form>
      </div>
    </div>
  );
}

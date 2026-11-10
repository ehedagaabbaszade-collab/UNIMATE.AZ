import { LOCALES, LOCALE_NAMES, type Locale } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { z } from "zod";
import { EdgeNotice } from "../../components/EdgeNotice";
import { AppText, Badge, Button, Card, EmptyState, ErrorState, Input, Notice, Screen, ScreenHeader, Segmented, Skeleton } from "../../components/ui";
import { pageLabel, segmentAnswer } from "../../lib/citations";
import type { ChunkRow, DocumentRow, MessageRow, QuizRow, SummaryRow } from "../../lib/db";
import { DOC_COLUMNS, POLL_MS, STATUS_TONE, isInFlight } from "../../lib/documents";
import { citationSchema, type EdgeError, type StructuredCitation } from "../../lib/edge";
import { askDocument, generateQuizMaterial, generateSummary } from "../../lib/edge-client";
import { questionSchema } from "../../lib/schemas";
import { unwrap, useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { radii } from "../../theme/tokens";
import { CardsView } from "../study/Flashcards";

type Tab = "summary" | "chat" | "quiz" | "cards";
const SUMMARY_KINDS = ["short", "detailed", "exam"] as const;

// ------------------------------------------------------------------ summaries
function SummaryPanel({ documentId, language }: { documentId: string; language: Locale }) {
  const { t, locale, dateTime } = useI18n();
  const { supabase: sb } = useUser();
  const [kind, setKind] = useState<(typeof SUMMARY_KINDS)[number]>("short");
  const rows = useAsync<SummaryRow[]>(async () => unwrap(await sb.from("summaries").select("id,kind,content,created_at").eq("document_id", documentId).eq("kind", kind).order("created_at", { ascending: false }).limit(1)), [documentId, kind]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<EdgeError | null>(null);

  async function generate() {
    setBusy(true);
    setErr(null);
    const res = await generateSummary(documentId, kind, language);
    setBusy(false);
    if (!res.ok) setErr(res.error);
    else rows.reload();
  }
  const latest = rows.data?.[0];
  return (
    <View style={{ gap: 12 }}>
      <Segmented label={t("summary.kindLabel")} value={kind} onChange={setKind} options={SUMMARY_KINDS.map((k) => ({ value: k, label: t(`summary.${k}`) }))} />
      {rows.loading && !rows.data ? (
        <Skeleton height={120} />
      ) : latest ? (
        <Card>
          <AppText selectable>{latest.content}</AppText>
          <AppText variant="caption" muted>
            {dateTime(latest.created_at)}
          </AppText>
        </Card>
      ) : (
        <AppText muted>{t("summary.none", { kind: t(`summary.${kind}`).toLocaleLowerCase(locale) })}</AppText>
      )}
      {err ? <EdgeNotice error={err} /> : null}
      <Button title={busy ? t("summary.generating") : latest ? t("summary.regenerate") : t("summary.generate")} loading={busy} variant={latest ? "secondary" : "primary"} onPress={generate} />
    </View>
  );
}

// ------------------------------------------------------------------ chat with citations
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: StructuredCitation[];
  suspicious?: boolean;
}
/** Stored citations are re-validated on read; anything malformed yields no chips rather than a guess. */
const parseStored = (raw: unknown): StructuredCitation[] => {
  const r = z.array(citationSchema).safeParse(raw);
  return r.success ? r.data : [];
};

/** Renders an answer; a citation chip appears ONLY for ids present in the server-validated structured citations. */
function CitedAnswer({ answer, citations, onSelect, selectedId }: { answer: string; citations: StructuredCitation[]; onSelect: (chunkId: string) => void; selectedId: string | null }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const parts = segmentAnswer(answer, citations);
  return (
    <AppText selectable>
      {parts.map((p, i) =>
        p.type === "text" ? (
          <Text key={i}>{p.text}</Text>
        ) : (
          <Text
            key={i}
            onPress={() => onSelect(p.chunkId)}
            accessibilityRole="link"
            accessibilityLabel={`${t("chat.sources")} ${p.index}`}
            style={{ color: theme.onPrimary, backgroundColor: selectedId === p.chunkId ? theme.active : theme.primary, fontWeight: "700", fontSize: 12 }}
          >
            {` ${p.index} `}
          </Text>
        ),
      )}
    </AppText>
  );
}

function ChatPanel({ documentId }: { documentId: string }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { supabase: sb } = useUser();
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [qError, setQError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edgeError, setEdgeError] = useState<EdgeError | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [source, setSource] = useState<{ chunk?: ChunkRow; error?: boolean; loading?: boolean } | null>(null);

  const history = useAsync(async () => {
    const conv = await sb.from("conversations").select("id").eq("document_id", documentId).order("updated_at", { ascending: false }).limit(1).maybeSingle<{ id: string }>();
    if (conv.error) throw new Error(conv.error.message);
    if (!conv.data) return null;
    const rows = unwrap(await sb.from("messages").select("id,conversation_id,role,content,citations,created_at").eq("conversation_id", conv.data.id).order("created_at")) as MessageRow[];
    return { id: conv.data.id, rows };
  }, [documentId]);

  useEffect(() => {
    if (!history.data) return;
    setConversationId(history.data.id);
    setMessages(history.data.rows.filter((m) => m.role !== "system").map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content, citations: m.role === "assistant" ? parseStored(m.citations) : [] })));
  }, [history.data]);

  async function selectChunk(chunkId: string) {
    setSelected(chunkId);
    setSource({ loading: true });
    const { data, error } = await sb.from("document_chunks").select("id,chunk_index,page_start,page_end,content").eq("id", chunkId).eq("document_id", documentId).maybeSingle<ChunkRow>();
    setSource(error || !data ? { error: true } : { chunk: data });
  }

  async function send() {
    const parsed = questionSchema.safeParse({ question });
    if (!parsed.success) return setQError(t("validation.question"));
    setQError(null);
    setEdgeError(null);
    setBusy(true);
    const q = parsed.data.question;
    setMessages((m) => [...m, { id: `local-${m.length}`, role: "user", content: q, citations: [] }]);
    setQuestion("");
    const res = await askDocument(documentId, q, conversationId);
    setBusy(false);
    if (!res.ok) return setEdgeError(res.error);
    setConversationId(res.data.conversationId);
    setMessages((m) => [...m, { id: res.data.messageId, role: "assistant", content: res.data.answer, citations: res.data.citations, suspicious: res.data.suspicious }]);
  }

  const sp = source?.chunk ? pageLabel(source.chunk) : null;
  return (
    <View style={{ gap: 12 }}>
      {history.loading ? <Skeleton height={60} /> : null}
      {messages.length === 0 && !history.loading ? <AppText muted>{t("chat.empty")}</AppText> : null}
      <View accessibilityLiveRegion="polite" style={{ gap: 10 }}>
        {messages.map((m) => (
          <View key={m.id} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "92%", backgroundColor: m.role === "user" ? theme.primarySoft : theme.card, borderColor: theme.cardBorder, borderWidth: 1, borderRadius: radii.lg, padding: 12, gap: 4 }}>
            <AppText variant="caption" muted>
              {m.role === "user" ? t("chat.you") : t("chat.assistant")}
            </AppText>
            {m.role === "user" ? <AppText selectable>{m.content}</AppText> : <CitedAnswer answer={m.content} citations={m.citations} onSelect={selectChunk} selectedId={selected} />}
            {m.suspicious ? <Notice tone="warning" text={t("chat.suspicious")} /> : null}
          </View>
        ))}
        {busy ? <AppText muted>{t("chat.thinking")}</AppText> : null}
      </View>

      {source ? (
        <Card accessibilityLabel={t("chat.sourceTitle")}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <AppText variant="label">
              {t("chat.sourceTitle")}
              {sp?.kind === "single" ? ` · ${t("chat.pageSingle", { n: sp.n })}` : sp?.kind === "range" ? ` · ${t("chat.pageRange", { a: sp.a, b: sp.b })}` : ""}
            </AppText>
            <Button small variant="ghost" title={t("common.close")} onPress={() => { setSource(null); setSelected(null); }} />
          </View>
          {source.loading ? <Skeleton height={60} /> : source.error ? <Notice text={t("chat.loadSourceFailed")} /> : <AppText selectable variant="caption">{source.chunk?.content}</AppText>}
        </Card>
      ) : null}

      {edgeError ? <EdgeNotice error={edgeError} /> : null}
      <Input label={t("chat.placeholder")} value={question} onChangeText={setQuestion} maxLength={2000} multiline numberOfLines={3} error={qError ?? undefined} style={{ minHeight: 70, textAlignVertical: "top" }} />
      <Button title={t("chat.send")} loading={busy} onPress={send} />
    </View>
  );
}

// ------------------------------------------------------------------ quizzes (taking happens on /quiz/[id])
function QuizPanel({ documentId, language }: { documentId: string; language: Locale }) {
  const { t, date } = useI18n();
  const router = useRouter();
  const { supabase: sb } = useUser();
  const quizzes = useAsync(async () => {
    const qz = unwrap(await sb.from("quizzes").select("id,title,created_at").eq("document_id", documentId).order("created_at", { ascending: false })) as QuizRow[];
    return qz;
  }, [documentId]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<EdgeError | null>(null);

  async function generate() {
    setBusy(true);
    setErr(null);
    const res = await generateQuizMaterial(documentId, 10, language);
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    quizzes.reload();
    router.push({ pathname: "/quiz/[id]", params: { id: res.data.output.quizId } });
  }
  return (
    <View style={{ gap: 12 }}>
      {quizzes.loading && !quizzes.data ? <Skeleton height={80} /> : null}
      {quizzes.data?.length === 0 ? <AppText muted>{t("quiz.none")}</AppText> : null}
      {quizzes.data?.map((q) => (
        <Card key={q.id} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <AppText style={{ fontWeight: "700" }}>{q.title}</AppText>
            <AppText variant="caption" muted>
              {date(q.created_at)}
            </AppText>
          </View>
          <Button small title={t("quiz.start")} onPress={() => router.push({ pathname: "/quiz/[id]", params: { id: q.id } })} />
        </Card>
      ))}
      {err ? <EdgeNotice error={err} /> : null}
      <Button title={busy ? t("quiz.generating") : t("quiz.generate")} loading={busy} variant={quizzes.data?.length ? "secondary" : "primary"} onPress={generate} />
    </View>
  );
}

// ------------------------------------------------------------------ screen
export function DocumentDetail({ documentId }: { documentId: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { supabase: sb } = useUser();
  const [tab, setTab] = useState<Tab>("summary");
  // Output language is independent of the document's language (defaults to the UI language).
  const [outLang, setOutLang] = useState<Locale>(locale);
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setOutLang(locale);
  }, [locale]);

  const doc = useAsync<DocumentRow | null>(async () => unwrap(await sb.from("documents").select(DOC_COLUMNS).eq("id", documentId).maybeSingle<DocumentRow>()), [documentId]);
  const inFlight = doc.data ? isInFlight(doc.data.status) : false;
  const reload = doc.reload;
  useEffect(() => {
    if (!inFlight) return;
    const id = setInterval(reload, POLL_MS);
    return () => clearInterval(id);
  }, [inFlight, reload]);

  const d = doc.data;
  return (
    <Screen>
      <ScreenHeader title={d?.title ?? t("documents.title")} onBack={() => router.back()} />
      {doc.loading && doc.data === undefined ? (
        <Skeleton height={200} />
      ) : doc.error ? (
        <ErrorState title={t("documents.loadFailed")} description={doc.error} action={<Button title={t("common.retry")} onPress={doc.reload} />} />
      ) : !d ? (
        <EmptyState title={t("ai.notFound")} />
      ) : (
        <>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            <Badge tone={STATUS_TONE[d.status]}>{t(`documents.status.${d.status}`)}</Badge>
            {d.page_count != null ? (
              <AppText muted variant="caption">
                {t("documents.pages", { n: d.page_count })}
              </AppText>
            ) : null}
          </View>
          {d.status === "failed" ? (
            <ErrorState title={t("documents.failedTitle")} description={d.error ?? undefined} />
          ) : d.status !== "ready" ? (
            <EmptyState title={t("documents.notReadyTitle")} description={`${t("documents.notReadyBody")} ${t("documents.refreshing")}`} />
          ) : (
            <>
              <Card>
                <AppText variant="label">{t("mobile.ai.outputLanguage")}</AppText>
                <Segmented
                  label={t("mobile.ai.outputLanguage")}
                  value={outLang}
                  onChange={(l) => {
                    touched.current = true;
                    setOutLang(l);
                  }}
                  options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
                />
                <AppText variant="caption" muted>
                  {t("mobile.ai.outputLanguageHint")}
                </AppText>
              </Card>
              <Segmented
                label={t("documents.tabs.label")}
                value={tab}
                onChange={setTab}
                options={[
                  { value: "summary", label: t("documents.tabs.summary") },
                  { value: "chat", label: t("documents.tabs.chat") },
                  { value: "quiz", label: t("documents.tabs.quiz") },
                  { value: "cards", label: t("documents.tabs.cards") },
                ]}
              />
              {tab === "summary" ? <SummaryPanel documentId={d.id} language={outLang} /> : null}
              {tab === "chat" ? <ChatPanel documentId={d.id} /> : null}
              {tab === "quiz" ? <QuizPanel documentId={d.id} language={outLang} /> : null}
              {tab === "cards" ? <CardsView documentId={d.id} outputLanguage={outLang} /> : null}
            </>
          )}
        </>
      )}
    </Screen>
  );
}



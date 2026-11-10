"use client";

import { Button, Skeleton, Textarea } from "@unimate/ui";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { EdgeNotice } from "@/components/EdgeNotice";
import { useI18n } from "@unimate/i18n/react";
import type { ChunkRow, MessageRow } from "@/lib/db";
import { citationSchema, type EdgeError, type StructuredCitation } from "@/lib/edge";
import { askDocument } from "@/lib/edge-client";
import { questionSchema } from "@/lib/schemas";
import { getBrowserClient } from "@/lib/supabase/browser";
import { unwrap, useAsync } from "@/lib/use-async";
import { CitedAnswer } from "./CitedAnswer";
import { pageLabel } from "./citations";

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

export function ChatPanel({ documentId }: { documentId: string }) {
  const { t } = useI18n();
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [qError, setQError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edgeError, setEdgeError] = useState<EdgeError | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [source, setSource] = useState<{ chunk?: ChunkRow; error?: boolean; loading?: boolean } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const history = useAsync(async () => {
    const sb = getBrowserClient();
    const conv = await sb.from("conversations").select("id").eq("document_id", documentId).order("updated_at", { ascending: false }).limit(1).maybeSingle<{ id: string }>();
    if (conv.error) throw new Error(conv.error.message);
    if (!conv.data) return null;
    const rows = unwrap(await sb.from("messages").select("id,conversation_id,role,content,citations,created_at").eq("conversation_id", conv.data.id).order("created_at")) as MessageRow[];
    return { id: conv.data.id, rows };
  }, [documentId]);

  useEffect(() => {
    if (!history.data) return;
    setConversationId(history.data.id);
    setMessages(
      history.data.rows
        .filter((m) => m.role !== "system")
        .map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content, citations: m.role === "assistant" ? parseStored(m.citations) : [] })),
    );
  }, [history.data]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, busy]);

  async function selectChunk(chunkId: string) {
    setSelected(chunkId);
    setSource({ loading: true });
    const { data, error } = await getBrowserClient().from("document_chunks").select("id,chunk_index,page_start,page_end,content").eq("id", chunkId).eq("document_id", documentId).maybeSingle<ChunkRow>();
    setSource(error || !data ? { error: true } : { chunk: data });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
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
    if (!res.ok) {
      setEdgeError(res.error);
      return;
    }
    setConversationId(res.data.conversationId);
    setMessages((m) => [...m, { id: res.data.messageId, role: "assistant", content: res.data.answer, citations: res.data.citations, suspicious: res.data.suspicious }]);
  }

  const sourcePage = source?.chunk ? pageLabel(source.chunk) : null;

  return (
    <div className="stack">
      {history.loading ? <Skeleton height={80} /> : null}
      <div className="chat-log" aria-live="polite">
        {messages.length === 0 && !history.loading ? <p className="um-muted">{t("chat.empty")}</p> : null}
        {messages.map((m) => (
          <div key={m.id} className={`msg msg--${m.role}`}>
            <span className="msg__who">{m.role === "user" ? t("chat.you") : t("chat.assistant")}</span>
            {m.role === "user" ? <p style={{ whiteSpace: "pre-wrap" }}>{m.content}</p> : <CitedAnswer answer={m.content} citations={m.citations} onSelect={selectChunk} selectedId={selected} />}
            {m.suspicious ? <p className="warn-box">{t("chat.suspicious")}</p> : null}
          </div>
        ))}
        {busy ? <p className="um-muted" role="status">{t("chat.thinking")}</p> : null}
        <div ref={endRef} />
      </div>

      {source ? (
        <div className="stack" role="region" aria-label={t("chat.sourceTitle")}>
          <div className="row row--between">
            <strong>
              {t("chat.sourceTitle")}
              {sourcePage?.kind === "single" ? ` · ${t("chat.pageSingle", { n: sourcePage.n })}` : sourcePage?.kind === "range" ? ` · ${t("chat.pageRange", { a: sourcePage.a, b: sourcePage.b })}` : ""}
            </strong>
            <Button size="sm" variant="ghost" onClick={() => { setSource(null); setSelected(null); }}>
              {t("common.close")}
            </Button>
          </div>
          {source.loading ? <Skeleton height={80} /> : source.error ? <p className="err-box">{t("chat.loadSourceFailed")}</p> : <div className="source-box">{source.chunk?.content}</div>}
        </div>
      ) : null}

      {edgeError ? <EdgeNotice error={edgeError} /> : null}

      <form className="chat-form" onSubmit={onSubmit} noValidate>
        <Textarea label={t("chat.placeholder")} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={2000} error={qError ?? undefined} rows={2} />
        <div>
          <Button type="submit" loading={busy}>
            {t("chat.send")}
          </Button>
        </div>
      </form>
    </div>
  );
}

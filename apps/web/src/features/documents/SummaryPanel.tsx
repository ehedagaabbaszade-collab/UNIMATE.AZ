"use client";

import { Button, Card, Skeleton, Tabs } from "@unimate/ui";
import { useState } from "react";
import { EdgeNotice } from "@/components/EdgeNotice";
import { useI18n } from "@unimate/i18n/react";
import type { SummaryRow } from "@/lib/db";
import type { EdgeError } from "@/lib/edge";
import { generateSummary } from "@/lib/edge-client";
import { getBrowserClient } from "@/lib/supabase/browser";
import { unwrap, useAsync } from "@/lib/use-async";

const KINDS = ["short", "detailed", "exam"] as const;
type Kind = (typeof KINDS)[number];

function KindView({ documentId, kind }: { documentId: string; kind: Kind }) {
  const { t, locale, dateTime } = useI18n();
  const rows = useAsync<SummaryRow[]>(
    async () => unwrap(await getBrowserClient().from("summaries").select("id,kind,content,created_at").eq("document_id", documentId).eq("kind", kind).order("created_at", { ascending: false }).limit(1)),
    [documentId, kind],
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<EdgeError | null>(null);

  async function generate() {
    setBusy(true);
    setErr(null);
    const res = await generateSummary(documentId, kind, locale);
    setBusy(false);
    if (!res.ok) setErr(res.error);
    else rows.reload();
  }

  const latest = rows.data?.[0];
  return (
    <div className="stack">
      {rows.loading && !rows.data ? (
        <Skeleton height={120} />
      ) : latest ? (
        <Card>
          <p style={{ whiteSpace: "pre-wrap" }}>{latest.content}</p>
          <p className="um-hint" style={{ marginTop: "var(--space-3)" }}>
            {dateTime(latest.created_at)}
          </p>
        </Card>
      ) : (
        <p className="um-muted">{t("summary.none", { kind: t(`summary.${kind}`).toLocaleLowerCase(locale) })}</p>
      )}
      {err ? <EdgeNotice error={err} /> : null}
      <div>
        <Button onClick={generate} loading={busy} variant={latest ? "secondary" : "primary"}>
          {busy ? t("summary.generating") : latest ? t("summary.regenerate") : t("summary.generate")}
        </Button>
      </div>
    </div>
  );
}

export function SummaryPanel({ documentId }: { documentId: string }) {
  const { t } = useI18n();
  return (
    <Tabs
      label={t("summary.kindLabel")}
      items={KINDS.map((k) => ({ id: k, label: t(`summary.${k}`), content: <KindView documentId={documentId} kind={k} /> }))}
    />
  );
}

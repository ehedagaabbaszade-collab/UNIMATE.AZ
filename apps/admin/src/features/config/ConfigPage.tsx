"use client";

import { Badge, Button, Textarea } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import type { MessageKey } from "@unimate/i18n";
import { useState } from "react";
import { Async, DataTable, PageHead, ReasonDialog, useActDialog, useActionToast, useAdminApi, type Column } from "../../components/kit";
import { CONFIG_KEYS, KNOWN_KEYS, isKnownKey, parseConfigValue } from "../../lib/config-keys";
import { redact } from "../../lib/redact";
import type { ConfigHistoryRow, ConfigRow } from "../../lib/rpc";
import { useAsync } from "../../lib/use-async";

interface Row {
  key: string;
  current: ConfigRow | null;
}
const show = (v: unknown) => JSON.stringify(redact(v));
const short = (id: string) => id.slice(0, 8);

export function ConfigPage() {
  const { t, dateTime, number } = useI18n();
  const api = useAdminApi();
  const toast = useActionToast();
  const state = useAsync(() => api.systemConfig(), []);
  const [editing, setEditing] = useState<Row | null>(null);
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const [err, setErr] = useState<MessageKey | null>(null);
  const history = useAsync(() => api.systemConfigHistory(historyKey ?? "", 0), [historyKey], historyKey !== null);
  const { open, dialog } = useActDialog(() => {
    state.reload();
    history.reload();
  });

  const revert = (h: ConfigHistoryRow) => {
    setHistoryKey(null);
    open({
      title: t("admin.config.revertTitle", { v: number(h.id) }),
      body: t("admin.config.revertBody"),
      confirm: t("admin.versions.revert"),
      danger: true,
      run: async (reason) => void (await api.revertSystemConfig(h.id, reason)),
    });
  };

  const rows = (d: ConfigRow[]): Row[] => {
    const by = new Map(d.map((r) => [r.key, r]));
    const keys = [...new Set([...KNOWN_KEYS, ...d.map((r) => r.key)])].sort();
    return keys.map((key) => ({ key, current: by.get(key) ?? null }));
  };
  const columns: Column<Row>[] = [
    { key: "key", header: t("admin.config.colKey"), cell: (r) => <code className="mono">{r.key}</code> },
    { key: "desc", header: t("admin.config.colMeaning"), cell: (r) => (isKnownKey(r.key) ? t(CONFIG_KEYS[r.key].desc) : <Badge tone="warning">{t("admin.config.unknownKey")}</Badge>) },
    { key: "value", header: t("admin.config.colValue"), cell: (r) => (r.current ? <code className="mono">{show(r.current.value)}</code> : <Badge>{t("admin.config.notSet")}</Badge>) },
    { key: "upd", header: t("admin.config.colUpdated"), cell: (r) => (r.current ? dateTime(r.current.updated_at, { dateStyle: "medium", timeStyle: "short" }) : t("admin.common.none")) },
    {
      key: "act",
      header: t("admin.common.actions"),
      cell: (r) => (
        <span className="row">
          {isKnownKey(r.key) ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setErr(null);
                setEditing(r);
              }}
            >
              {t("admin.common.edit")}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setHistoryKey(r.key)}>
            {t("admin.config.history")}
          </Button>
        </span>
      ),
    },
  ];
  const hCols: Column<ConfigHistoryRow>[] = [
    { key: "id", header: t("admin.versions.colVersion"), cell: (h) => `#${number(h.id)}` },
    { key: "at", header: t("admin.versions.colWhen"), cell: (h) => dateTime(h.created_at, { dateStyle: "medium", timeStyle: "short" }) },
    { key: "act", header: t("admin.versions.colAction"), cell: (h) => <code className="mono">{h.action}</code> },
    { key: "actor", header: t("admin.versions.colActor"), cell: (h) => (h.actor_id ? <span className="mono">{short(h.actor_id)}</span> : t("admin.common.none")) },
    { key: "reason", header: t("admin.common.reason"), cell: (h) => h.reason ?? t("admin.config.noReason") },
    { key: "val", header: t("admin.config.colValue"), cell: (h) => (h.action === "delete" ? <Badge>{t("admin.config.deleted")}</Badge> : <code className="mono">{show(h.value)}</code>) },
    {
      key: "rev",
      header: t("admin.common.actions"),
      cell: (h) => (
        <Button size="sm" variant="secondary" onClick={() => revert(h)}>
          {t("admin.versions.revert")}
        </Button>
      ),
    },
  ];
  const example = editing && isKnownKey(editing.key) ? CONFIG_KEYS[editing.key].example : "";

  return (
    <>
      <PageHead title={t("admin.config.title")} subtitle={t("admin.config.subtitle")} />
      <p className="warn-box">{t("admin.config.noConsumerNote")}</p>
      <div style={{ marginTop: "var(--space-4)" }}>
        <Async state={state}>{(d) => <DataTable caption={t("admin.config.title")} columns={columns} rows={rows(d)} rowKey={(r) => r.key} />}</Async>
      </div>
      {dialog}
      <ReasonDialog
        open={editing !== null}
        title={editing ? t("admin.config.editTitle", { key: editing.key }) : ""}
        confirmLabel={t("admin.common.save")}
        onClose={() => setEditing(null)}
        validate={(fd) => {
          const r = editing ? parseConfigValue(editing.key, String(fd.get("value") ?? "")) : null;
          if (r && !r.ok) {
            setErr(r.error);
            return { value: r.error };
          }
          setErr(null);
          return null;
        }}
        onConfirm={async (reason, fd) => {
          if (!editing) return;
          const r = parseConfigValue(editing.key, String(fd.get("value") ?? ""));
          if (!r.ok) throw new Error(r.error);
          await api.setSystemConfig(editing.key, r.value, reason);
          toast.ok();
          state.reload();
        }}
      >
        <Textarea
          key={editing?.key ?? "none"}
          name="value"
          label={t("admin.config.valueJson")}
          hint={t("admin.config.exampleHint", { example })}
          rows={5}
          maxLength={20000}
          defaultValue={editing?.current ? JSON.stringify(editing.current.value, null, 2) : example}
          error={err ? t(err) : undefined}
        />
      </ReasonDialog>
      <ReasonDialog open={historyKey !== null} hideReason title={historyKey ? t("admin.config.historyTitle", { key: historyKey }) : ""} confirmLabel={t("admin.common.back")} onClose={() => setHistoryKey(null)} onConfirm={async () => undefined}>
        <Async state={history} isEmpty={(d) => d.rows.length === 0}>
          {(d) => <DataTable caption={t("admin.config.history")} columns={hCols} rows={d.rows} rowKey={(h) => String(h.id)} />}
        </Async>
      </ReasonDialog>
    </>
  );
}

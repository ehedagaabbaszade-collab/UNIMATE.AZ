"use client";

import { Badge, Button, Input, Select, Textarea } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import { LOCALES, renderNotification, type Locale, type MessageKey } from "@unimate/i18n";
import { useMemo, useState } from "react";
import { Async, DataTable, PageHead, ReasonDialog, TabPanel, TabsNav, useActDialog, useActionToast, useAdminApi, type Column } from "../../components/kit";
import { contentKeySchema, contentTexts, parityVerdict, parseContentBody, templateSchema } from "../../lib/content-schemas";
import type { ContentRow, ContentVersionRow, TemplateRow, TemplateVersionRow } from "../../lib/rpc";
import { fieldErrors } from "../../lib/schemas";
import { completeness, placeholders, sampleFor, type MatrixRow } from "../../lib/template-params";
import { useAsync, type AsyncState } from "../../lib/use-async";

type Kind = "templates" | "content";
interface Target {
  kind: Kind;
  key: string;
  locale: Locale;
  isNew: boolean;
}
const localeOf = (v: string): Locale => (LOCALES as readonly string[]).includes(v) ? (v as Locale) : "az";
const short = (id: string) => id.slice(0, 8);

export function ContentPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Kind>("templates");
  return (
    <>
      <PageHead title={t("admin.content.title")} subtitle={t("admin.content.subtitle")} />
      <TabsNav
        label={t("admin.content.title")}
        items={[
          { id: "templates", label: t("admin.content.tabTemplates") },
          { id: "content", label: t("admin.content.tabContent") },
        ]}
        active={tab}
        onChange={setTab}
      />
      <TabPanel id={tab}>{tab === "templates" ? <Editor kind="templates" /> : <Editor kind="content" />}</TabPanel>
    </>
  );
}

function Editor({ kind }: { kind: Kind }) {
  const { t, dateTime, number } = useI18n();
  const api = useAdminApi();
  const toast = useActionToast();
  const isTpl = kind === "templates";
  const tpl = useAsync(() => api.templates(), [], isTpl);
  const cnt = useAsync(() => api.contents(), [], !isTpl);
  const state = (isTpl ? tpl : cnt) as AsyncState<Array<TemplateRow | ContentRow>>;
  const rowsData = isTpl ? tpl.data : cnt.data;
  const rows: Array<TemplateRow | ContentRow> = useMemo(() => rowsData ?? [], [rowsData]);
  const [target, setTarget] = useState<Target | null>(null);
  const [historyOf, setHistoryOf] = useState<Target | null>(null);
  const [draft, setDraft] = useState({ title: "", body: "" });
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const [parityMsg, setParityMsg] = useState<{ blocking: boolean; text: string } | null>(null);
  const versions = useAsync<Array<TemplateVersionRow | ContentVersionRow>>(
    () => (historyOf ? (isTpl ? api.templateVersions(historyOf.key, historyOf.locale) : api.contentVersions(historyOf.key, historyOf.locale)) : Promise.resolve([])),
    [historyOf?.key, historyOf?.locale, kind],
    historyOf !== null,
  );
  const { open, dialog } = useActDialog(() => {
    state.reload();
    versions.reload();
  });
  const matrix: MatrixRow[] = useMemo(() => completeness(rows), [rows]);
  const missingTotal = matrix.reduce((a, r) => a + r.missing.length, 0);

  const find = (key: string, locale: Locale) => rows.find((r) => r.key === key && r.locale === locale);
  const textsOf = (r: TemplateRow | ContentRow | undefined): string[] | undefined => (!r ? undefined : "title" in r ? [r.title, r.body ?? ""] : contentTexts(r.body));
  const othersOf = (key: string, locale: Locale) => Object.fromEntries(LOCALES.filter((l) => l !== locale).flatMap((l) => (textsOf(find(key, l)) ? [[l, textsOf(find(key, l))!]] : []))) as Partial<Record<Locale, string[]>>;

  const startEdit = (key: string, locale: Locale, isNew = false) => {
    const cur = find(key, locale);
    setErrors({});
    setParityMsg(null);
    setDraft(cur && "title" in cur ? { title: cur.title, body: cur.body ?? "" } : cur ? { title: "", body: JSON.stringify(cur.body, null, 2) } : { title: "", body: isTpl ? "" : "{}" });
    setTarget({ kind, key, locale, isNew });
  };

  const verdictFor = (key: string, locale: Locale, d = draft) => {
    if (isTpl) return parityVerdict(othersOf(key, locale), locale, [d.title, d.body]);
    const p = parseContentBody(d.body);
    return parityVerdict(othersOf(key, locale), locale, p.ok ? contentTexts(p.value) : []);
  };
  const parityText = (v: ReturnType<typeof verdictFor>) => {
    const parts = [...(v.blocking ? [v.blocking] : []), ...v.warnings].map((i) => t("admin.content.parityLine", { locale: t(`admin.content.locale.${i.locale}`), missing: i.missing.join(", ") || t("admin.common.none"), extra: i.extra.join(", ") || t("admin.common.none") }));
    return parts.join(" · ");
  };

  const revert = (v: TemplateVersionRow | ContentVersionRow) => {
    const h = historyOf;
    setHistoryOf(null);
    if (!h) return;
    open({
      title: t("admin.content.revertTitle"),
      body: t("admin.content.revertBody"),
      confirm: t("admin.versions.revert"),
      danger: true,
      run: async (reason) => void (isTpl ? await api.revertTemplate(v.id, reason) : await api.revertContent(h.key, h.locale, (v as ContentVersionRow).version, reason)),
    });
  };

  const cols: Column<MatrixRow>[] = [
    { key: "key", header: t("admin.content.colKey"), cell: (r) => <code className="mono">{r.key}</code> },
    ...LOCALES.map((l) => ({
      key: l,
      header: t(`admin.content.locale.${l}`),
      cell: (r: MatrixRow) => (
        <span className="row" style={{ justifyContent: "center", gap: 6 }}>
          <Badge tone={r.has[l] ? "success" : "warning"}>{r.has[l] ? t("admin.content.present") : t("admin.content.missing")}</Badge>
          <Button size="sm" variant={r.has[l] ? "secondary" : "primary"} onClick={() => startEdit(r.key, l)}>
            {r.has[l] ? t("admin.common.edit") : t("admin.content.add")}
          </Button>
          {r.has[l] ? (
            <Button size="sm" variant="ghost" onClick={() => setHistoryOf({ kind, key: r.key, locale: l, isNew: false })}>
              {t("admin.config.history")}
            </Button>
          ) : null}
        </span>
      ),
    })),
  ];

  const preview = useMemo(() => {
    if (!target || !isTpl) return null;
    const names = placeholders(`${draft.title}\n${draft.body}`);
    return renderNotification({ key: target.key, translations: { [target.locale]: { title: draft.title, body: draft.body || null } } }, sampleFor(names), target.locale, { escape: true });
  }, [target, isTpl, draft]);

  const submitData = (fd: FormData) => ({
    key: target?.isNew ? String(fd.get("key") ?? "") : (target?.key ?? ""),
    locale: target?.isNew ? localeOf(String(fd.get("locale") ?? "")) : (target?.locale ?? "az"),
    title: String(fd.get("title") ?? ""),
    body: String(fd.get("body") ?? ""),
  });

  return (
    <>
      <div className="row" style={{ marginBottom: "var(--space-3)" }}>
        <Button onClick={() => startEdit("", "az", true)}>{t("admin.content.newKey")}</Button>
        <span className="um-muted">{t("admin.content.completenessSummary", { keys: number(matrix.length), missing: number(missingTotal) })}</span>
      </div>
      <p className="hint-box">{t(isTpl ? "admin.content.templatesNote" : "admin.content.contentNote")}</p>
      <div className="matrix" style={{ marginTop: "var(--space-4)" }}>
        <Async state={state} isEmpty={() => matrix.length === 0}>
          {() => <DataTable caption={t("admin.content.matrix")} columns={cols} rows={matrix} rowKey={(r) => r.key} />}
        </Async>
      </div>
      {dialog}

      <ReasonDialog
        open={target !== null}
        title={target ? t(target.isNew ? "admin.content.newKey" : "admin.content.editTitle", { key: target.key, locale: t(`admin.content.locale.${target.locale}`) }) : ""}
        confirmLabel={t("admin.common.save")}
        onClose={() => setTarget(null)}
        validate={(fd) => {
          const d = submitData(fd);
          const e: Record<string, MessageKey> = {};
          if (isTpl) {
            const r = templateSchema.safeParse(d);
            if (!r.success) Object.assign(e, fieldErrors(r.error));
          } else {
            const k = contentKeySchema.safeParse(d.key);
            if (!k.success) e.key = "admin.content.errKey";
            const p = parseContentBody(d.body);
            if (!p.ok) e.body = p.error;
          }
          if (Object.keys(e).length === 0) {
            const v = verdictFor(d.key, d.locale, { title: d.title, body: d.body });
            setParityMsg(v.blocking || v.warnings.length ? { blocking: v.blocking !== null, text: parityText(v) } : null);
            if (v.blocking) e.body = "admin.content.errParity";
          }
          setErrors(e);
          return Object.keys(e).length > 0 ? e : null;
        }}
        onConfirm={async (reason, fd) => {
          const d = submitData(fd);
          if (isTpl) {
            const v = templateSchema.parse(d);
            await api.saveTemplate({ ...v, reason });
          } else {
            const p = parseContentBody(d.body);
            if (!p.ok) throw new Error(p.error);
            await api.saveContent({ key: contentKeySchema.parse(d.key), locale: d.locale, body: p.value, reason });
          }
          toast.ok();
          state.reload();
        }}
      >
        <div className="stack" key={target ? `${target.key}:${target.locale}:${String(target.isNew)}` : "none"}>
          <Input name="key" label={t("admin.content.colKey")} hint={t("admin.content.keyHint")} defaultValue={target?.key ?? ""} readOnly={!target?.isNew} error={errors.key && t(errors.key)} />
          <Select name="locale" label={t("admin.content.colLocale")} defaultValue={target?.locale ?? "az"} disabled={!target?.isNew}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {t(`admin.content.locale.${l}`)}
              </option>
            ))}
          </Select>
          {target && !target.isNew ? <input type="hidden" name="locale" value={target.locale} /> : null}
          {isTpl ? <Input name="title" label={t("admin.content.fieldTitle")} value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} maxLength={200} error={errors.title && t(errors.title)} /> : null}
          <Textarea name="body" label={t(isTpl ? "admin.content.fieldBody" : "admin.content.fieldJson")} hint={t("admin.content.placeholderHint")} rows={isTpl ? 4 : 10} maxLength={isTpl ? 2000 : 200000} value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} error={errors.body && t(errors.body)} />
          {parityMsg ? (
            <p className={parityMsg.blocking ? "err-box" : "warn-box"} role="status">
              {parityMsg.text}
            </p>
          ) : null}
          {preview ? (
            <div className="hint-box" aria-live="polite">
              <strong>{t("admin.content.preview")}</strong>
              <p style={{ margin: "var(--space-1) 0 0" }}>{preview.title}</p>
              {preview.body ? <p style={{ margin: 0, fontWeight: 400 }}>{preview.body}</p> : null}
              <p className="um-muted" style={{ margin: "var(--space-2) 0 0", fontWeight: 400 }}>
                {t("admin.content.previewNote")}
              </p>
            </div>
          ) : null}
        </div>
      </ReasonDialog>

      <ReasonDialog
        open={historyOf !== null}
        hideReason
        title={historyOf ? t("admin.content.historyTitle", { key: historyOf.key, locale: t(`admin.content.locale.${historyOf.locale}`) }) : ""}
        confirmLabel={t("admin.common.back")}
        onClose={() => setHistoryOf(null)}
        onConfirm={async () => undefined}
      >
        <Async state={versions} isEmpty={(d) => d.length === 0}>
          {(d) => (
            <DataTable
              caption={t("admin.config.history")}
              rows={d as Array<TemplateVersionRow | ContentVersionRow>}
              rowKey={(v) => String(v.id)}
              columns={[
                { key: "v", header: t("admin.versions.colVersion"), cell: (v) => `#${number("version" in v ? v.version : v.id)}` },
                { key: "at", header: t("admin.versions.colWhen"), cell: (v) => dateTime(v.created_at, { dateStyle: "medium", timeStyle: "short" }) },
                { key: "actor", header: t("admin.versions.colActor"), cell: (v) => (v.actor_id ? <span className="mono">{short(v.actor_id)}</span> : t("admin.common.none")) },
                { key: "reason", header: t("admin.common.reason"), cell: (v) => v.reason ?? t("admin.config.noReason") },
                {
                  key: "act",
                  header: t("admin.common.actions"),
                  cell: (v) => (
                    <Button size="sm" variant="secondary" onClick={() => revert(v)}>
                      {t("admin.versions.revert")}
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </Async>
      </ReasonDialog>
    </>
  );
}

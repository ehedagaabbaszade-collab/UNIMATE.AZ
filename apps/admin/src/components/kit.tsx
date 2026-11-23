"use client";

import { Button, Dialog, EmptyState, ErrorState, Input, Skeleton, Textarea, useToast } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import type { MessageKey } from "@unimate/i18n";
import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { errorKey, keyForCode } from "../lib/errors";
import { PAGE_SIZE, createAdminApi, type AdminApi } from "../lib/rpc";
import { reasonSchema } from "../lib/schemas";
import { getBrowserClient } from "../lib/supabase/browser";
import type { AsyncState } from "../lib/use-async";

/** One API object per mounted page, bound to the browser client (user JWT, anon key). Throws when not configured. */
export function useAdminApi(): AdminApi {
  return useMemo(() => createAdminApi(getBrowserClient()), []);
}

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-head row row--between" style={{ alignItems: "flex-start" }}>
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}

/** Loading / error / empty / content switch shared by every list. */
export function Async<T>({ state, isEmpty, children }: { state: AsyncState<T>; isEmpty?: (d: T) => boolean; children: (d: T) => ReactNode }) {
  const { t } = useI18n();
  if (state.loading && state.data === undefined) {
    return (
      <div className="stack" aria-busy="true" aria-live="polite">
        <span className="um-sr-only">{t("admin.common.loading")}</span>
        <Skeleton height={44} />
        <Skeleton height={44} />
        <Skeleton height={44} />
      </div>
    );
  }
  if (state.error !== null && state.data === undefined) {
    return <ErrorState title={t("admin.common.errorTitle")} description={t(keyForCode(state.error))} action={<Button onClick={state.reload}>{t("admin.common.retry")}</Button>} />;
  }
  if (state.data === undefined) return null;
  if (isEmpty?.(state.data)) return <EmptyState title={t("admin.common.empty")} />;
  return <>{children(state.data)}</>;
}

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
}

/**
 * Accessible data table. A named region (scrollable on narrow screens), real <table> semantics, and roving-tabindex
 * keyboard navigation between rows (Arrow Up/Down, Home, End). On narrow screens rows render as cards (CSS, data-label).
 * Interactive cells (buttons, links) stay in the normal tab order.
 */
export function DataTable<T>({ caption, columns, rows, rowKey }: { caption: string; columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string }) {
  const { t } = useI18n();
  const body = useRef<HTMLTableSectionElement>(null);
  const [active, setActive] = useState(0);
  const move = (to: number) => {
    const trs = body.current?.querySelectorAll<HTMLTableRowElement>("tr[data-row]");
    if (!trs || trs.length === 0) return;
    const i = Math.max(0, Math.min(trs.length - 1, to));
    setActive(i);
    trs[i]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTableRowElement>, index: number) => {
    if (e.target !== e.currentTarget) return; // keys inside buttons/inputs keep their own meaning
    if (e.key === "ArrowDown") move(index + 1);
    else if (e.key === "ArrowUp") move(index - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(rows.length - 1);
    else return;
    e.preventDefault();
  };
  return (
    <div className="dt-wrap" role="region" aria-label={caption} tabIndex={0}>
      <table className="dt">
        <caption className="um-sr-only">
          {caption}. {t("admin.common.tableHelp")}
        </caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={body}>
          {rows.map((r, i) => (
            <tr key={rowKey(r)} data-row="" tabIndex={i === Math.min(active, rows.length - 1) ? 0 : -1} onKeyDown={(e) => onKeyDown(e, i)} onFocus={(e) => e.target === e.currentTarget && setActive(i)}>
              {columns.map((c) => (
                <td key={c.key} data-label={c.header}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ page, total, onPage, size = PAGE_SIZE }: { page: number; total: number; onPage: (p: number) => void; size?: number }) {
  const { t, number } = useI18n();
  if (total <= 0) return null;
  const from = page * size + 1;
  const to = Math.min(total, (page + 1) * size);
  return (
    <nav className="row row--between pager" aria-label={t("admin.common.pageNav")}>
      <span className="um-muted" aria-live="polite">
        {t("admin.common.range", { from: number(from), to: number(to), total: number(total) })}
      </span>
      <span className="row">
        <Button variant="secondary" size="sm" disabled={page <= 0} onClick={() => onPage(page - 1)}>
          {t("admin.common.prev")}
        </Button>
        <Button variant="secondary" size="sm" disabled={to >= total} onClick={() => onPage(page + 1)}>
          {t("admin.common.next")}
        </Button>
      </span>
    </nav>
  );
}

export function SearchBox({ label, value, onSearch }: { label: string; value: string; onSearch: (v: string) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSearch(draft.trim());
  };
  return (
    <form className="row searchbox" role="search" onSubmit={submit}>
      <Input label={label} type="search" value={draft} maxLength={100} onChange={(e) => setDraft(e.target.value)} />
      <Button type="submit" variant="secondary">
        {t("admin.common.search")}
      </Button>
      {value ? (
        <Button
          variant="ghost"
          onClick={() => {
            setDraft("");
            onSearch("");
          }}
        >
          {t("admin.common.clear")}
        </Button>
      ) : null}
    </form>
  );
}

export interface ReasonDialogProps {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  danger?: boolean;
  /** Extra form fields rendered above the reason (e.g. new role, plan). They live in the same <form>. */
  children?: ReactNode;
  /** When false the reason is optional (still validated when present). Default: required. */
  reasonRequired?: boolean;
  /** For actions whose RPC takes no reason: a plain confirmation, no reason field. */
  hideReason?: boolean;
  onClose: () => void;
  /** Receives the validated reason and the raw FormData. Must throw on failure. NOT optimistic: the dialog waits. */
  onConfirm: (reason: string, form: FormData) => Promise<void>;
  validate?: (form: FormData) => Record<string, MessageKey> | null;
}

/** Confirmation dialog with a required, validated reason. The caller performs the RPC; success toasts and reloads happen after it resolves. */
export function ReasonDialog({ open, title, body, confirmLabel, danger, children, reasonRequired = true, hideReason = false, onClose, onConfirm, validate }: ReasonDialogProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const [formError, setFormError] = useState<MessageKey | null>(null);
  const close = () => {
    if (busy) return;
    setErrors({});
    setFormError(null);
    onClose();
  };
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw = String(fd.get("reason") ?? "");
    const errs: Record<string, MessageKey> = { ...(validate?.(fd) ?? {}) };
    const r = hideReason || (!reasonRequired && !raw.trim()) ? { success: true as const, data: "" } : reasonSchema.safeParse(raw);
    if (!r.success) errs.reason = "admin.common.reasonInvalid";
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setFormError(null);
    setBusy(true);
    try {
      await onConfirm(r.success ? r.data : "", fd);
      setBusy(false);
      onClose();
    } catch (err) {
      setBusy(false);
      setFormError(errorKey(err));
    }
  }
  return (
    <Dialog open={open} onClose={close} title={title}>
      <form onSubmit={submit} noValidate className="stack">
        {body ? <p className="um-muted">{body}</p> : null}
        {formError ? (
          <p className="err-box" role="alert">
            {t(formError)}
          </p>
        ) : null}
        {children}
        {hideReason ? null : <Textarea name="reason" label={reasonRequired ? t("admin.common.reason") : t("admin.career.optionalReason")} hint={t("admin.common.reasonHint")} rows={3} maxLength={500} error={errors.reason && t(errors.reason)} />}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={close} disabled={busy}>
            {t("admin.common.cancel")}
          </Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Success/error toasts for privileged actions. Never optimistic: call after the RPC resolved. */
export function useActionToast() {
  const { t } = useI18n();
  const { toast } = useToast();
  return {
    ok: (message?: string) => toast(message ?? t("admin.common.done"), "success"),
    fail: (err: unknown) => toast(t(errorKey(err)), "error"),
  };
}

/** Accessible tab strip (role=tablist, roving focus, arrow keys). The caller renders the active panel. */
export function TabsNav<T extends string>({ label, items, active, onChange }: { label: string; items: ReadonlyArray<{ id: T; label: string }>; active: T; onChange: (id: T) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = items.findIndex((x) => x.id === active);
    let n: number;
    if (e.key === "ArrowRight") n = (i + 1) % items.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = items.length - 1;
    else return;
    e.preventDefault();
    const next = items[n];
    if (next) {
      onChange(next.id);
      refs.current[next.id]?.focus();
    }
  };
  return (
    <div className="tabs-nav" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {items.map((it) => (
        <button key={it.id} ref={(el) => { refs.current[it.id] = el; }} type="button" role="tab" id={`tab-${it.id}`} aria-selected={it.id === active} aria-controls={`panel-${it.id}`} tabIndex={it.id === active ? 0 : -1} onClick={() => onChange(it.id)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`}>
      {children}
    </div>
  );
}

export interface ActSpec {
  title: string;
  body?: string;
  confirm: string;
  danger?: boolean;
  hideReason?: boolean;
  reasonRequired?: boolean;
  run: (reason: string) => Promise<void>;
}
/** One confirm-with-reason dialog driven by an action spec; success toast + reload only after the RPC resolved. */
export function useActDialog(reload: () => void) {
  const [act, setAct] = useState<ActSpec | null>(null);
  const toast = useActionToast();
  const dialog = (
    <ReasonDialog
      open={act !== null}
      title={act?.title ?? ""}
      {...(act?.body ? { body: act.body } : {})}
      confirmLabel={act?.confirm ?? ""}
      {...(act?.danger ? { danger: true } : {})}
      {...(act?.hideReason ? { hideReason: true } : {})}
      {...(act?.reasonRequired === false ? { reasonRequired: false } : {})}
      onClose={() => setAct(null)}
      onConfirm={async (reason) => {
        if (!act) return;
        await act.run(reason);
        toast.ok();
        reload();
      }}
    />
  );
  return { open: setAct, dialog };
}

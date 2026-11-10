import type { MessageKey } from "@unimate/i18n";
import { z } from "zod";
import { toCsv } from "./csv";
import { redact } from "./redact";
import type { AuditFilter, AuditRow } from "./rpc";

export const EMPTY_AUDIT_FILTER: AuditFilter = { actor: "", action: "", entityType: "", entityId: "", from: "", to: "" };

const uuid = z.string().uuid();
const day = /^\d{4}-\d{2}-\d{2}$/;
const startOf = (d: string): Date | null => {
  if (!day.test(d)) return null;
  const x = new Date(`${d}T00:00:00`);
  return Number.isNaN(x.getTime()) ? null : x;
};

/** Validates the filter form. Dates are calendar days in the browser's zone; `to` is inclusive (sent as the next midnight, exclusive). */
export function parseAuditFilter(raw: Record<keyof AuditFilter, string>): { ok: true; filter: AuditFilter } | { ok: false; errors: Partial<Record<keyof AuditFilter, MessageKey>> } {
  const errors: Partial<Record<keyof AuditFilter, MessageKey>> = {};
  const v = Object.fromEntries(Object.entries(raw).map(([k, s]) => [k, s.trim()])) as Record<keyof AuditFilter, string>;
  if (v.actor && !uuid.safeParse(v.actor).success) errors.actor = "admin.audit.errActor";
  if (v.action.length > 100 || !/^[A-Za-z0-9_.:-]*$/.test(v.action)) errors.action = "admin.audit.errAction";
  if (v.entityType.length > 60 || !/^[A-Za-z0-9_.:-]*$/.test(v.entityType)) errors.entityType = "admin.audit.errAction";
  if (v.entityId.length > 200) errors.entityId = "admin.audit.errAction";
  const from = v.from ? startOf(v.from) : null;
  const to = v.to ? startOf(v.to) : null;
  if (v.from && !from) errors.from = "admin.audit.errDate";
  if (v.to && !to) errors.to = "admin.audit.errDate";
  if (from && to && to < from) errors.to = "admin.audit.errRange";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, filter: { ...v, from: from ? from.toISOString() : "", to: to ? new Date(to.getTime() + 24 * 3600 * 1000).toISOString() : "" } };
}

/** CSV of the rows currently shown. Metadata is redacted first, then every cell is formula-neutralised by toCsv. */
export function auditCsv(rows: ReadonlyArray<AuditRow>, header: readonly string[]): string {
  return toCsv([header, ...rows.map((r) => [r.id, r.created_at, r.actor_id, r.action, r.entity_type, r.entity_id, JSON.stringify(redact(r.metadata))])]);
}

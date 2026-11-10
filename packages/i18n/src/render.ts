import { escapeHtml, renderEmailTemplate, renderTemplate, type TemplateParams } from "@unimate/core";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./locales";

/** A notification template as stored in public.notification_templates, grouped by key. */
export interface NotificationTemplate {
  key: string;
  translations: Partial<Record<Locale, { title: string; body?: string | null }>>;
  /** Legacy title/body stored on the notification row itself (used when the key has no usable translation). */
  legacy?: { title?: string | null; body?: string | null };
}
export interface RenderedNotification {
  title: string;
  body: string | null;
  /** The locale actually used (differs from the requested one after fallback). */
  locale: Locale;
}
export interface RenderOptions {
  /**
   * true (default): substituted VALUES are HTML-escaped (core renderEmailTemplate rules): safe for HTML emails.
   * false: plain text for React / React Native text nodes and push payloads, which must not show "&amp;".
   */
  escape?: boolean;
}

/** Groups flat DB rows (key, locale, title, body) into templates. Rows with an unsupported locale are ignored. */
export function groupTemplates(rows: ReadonlyArray<{ key: string; locale: string; title: string; body?: string | null }>): Map<string, NotificationTemplate> {
  const out = new Map<string, NotificationTemplate>();
  for (const r of rows) {
    if (!isLocale(r.locale)) continue;
    const tpl = out.get(r.key) ?? { key: r.key, translations: {} };
    tpl.translations[r.locale] = { title: r.title, body: r.body ?? null };
    out.set(r.key, tpl);
  }
  return out;
}

/**
 * Server-side rendering (edge functions, email senders, admin previews). Mirrors public.render_notification_fields:
 * requested locale -> az -> legacy title/body -> the key. Never throws.
 */
export function renderNotification(
  template: NotificationTemplate,
  params: TemplateParams = {},
  locale: Locale | string = DEFAULT_LOCALE,
  opts: RenderOptions = {},
): RenderedNotification {
  const escape = opts.escape ?? true;
  const fill = (s: string) => (escape ? renderEmailTemplate(s, params) : renderTemplate(s, params));
  const raw = (s: string) => (escape ? escapeHtml(s) : s);
  const wanted = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const chosen = template.translations[wanted] ? wanted : template.translations[DEFAULT_LOCALE] ? DEFAULT_LOCALE : null;
  if (chosen) {
    const tr = template.translations[chosen]!;
    return { title: fill(tr.title), body: tr.body == null ? null : fill(tr.body), locale: chosen };
  }
  const legacy = template.legacy;
  return { title: raw(legacy?.title ?? template.key), body: legacy?.body == null ? null : raw(legacy.body), locale: DEFAULT_LOCALE };
}

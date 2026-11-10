export type TemplateParams = Readonly<Record<string, string | number | boolean | null | undefined>>;

/**
 * Single-pass `{key}` substitution (mirrors public.render_template_text): the template is scanned once and substituted
 * values are never scanned again, so a value that contains "{other}" stays literal. Unknown keys are left as written;
 * null/undefined values render as "". Own properties only ("constructor" and friends are never looked up).
 */
export function renderTemplate(template: string, params: TemplateParams = {}): string {
  return template.replace(/\{([^{}]+)\}/g, (m, key: string) => (Object.hasOwn(params, key) ? String(params[key] ?? "") : m));
}

const HTML_ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes text for HTML element content and quoted attribute values. */
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);

/**
 * Email (HTML) rendering: the template is trusted copy, every substituted VALUE is HTML-escaped (user names, document
 * titles, ... are user-controlled). Single pass, like renderTemplate.
 */
export function renderEmailTemplate(template: string, params: TemplateParams = {}): string {
  return template.replace(/\{([^{}]+)\}/g, (m, key: string) => (Object.hasOwn(params, key) ? escapeHtml(String(params[key] ?? "")) : m));
}

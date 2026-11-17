import { Icon } from "./icons";
import { RevealInput } from "./interactive";
import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

// ---------------------------------------------------------------- Button
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  block?: boolean;
  loading?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", block, loading, className, disabled, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx("um-btn", variant !== "primary" && `um-btn--${variant}`, size === "sm" && "um-btn--sm", block && "um-btn--block", className)}
      {...rest}
    >
      {loading ? <span className="um-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------- Field wrappers
interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string | undefined;
  id?: string;
}
function useFieldIds(id?: string) {
  const auto = useId();
  const base = id ?? auto;
  return { id: base, hintId: `${base}-hint`, errorId: `${base}-error` };
}
function describedBy(ids: { hintId: string; errorId: string }, hint?: string, error?: string) {
  const parts = [hint ? ids.hintId : null, error ? ids.errorId : null].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}
function FieldShell({ label, hint, error, ids, children }: FieldShellProps & { ids: ReturnType<typeof useFieldIds>; children: ReactNode }) {
  return (
    <div className="um-field">
      <label className="um-label" htmlFor={ids.id}>
        {label}
      </label>
      {children}
      {hint ? (
        <p className="um-hint" id={ids.hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="um-error-text" id={ids.errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  hint?: string;
  error?: string | undefined;
  id?: string;
  /** Password fields: labels for the show/hide toggle (eye when hidden, crossed eye when shown). */
  reveal?: { show: string; hide: string };
}
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, hint, error, id, className, reveal, type, ...rest }, ref) {
  const ids = useFieldIds(id);
  const props = { ...rest, id: ids.id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy(ids, hint, error) };
  return (
    <FieldShell label={label} hint={hint} error={error} ids={ids}>
      {reveal ? (
        <RevealInput ref={ref} reveal={reveal} className={cx("um-input", "um-input--reveal", className)} {...props} />
      ) : (
        <input ref={ref} type={type} className={cx("um-input", className)} {...props} />
      )}
    </FieldShell>
  );
});

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  label: string;
  hint?: string;
  error?: string | undefined;
  id?: string;
}
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, hint, error, id, className, ...rest }, ref) {
  const ids = useFieldIds(id);
  return (
    <FieldShell label={label} hint={hint} error={error} ids={ids}>
      <textarea
        ref={ref}
        id={ids.id}
        className={cx("um-input", className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids, hint, error)}
        {...rest}
      />
    </FieldShell>
  );
});

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  label: string;
  hint?: string;
  error?: string | undefined;
  id?: string;
}
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, hint, error, id, className, children, ...rest }, ref) {
  const ids = useFieldIds(id);
  return (
    <FieldShell label={label} hint={hint} error={error} ids={ids}>
      <select
        ref={ref}
        id={ids.id}
        className={cx("um-input", className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids, hint, error)}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
});

// ---------------------------------------------------------------- Card / Badge / Skeleton / Avatar
export function Card({ className, flat, ...rest }: HTMLAttributes<HTMLDivElement> & { flat?: boolean }) {
  return <div className={cx("um-card", flat && "um-card--flat", className)} {...rest} />;
}

export type BadgeTone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";
export function Badge({ tone = "neutral", className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return <span className={cx("um-badge", tone !== "neutral" && `um-badge--${tone}`, className)} {...rest} />;
}

export function Skeleton({ width, height = 16, className, style }: { width?: number | string; height?: number | string; className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden="true" className={cx("um-skeleton", className)} style={{ width: width ?? "100%", height, ...style }} />;
}

export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0]!)[0] ?? "";
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1]!)[0] ?? "") : "";
  return (first + last).toLocaleUpperCase();
}

export function Avatar({ name, src, size = 40 }: { name?: string | null; src?: string | null; size?: number }) {
  return (
    <span className="um-avatar" style={{ width: size, height: size, fontSize: size * 0.4 }} role="img" aria-label={name ?? undefined}>
      {src ? <img src={src} alt="" /> : initialsOf(name)}
    </span>
  );
}

// ---------------------------------------------------------------- States
const STATE_ICON = <Icon name="materials" size="lg" />;
const ERROR_ICON = <Icon name="error" size="lg" />;

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="um-state">
      <span className="um-state__icon">{icon ?? STATE_ICON}</span>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="um-state um-state--error" role="alert">
      <span className="um-state__icon">{icon ?? ERROR_ICON}</span>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

// ---------------------------------------------------------------- ProgressRing
export function ProgressRing({
  value,
  max = 100,
  size = 96,
  stroke = 9,
  label,
  children,
}: {
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
  /** Accessible description, e.g. "3 of 10 documents used". */
  label: string;
  children?: ReactNode;
}) {
  const gradId = useId();
  const safeMax = max > 0 ? max : 1;
  const ratio = Math.min(1, Math.max(0, value / safeMax));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="um-ring" style={{ width: size, height: size }} role="progressbar" aria-valuemin={0} aria-valuemax={safeMax} aria-valuenow={Math.min(Math.max(value, 0), safeMax)} aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--um-indigo)" }} />
            <stop offset="55%" style={{ stopColor: "var(--um-purple)" }} />
            <stop offset="100%" style={{ stopColor: "var(--um-blue)" }} />
          </linearGradient>
        </defs>
        <circle className="um-ring__track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle className="um-ring__bar" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} stroke={`url(#${gradId})`} strokeDasharray={c} strokeDashoffset={c * (1 - ratio)} />
      </svg>
      <span className="um-ring__label">{children}</span>
    </span>
  );
}

// ---------------------------------------------------------------- OfflineBanner (presentational)
export function OfflineBanner({ online, message, children }: { online: boolean; message: string; children?: ReactNode }) {
  if (online) return null;
  return (
    <div className="um-offline" role="status" aria-live="polite">
      <Icon name="offline" size="xs" />
      <span>{message}</span>
      {children}
    </div>
  );
}

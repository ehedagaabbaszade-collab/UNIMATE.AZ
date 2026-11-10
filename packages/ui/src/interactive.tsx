"use client";

import { Icon } from "./icons";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";

// ---------------------------------------------------------------- Tabs
export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}
export function Tabs({ items, defaultId, label, onChange }: { items: TabItem[]; defaultId?: string; label: string; onChange?: (id: string) => void }) {
  const uid = useId();
  const [active, setActive] = useState(defaultId ?? items[0]?.id ?? "");
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const select = (id: string) => {
    setActive(id);
    onChange?.(id);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const idx = items.findIndex((i) => i.id === active);
    let next: number;
    if (e.key === "ArrowRight") next = (idx + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else return;
    e.preventDefault();
    const target = items[next];
    if (target) {
      select(target.id);
      refs.current[target.id]?.focus();
    }
  };
  const current = items.find((i) => i.id === active);
  return (
    <div>
      <div className="um-tablist" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {items.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`${uid}-tab-${t.id}`}
            aria-selected={t.id === active}
            aria-controls={`${uid}-panel-${t.id}`}
            tabIndex={t.id === active ? 0 : -1}
            className="um-tab"
            onClick={() => select(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {current ? (
        <div className="um-tabpanel" role="tabpanel" id={`${uid}-panel-${current.id}`} aria-labelledby={`${uid}-tab-${current.id}`} tabIndex={0}>
          {current.content}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Dialog (native <dialog>: focus trap, Esc, inert background)
export function Dialog({ open, onClose, title, children, actions }: { open: boolean; onClose: () => void; title: string; children?: ReactNode; actions?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
    } else if (!open && el.open) {
      if (typeof el.close === "function") el.close();
      else el.removeAttribute("open");
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="um-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open ? (
        <>
          <h2 id={titleId}>{title}</h2>
          <div style={{ marginTop: "var(--space-3)" }}>{children}</div>
          {actions ? <div className="um-dialog__actions">{actions}</div> : null}
        </>
      ) : null}
    </dialog>
  );
}

// ---------------------------------------------------------------- Toast
export type ToastTone = "info" | "success" | "error";
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}
const ToastContext = createContext<{ toast: (message: string, tone?: ToastTone) => void } | null>(null);

export function ToastProvider({ children, dismissLabel = "Dismiss" }: { children: ReactNode; dismissLabel?: string }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const toast = useCallback((message: string, tone: ToastTone = "info") => {
    const id = ++counter.current;
    setItems((cur) => [...cur.slice(-3), { id, tone, message }]);
    setTimeout(() => setItems((cur) => cur.filter((i) => i.id !== id)), 6000);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="um-toasts" role="region" aria-label="Notifications">
        {items.map((t) => (
          <div key={t.id} className={`um-toast um-toast--${t.tone}`} role={t.tone === "error" ? "alert" : "status"}>
            <span>{t.message}</span>
            <button type="button" aria-label={dismissLabel} onClick={() => setItems((cur) => cur.filter((i) => i.id !== t.id))}>
              <Icon name="close" size="sm" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

// ---------------------------------------------------------------- online status
function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

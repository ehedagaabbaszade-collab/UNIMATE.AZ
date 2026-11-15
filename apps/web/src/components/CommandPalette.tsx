"use client";

import { Icon } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { MessageKey } from "@unimate/i18n";
import { ACTIONS, PAGES, filterItems, type NavItem } from "./nav";

/**
 * Ctrl/⌘ K "go to" palette: every page and quick action, filtered as you type.
 * Native <dialog> (focus trap, Esc, inert page) + ARIA combobox/listbox with arrow-key navigation.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uid = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setQuery("");
      setActive(0);
      el.showModal();
      // Phones: keep the on-screen keyboard down so the full list is visible; typing is one tap away.
      if (window.matchMedia?.("(pointer: fine)").matches) inputRef.current?.focus();
      else el.focus();
    } else if (!open && el.open) el.close();
  }, [open]);

  const sections = useMemo(() => {
    const label = (k: MessageKey) => t(k);
    return [
      { id: "actions", title: t("palette.actions"), items: filterItems(ACTIONS, query, label, locale) },
      { id: "pages", title: t("palette.pages"), items: filterItems(PAGES, query, label, locale) },
    ].filter((s) => s.items.length > 0);
  }, [query, t, locale]);
  const flat: NavItem[] = sections.flatMap((s) => s.items);
  const optionId = (i: number) => `${uid}-opt-${i}`;

  function go(item: NavItem | undefined) {
    if (!item) return;
    onClose();
    router.push(item.href);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") setActive((a) => (flat.length ? (a + 1) % flat.length : 0));
    else if (e.key === "ArrowUp") setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0));
    else if (e.key === "Enter") go(flat[active]);
    else return;
    e.preventDefault();
  }

  useEffect(() => {
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  let index = -1;
  return (
    <dialog
      ref={ref}
      className="palette"
      tabIndex={-1}
      // Native light dismiss (click outside, Esc, back gesture). Not in React's types yet, hence the spread.
      {...{ closedby: "any" }}
      aria-label={t("palette.title")}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(); // backdrop click: fallback where `closedby` is unsupported
      }}
    >
      {open ? (
        <div className="palette__body">
          <div className="palette__search">
            <Icon name="search" size={20} />
            <input
              ref={inputRef}
              className="palette__input"
              role="combobox"
              aria-expanded="true"
              aria-controls={`${uid}-list`}
              aria-activedescendant={flat.length ? optionId(active) : undefined}
              aria-label={t("palette.title")}
              placeholder={t("palette.placeholder")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
            <kbd className="palette__kbd" aria-hidden="true">{"Esc"}</kbd>
          </div>
          <div id={`${uid}-list`} role="listbox" aria-label={t("palette.title")} className="palette__list">
            {flat.length === 0 ? (
              <p className="palette__empty">{t("palette.empty", { q: query })}</p>
            ) : (
              sections.map((s) => (
                <div key={s.id} role="group" aria-label={s.title}>
                  <p className="palette__section" aria-hidden="true">{s.title}</p>
                  {s.items.map((item) => {
                    index += 1;
                    const i = index;
                    return (
                      <div
                        key={`${s.id}-${item.key}`}
                        id={optionId(i)}
                        role="option"
                        aria-selected={i === active}
                        className="palette__option"
                        onMouseMove={() => setActive(i)}
                        onClick={() => go(item)}
                      >
                        <Icon name={item.icon} size={20} />
                        <span>{t(item.key)}</span>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

/** Global Ctrl/⌘ K shortcut. */
export function usePaletteShortcut(toggle: () => void) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
}

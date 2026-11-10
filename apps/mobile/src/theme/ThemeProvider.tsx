import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Appearance, useColorScheme } from "react-native";
import { KEYS, kv } from "../lib/storage";
import { DEFAULT_THEME_PREF, isThemePref, palettes, resolveMode, type Palette, type ThemePref } from "./tokens";

interface Ctx {
  theme: Palette;
  pref: ThemePref;
  setPref: (p: ThemePref) => void;
}
const ThemeCtx = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [pref, setPrefState] = useState<ThemePref>(DEFAULT_THEME_PREF);
  /** The saved preference is read before anything renders, so a light-mode user never sees a dark flash at startup. */
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void kv
      .getItem(KEYS.theme)
      .then((v) => {
        if (isThemePref(v)) setPrefState(v);
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  // Native chrome (keyboard, alerts, native tab bar, system sheets) follows the chosen theme, not just our own views.
  useEffect(() => {
    try {
      Appearance.setColorScheme(pref === "system" ? "unspecified" : pref);
    } catch {
      /* unsupported platform: JS theme still applies */
    }
  }, [pref]);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    void kv.setItem(KEYS.theme, p).catch(() => undefined);
  }, []);

  const value = useMemo(() => ({ theme: palettes[resolveMode(pref, system === "light" ? "light" : system === "dark" ? "dark" : null)], pref, setPref }), [pref, system, setPref]);
  if (!ready) return null; // splash screen is still up (preventAutoHideAsync), so nothing visible is skipped
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Ctx {
  const v = useContext(ThemeCtx);
  if (!v) throw new Error("useTheme outside ThemeProvider");
  return v;
}

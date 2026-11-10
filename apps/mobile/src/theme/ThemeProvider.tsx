import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
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

  useEffect(() => {
    void kv.getItem(KEYS.theme).then((v) => {
      if (isThemePref(v)) setPrefState(v);
    });
  }, []);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    void kv.setItem(KEYS.theme, p).catch(() => undefined);
  }, []);

  const value = useMemo(() => ({ theme: palettes[resolveMode(pref, system === "light" ? "light" : system === "dark" ? "dark" : null)], pref, setPref }), [pref, system, setPref]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Ctx {
  const v = useContext(ThemeCtx);
  if (!v) throw new Error("useTheme outside ThemeProvider");
  return v;
}

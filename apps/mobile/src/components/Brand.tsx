import { useT } from "@unimate/i18n/react";
import { Image, View } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { AppText } from "./ui";

/** Intrinsic sizes of the official brand-pack PNGs (assets/*.png, see docs/BRAND_IDENTITY.md). */
const ASSETS = {
  logo: { src: require("../../assets/full-logo.png") as number, w: 800, h: 678 },
  logoWhite: { src: require("../../assets/full-logo-white.png") as number, w: 800, h: 678 },
  mark: { src: require("../../assets/mark.png") as number, w: 320, h: 375 },
  markWhite: { src: require("../../assets/mark-white.png") as number, w: 320, h: 375 },
  wordmark: { src: require("../../assets/wordmark.png") as number, w: 640, h: 131 },
  wordmarkWhite: { src: require("../../assets/wordmark-white.png") as number, w: 640, h: 131 },
};

const fit = (a: { w: number; h: number }, height: number) => ({ width: Math.round((height * a.w) / a.h), height: Math.round(height) });

/** Brandmark only. Light = gradient mark, dark = white mark. */
export function BrandMark({ height = 40 }: { height?: number }) {
  const t = useT();
  const { theme } = useTheme();
  const a = theme.mode === "dark" ? ASSETS.markWhite : ASSETS.mark;
  return <Image source={a.src} style={fit(a, height)} accessibilityRole="image" accessibilityLabel={t("brand.mark")} resizeMode="contain" />;
}

/** Stacked official logo: gradient on light, white on dark. */
export function BrandLogo({ height = 120 }: { height?: number }) {
  const t = useT();
  const { theme } = useTheme();
  const a = theme.mode === "dark" ? ASSETS.logoWhite : ASSETS.logo;
  return <Image source={a.src} style={fit(a, height)} accessibilityRole="image" accessibilityLabel={t("brand.logo")} resizeMode="contain" />;
}

/** Header lockup as on the approved Home mockup: mark + wordmark + tagline. */
export function BrandHeader({ height = 44 }: { height?: number }) {
  const t = useT();
  const { theme } = useTheme();
  const w = theme.mode === "dark" ? ASSETS.wordmarkWhite : ASSETS.wordmark;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 }}>
      <BrandMark height={height} />
      <View style={{ flexShrink: 1 }}>
        <Image source={w.src} style={fit(w, 18)} resizeMode="contain" accessibilityElementsHidden importantForAccessibility="no" />
        <AppText variant="caption" muted numberOfLines={1}>
          {t("mobile.tagline")}
        </AppText>
      </View>
    </View>
  );
}

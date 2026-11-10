import { useT } from "@unimate/i18n/react";
import { Image, View } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { AppText } from "./ui";

/** Intrinsic sizes of the generated brand PNGs (assets/*.png, see docs/BRAND_IDENTITY.md). */
const ASSETS = {
  logo: { src: require("../../assets/logo-light.png") as number, w: 800, h: 665 },
  mark: { src: require("../../assets/mark.png") as number, w: 320, h: 380 },
  tile: { src: require("../../assets/mark-tile.png") as number, w: 320, h: 320 },
  wordmark: { src: require("../../assets/wordmark-white.png") as number, w: 640, h: 113 },
};

const fit = (a: { w: number; h: number }, height: number) => ({ width: Math.round((height * a.w) / a.h), height: Math.round(height) });

/** Brandmark only. Dark theme = mark on its gradient tile, light theme = plain mark. */
export function BrandMark({ height = 40 }: { height?: number }) {
  const t = useT();
  const { theme } = useTheme();
  const a = theme.mode === "dark" ? ASSETS.tile : ASSETS.mark;
  return <Image source={a.src} style={fit(a, height)} accessibilityRole="image" accessibilityLabel={t("brand.mark")} resizeMode="contain" />;
}

/** Stacked official logo for light surfaces (splash-like screens). */
export function BrandLogo({ height = 120 }: { height?: number }) {
  const t = useT();
  const { theme } = useTheme();
  if (theme.mode === "light") return <Image source={ASSETS.logo.src} style={fit(ASSETS.logo, height)} accessibilityRole="image" accessibilityLabel={t("brand.logo")} resizeMode="contain" />;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={t("brand.logo")} style={{ alignItems: "center", gap: 10 }}>
      <Image source={ASSETS.tile.src} style={fit(ASSETS.tile, height * 0.6)} resizeMode="contain" />
      <Image source={ASSETS.wordmark.src} style={fit(ASSETS.wordmark, height * 0.16)} resizeMode="contain" />
    </View>
  );
}

/** Header lockup as on the approved Home mockup: mark + wordmark + tagline. */
export function BrandHeader({ height = 44 }: { height?: number }) {
  const t = useT();
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 }}>
      <BrandMark height={height} />
      <View style={{ flexShrink: 1 }}>
        {/* Dark: the sanctioned mark + white wordmark row. Light has no official horizontal lockup: mark and tagline only. */}
        {theme.mode === "dark" ? <Image source={ASSETS.wordmark.src} style={fit(ASSETS.wordmark, 18)} resizeMode="contain" accessibilityElementsHidden importantForAccessibility="no" /> : null}
        <AppText variant="caption" muted numberOfLines={1}>
          {t("mobile.tagline")}
        </AppText>
      </View>
    </View>
  );
}

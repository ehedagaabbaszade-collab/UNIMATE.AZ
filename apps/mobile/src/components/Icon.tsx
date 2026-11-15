import { ICON_PATHS, ICON_SIZES, ICON_STROKE, type IconName, type IconSize, type ModuleName } from "@unimate/ui/icons";
import { useTheme } from "../theme/ThemeProvider";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

const px = (s: number | IconSize) => (typeof s === "number" ? s : ICON_SIZES[s]);

/** The one icon component: renders the shared path data (packages/ui/src/icons/paths.ts) with react-native-svg. */
export function Icon({ name, size = "md", color, strokeWidth = ICON_STROKE, label }: { name: IconName; size?: number | IconSize; color?: string; strokeWidth?: number; label?: string }) {
  const { theme } = useTheme();
  const stroke = color ?? theme.text;
  const data = ICON_PATHS[name];
  // An unknown name (e.g. an achievement icon string from the DB) must never crash a whole screen.
  if (!data) return null;
  const s = px(size);
  return (
    <View accessible={!!label} accessibilityRole={label ? "image" : undefined} accessibilityLabel={label} importantForAccessibility={label ? "yes" : "no-hide-descendants"}>
      <Svg width={s} height={s} viewBox={data.viewBox}>
        {data.paths.map((d, i) => (
          <Path key={i} d={d} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </Svg>
    </View>
  );
}

/** Monochrome glyph on a quiet rounded tile (premium dark system: no per-module colour). `module`/`colors` kept for API compatibility. */
export function ModuleIcon({ icon, size = 48, label }: { icon: IconName; module?: ModuleName; colors?: readonly [string, string]; size?: number; label?: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, alignItems: "center", justifyContent: "center", backgroundColor: theme.cardStrong, borderWidth: 1, borderColor: theme.cardBorder }}>
      <Icon name={icon} size={Math.round(size * 0.5)} color={theme.text} {...(label ? { label } : {})} />
    </View>
  );
}

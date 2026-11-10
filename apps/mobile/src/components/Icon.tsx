import { ICON_PATHS, ICON_SIZES, ICON_STROKE, MODULE_TILES, type IconName, type IconSize, type ModuleName } from "@unimate/ui/icons";
import { LinearGradient } from "expo-linear-gradient";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

const px = (s: number | IconSize) => (typeof s === "number" ? s : ICON_SIZES[s]);

/** The one icon component: renders the shared path data (packages/ui/src/icons/paths.ts) with react-native-svg. */
export function Icon({ name, size = "md", color = "#FFFFFF", strokeWidth = ICON_STROKE, label }: { name: IconName; size?: number | IconSize; color?: string; strokeWidth?: number; label?: string }) {
  const data = ICON_PATHS[name];
  const s = px(size);
  return (
    <View accessible={!!label} accessibilityRole={label ? "image" : undefined} accessibilityLabel={label} importantForAccessibility={label ? "yes" : "no-hide-descendants"}>
      <Svg width={s} height={s} viewBox={data.viewBox}>
        {data.paths.map((d, i) => (
          <Path key={i} d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </Svg>
    </View>
  );
}

/** White glyph on a rounded gradient tile (the brand board's module icons). */
export function ModuleIcon({ icon, module, colors, size = 48, label }: { icon: IconName; module?: ModuleName; colors?: readonly [string, string]; size?: number; label?: string }) {
  const [from, to] = colors ?? (module ? MODULE_TILES[module] : (["#4F46E5", "#7C3AED"] as const));
  return (
    <LinearGradient colors={[from, to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size, height: size, borderRadius: size * 0.28, alignItems: "center", justifyContent: "center" }}>
      <Icon name={icon} size={Math.round(size * 0.56)} {...(label ? { label } : {})} />
    </LinearGradient>
  );
}

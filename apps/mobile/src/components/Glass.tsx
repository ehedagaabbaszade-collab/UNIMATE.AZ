import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import { createContext } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { radii } from "../theme/tokens";

/** Extra bottom space screens must leave for the floating tab bar (0 outside the tabs). */
export const TabInsetContext = createContext(0);
export const FLOATING_TAB_HEIGHT = 64;

/** True only on iOS 26+ where the OS provides UIGlassEffect. Everywhere else GlassSurface is a simulated material. */
export const NATIVE_GLASS = Platform.OS === "ios" && (() => { try { return isLiquidGlassAvailable(); } catch { return false; } })();

/**
 * Liquid-glass surface. iOS: real backdrop blur + a specular top highlight + hairline border + soft depth shadow.
 * Android: blur is costly/inconsistent across devices, so it gets a tinted translucent fill with the same highlight
 * and an elevation shadow (platform-appropriate, still layered). Children render above the glass.
 */
export function GlassSurface({
  children,
  style,
  radius = radii.lg,
  intensity = 40,
  strong,
  blur = Platform.OS === "ios",
  ...rest
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  intensity?: number;
  strong?: boolean;
  blur?: boolean;
} & Omit<React.ComponentProps<typeof View>, "style" | "children">) {
  const { theme } = useTheme();
  const dark = theme.mode === "dark";
  const fill = strong ? theme.cardStrong : theme.card;
  if (NATIVE_GLASS) {
    // Genuine iOS 26 Liquid Glass: UIGlassEffect rendered by the OS (via expo-glass-effect).
    return (
      <GlassView {...rest} glassEffectStyle="regular" colorScheme={dark ? "dark" : "light"} style={[{ borderRadius: radius, overflow: "hidden" }, style]}>
        {children}
      </GlassView>
    );
  }
  return (
    <View
      {...rest}
      style={[
        {
          borderRadius: radius,
          overflow: "hidden",
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: theme.cardBorder,
          backgroundColor: blur ? "transparent" : fill,
          shadowColor: dark ? "#000" : "#10182B",
          shadowOpacity: dark ? 0.35 : 0.1,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          elevation: dark ? 4 : 2,
        },
        style,
      ]}
    >
      {blur ? <BlurView intensity={intensity} tint={dark ? "dark" : "light"} style={StyleSheet.absoluteFill} /> : null}
      {blur ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: fill }]} /> : null}
      <LinearGradient
        pointerEvents="none"
        colors={dark ? ["rgba(255,255,255,0.16)", "rgba(255,255,255,0)"] : ["rgba(255,255,255,0.9)", "rgba(255,255,255,0)"]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.6, y: 0.55 }}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

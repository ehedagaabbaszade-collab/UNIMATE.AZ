import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import { createContext } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeProvider";
import { radii } from "../theme/tokens";

/** Extra bottom space screens must leave for the floating tab bar (0 outside the tabs). */
export const TabInsetContext = createContext(0);
export const FLOATING_TAB_HEIGHT = 64;

/**
 * Space the native tab bar occupies at the screen bottom: iOS bar ~49 + 8 margin (floating on 26, docked before),
 * Android M3 bar 80, plus the bottom system inset. iPadOS 18+ puts the tab bar at the top, so only the inset.
 */
export function useTabBarClearance(): number {
  const { bottom } = useSafeAreaInsets();
  if (Platform.OS !== "ios") return bottom + 80; // edge-to-edge Android: the M3 bar sits above the navigation-bar inset
  return Platform.isPad && parseInt(String(Platform.Version), 10) >= 18 ? bottom + 8 : bottom + 49 + 8;
}

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
  // Translucent tint only: an opaque card colour over the blur read as a solid panel instead of glass.
  const fill = dark ? (strong ? "rgba(25,34,58,0.55)" : "rgba(17,24,43,0.38)") : strong ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.5)";
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
          shadowOpacity: dark ? 0.18 : 0.06,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 1,
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

/**
 * Props for every NativeTabs bar (student and teacher). iOS 26 draws Liquid Glass itself and ignores the background props.
 * iOS 16.4-25 and Android need them: the iOS bar otherwise turns transparent at the scroll edge (labels over content)
 * and follows the *system* light/dark; the Android M3 bar ignores the app theme. Narrow phones get smaller labels.
 */
export function useNativeTabsLook() {
  const { theme } = useTheme();
  const narrow = useWindowDimensions().width < 360;
  const dark = theme.mode === "dark";
  return {
    tintColor: theme.active,
    disableTransparentOnScrollEdge: true,
    blurEffect: dark ? ("systemChromeMaterialDark" as const) : ("systemChromeMaterialLight" as const),
    shadowColor: theme.cardBorder,
    ...(NATIVE_GLASS ? {} : { iconColor: { default: theme.textMuted, selected: theme.active } }),
    labelStyle: { default: { ...(NATIVE_GLASS ? {} : { color: theme.textMuted }), ...(narrow ? { fontSize: 10 } : {}) }, selected: NATIVE_GLASS ? {} : { color: theme.active } },
    ...(Platform.OS === "android" ? { backgroundColor: theme.bg, indicatorColor: theme.primarySoft, rippleColor: theme.primarySoft, labelVisibilityMode: "labeled" as const } : {}),
  };
}

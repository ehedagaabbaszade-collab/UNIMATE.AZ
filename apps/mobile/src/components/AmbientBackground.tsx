import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { useTheme } from "../theme/ThemeProvider";

// Midnight Indigo glows: [rgb light, rgb dark, light alpha, dark alpha, left %, top].
const LAYERS = [
  { rgb: ["67,56,202", "129,140,248"], a: [0.2, 0.4], x: -0.3, y: -60 }, // primary
  { rgb: ["139,92,246", "167,139,250"], a: [0.16, 0.34], x: 0.4, y: 200 }, // accent
  { rgb: ["99,102,241", "99,102,241"], a: [0.18, 0.3], x: -0.35, y: 520 }, // secondary
  { rgb: ["139,92,246", "167,139,250"], a: [0.12, 0.22], x: 0.45, y: 820 }, // accent
] as const;

type Layer = (typeof LAYERS)[number];
/** Relative ring diameters: denser toward the centre, fading to the edge. */
const RINGS = [1, 0.8, 0.62, 0.46, 0.32] as const;

function Glow({ layer, size, dark, width }: { layer: Layer; size: number; dark: boolean; width: number }) {
  // Soft radial falloff from stacked translucent circles: plain Views only. experimental_backgroundImage gradients
  // crashed the Expo Go build natively, so nothing experimental is used here.
  const alpha = layer.a[dark ? 1 : 0] / RINGS.length;
  return (
    <View style={{ position: "absolute", width: size, height: size, left: layer.x * width, top: layer.y, alignItems: "center", justifyContent: "center" }}>
      {RINGS.map((r) => (
        <View key={r} style={{ position: "absolute", width: size * r, height: size * r, borderRadius: (size * r) / 2, backgroundColor: `rgba(${layer.rgb[dark ? 1 : 0]},${alpha})` }} />
      ))}
    </View>
  );
}

/**
 * Soft brand-colour light behind content. Static on purpose: glows that moved with scroll made the full-screen blur
 * re-render every frame on every screen, which was the main source of scroll/tab jank.
 */
export function AmbientBackground() {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const size = Math.max(width, 360) * 1.3;
  const dark = theme.mode === "dark";
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* Smooth brand wash as the base, so the page reads as a gradient even before any glow. */}
      <LinearGradient
        colors={dark ? ["#090D1A", "#0E1226", "#090D1A"] : ["#F8F9FE", "#F1F2FD", "#F8F9FE"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {LAYERS.map((l) => (
        <Glow key={l.y} layer={l} size={size} dark={dark} width={width} />
      ))}
      {/* A static blur over the rings melts them into soft light (intensity is never animated). */}
      <BlurView intensity={dark ? 90 : 80} tint={dark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
    </View>
  );
}

import { View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import { AppText } from "./ui";

/**
 * Circular progress (the Home "overall progress" ring). `fraction` is 0..1 and comes from real data (level progress);
 * the caller supplies the centre text so the number is formatted with the user's locale.
 */
export function ProgressRing({ fraction, size = 96, stroke = 10, track, from, to, label, labelColor, children }: { fraction: number; size?: number; stroke?: number; track: string; from: string; to: string; label: string; labelColor?: string; children?: string }) {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(f * 100) }} style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Defs>
          <LinearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="url(#ring)" strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${c * f} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </Svg>
      {children ? (
        <AppText variant="title" style={{ fontWeight: "800", ...(labelColor ? { color: labelColor } : null) }}>
          {children}
        </AppText>
      ) : null}
    </View>
  );
}

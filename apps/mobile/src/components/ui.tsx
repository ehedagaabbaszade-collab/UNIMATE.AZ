import { useT } from "@unimate/i18n/react";
import NetInfo from "@react-native-community/netinfo";
import { LinearGradient } from "expo-linear-gradient";
import { Stack } from "expo-router";
import { HeaderHeightContext } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import type { IconName } from "@unimate/ui/icons";
import { Children, cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  UIManager,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeProvider";
import { CONTENT_MAX, MIN_TOUCH, fontSizes, heroFontSize, radii, spacing } from "../theme/tokens";
import RA, { FadeInDown, Keyframe, ReduceMotion } from "react-native-reanimated";
import { AmbientBackground } from "./AmbientBackground";
import { CSS_EASE_OUT, CSS_EASE_IN_OUT, EASE_OUT, easings, haptic, useReducedMotion } from "../lib/motion";
import { TabInsetContext } from "./Glass";
import { Icon } from "./Icon";

const RAPressable = RA.createAnimatedComponent(Pressable);
/** Press feedback as a Reanimated CSS transition: scale on press-in, 120ms strong ease-out, UI thread. */
const pressStyle = (pressed: boolean, to: number, reduced: boolean) => ({ transform: [{ scale: pressed && !reduced ? to : 1 }], transitionProperty: "transform", transitionDuration: 120, transitionTimingFunction: CSS_EASE_OUT }) as const;

// ------------------------------------------------------------------ text
type Variant = "display" | "title" | "heading" | "body" | "caption" | "label";
const VARIANTS: Record<Variant, TextStyle> = {
  display: { fontSize: 34, fontWeight: "300", letterSpacing: -1 }, // big light numerals/names, same voice as HeroTitle
  title: { fontSize: fontSizes.xl, fontWeight: "700", letterSpacing: -0.3 },
  heading: { fontSize: fontSizes.lg, fontWeight: "600", letterSpacing: -0.2 },
  body: { fontSize: fontSizes.base, fontWeight: "400", lineHeight: 22 },
  caption: { fontSize: fontSizes.sm, fontWeight: "400" },
  label: { fontSize: fontSizes.sm, fontWeight: "600" },
};

/** All text goes through here: theme colours, and it scales with the system font size (allowFontScaling, capped). */
export function AppText({ variant = "body", muted, style, ...rest }: TextProps & { variant?: Variant; muted?: boolean }) {
  const { theme } = useTheme();
  return <Text maxFontSizeMultiplier={1.6} {...rest} style={[{ color: muted ? theme.textMuted : theme.text }, VARIANTS[variant], style]} />;
}

// ------------------------------------------------------------------ screen
/** Gradient background + safe areas + optional scrolling. `tabBar` adds bottom space for the floating tab bar. */
export function Screen({ children, scroll = true, padded = true, style, ambient = true }: { children: ReactNode; scroll?: boolean; padded?: boolean; style?: StyleProp<ViewStyle>; /** Brand-colour glow behind content (default on; pass false to opt out). */ ambient?: boolean }) {
  const { theme } = useTheme();
  // Under a (transparent) native header: its height already includes the status-bar inset, so the SafeArea "top" edge must not be applied again.
  const headerH = useContext(HeaderHeightContext) ?? 0;
  const hasHeader = headerH > 0;
  const inset = useContext(TabInsetContext);
  // Centred and capped on wide screens (tablets): phone layouts stretched to 1000pt read as broken.
  const pad = padded ? spacing.lg : 0;
  const body = { padding: pad, gap: spacing.lg, paddingTop: pad + headerH, paddingBottom: pad + inset, width: "100%", maxWidth: CONTENT_MAX + pad * 2, alignSelf: "center" } as const;
  const adjust = hasHeader ? "never" : "automatic"; // header offset is applied manually above; "automatic" would add it twice
  return (
    <LinearGradient colors={theme.bgGradient} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1 }}>
      <StatusBar style={theme.mode === "dark" ? "light" : "dark"} />
      {ambient ? <AmbientBackground /> : null}
      <SafeAreaView style={{ flex: 1 }} edges={hasHeader ? ["left", "right"] : ["top", "left", "right"]}>
        <OfflineBanner />
        {/* The focused field must never sit under the keyboard. iOS: the ScrollView insets itself and scrolls the focused
            input into view. Android (edge-to-edge, the window does not resize): the content area shrinks by the keyboard
            height and the ScrollView keeps the focused input visible. */}
        <KeyboardAvoidingView behavior={Platform.OS === "android" ? "padding" : undefined} enabled={Platform.OS === "android"} style={{ flex: 1 }}>
          {scroll ? (
            <ScrollView contentContainerStyle={[body, style]} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets contentInsetAdjustmentBehavior={adjust}>
              {children}
            </ScrollView>
          ) : (
            <View style={[{ flex: 1 }, body, style]}>{children}</View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

// ------------------------------------------------------------------ card (glass)
export function Card({ children, style, strong, ...rest }: { children: ReactNode; style?: StyleProp<ViewStyle>; strong?: boolean } & Omit<React.ComponentProps<typeof View>, "style">) {
  const { theme } = useTheme();
  return (
    // Solid grouped surface (Apple HIG: glass is for chrome, content sits on opaque cells).
    <View
      {...rest}
      style={[
        {
          padding: spacing.lg,
          gap: spacing.sm,
          borderRadius: radii.lg,
          borderCurve: "continuous",
          backgroundColor: strong ? theme.cardStrong : theme.card,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.cardBorder,
          boxShadow: theme.mode === "light" ? "0 1px 2px rgba(16,24,43,0.05), 0 4px 16px rgba(16,24,43,0.04)" : undefined,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ------------------------------------------------------------------ grouped list (iOS inset grouped)
/** One rounded surface with hairline-separated rows; the section title sits outside it, like iOS Settings. */
export function ListGroup({ title, footer, children, style }: { title?: string; footer?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={[{ gap: spacing.sm }, style]}>
      {title ? (
        <AppText variant="label" muted accessibilityRole="header" style={{ paddingHorizontal: spacing.lg, fontWeight: "500" }}>
          {title}
        </AppText>
      ) : null}
      <View style={{ backgroundColor: theme.card, borderRadius: radii.md + 2, borderCurve: "continuous", overflow: "hidden" }}>
        {rows.map((row, i) => (
          <View key={i}>
            {i > 0 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginLeft: spacing.lg + 30 + spacing.md }} /> : null}
            {row}
          </View>
        ))}
      </View>
      {footer ? (
        <AppText variant="caption" muted style={{ paddingHorizontal: spacing.lg }}>
          {footer}
        </AppText>
      ) : null}
    </View>
  );
}

/** A row inside ListGroup: tinted icon, title, optional subtitle and trailing text, chevron when it navigates. */
export function ListRow({ icon, iconColor, titleColor, title, subtitle, subtitleColor, trailing, onPress, onLongPress, longPressLabel, accessibilityLabel }: { icon?: IconName; iconColor?: string; titleColor?: string; title: string; subtitle?: string; subtitleColor?: string; trailing?: ReactNode; onPress?: () => void; /** iOS-style secondary action (e.g. delete); also exposed to VoiceOver as a named action. */ onLongPress?: () => void; longPressLabel?: string; accessibilityLabel?: string }) {
  const { theme } = useTheme();
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 52, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.lg }}>
      {icon ? (
        <View style={{ width: 30, height: 30, borderRadius: 8, borderCurve: "continuous", backgroundColor: theme.primarySoft, alignItems: "center", justifyContent: "center" }}>
          <Icon name={icon} size={18} color={iconColor ?? theme.active} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <AppText numberOfLines={2} style={{ fontWeight: "500", ...(titleColor ? { color: titleColor } : null) }}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" numberOfLines={2} style={{ color: subtitleColor ?? theme.textMuted }}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {typeof trailing === "string" ? (
        <AppText variant="caption" muted style={{ fontVariant: ["tabular-nums"] }}>
          {trailing}
        </AppText>
      ) : (
        trailing ?? null
      )}
      {onPress ? (
        <AppText muted importantForAccessibility="no" style={{ fontSize: 22, lineHeight: 24, opacity: 0.6 }}>
          ›
        </AppText>
      ) : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      {...(onLongPress ? { onLongPress, accessibilityActions: [{ name: "longpress", label: longPressLabel ?? title }], onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => e.nativeEvent.actionName === "longpress" && onLongPress() } : {})}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}. ${subtitle}` : title)}
      style={({ pressed }) => ({ backgroundColor: pressed ? theme.cardStrong : "transparent" })}
    >
      {body}
    </Pressable>
  );
}

// ------------------------------------------------------------------ button
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export function Button({
  title,
  onPress,
  variant = "primary",
  loading,
  disabled,
  small,
  icon,
  accessibilityLabel,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  icon?: ReactNode;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const inactive = disabled || loading;
  const light = theme.mode === "light";
  // Every variant reads as a button: filled, tinted, outlined or danger-outlined. Never bare text.
  const look: Record<ButtonVariant, { bg: string; fg: string; border: string | null }> = {
    primary: { bg: theme.primary, fg: theme.onPrimary, border: null },
    secondary: { bg: theme.primarySoft, fg: light ? theme.primary : theme.text, border: null },
    ghost: { bg: "transparent", fg: theme.text, border: theme.textMuted },
    danger: { bg: theme.dangerSoft, fg: theme.danger, border: theme.danger },
  };
  const { bg, fg, border } = look[variant];
  // Static style on a plain Pressable, scale on the wrapper: function styles on an Animated Pressable can be dropped.
  return (
    <RA.View style={[pressStyle(pressed, 0.97, reduced), style]}>
      <Pressable
        onPress={inactive ? undefined : () => { haptic.tap(); onPress?.(); }}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        accessibilityState={{ disabled: !!inactive, busy: !!loading }}
        style={{
          minHeight: small ? 40 : MIN_TOUCH + 4,
          paddingHorizontal: small ? spacing.md + 2 : spacing.lg,
          borderRadius: radii.pill,
          backgroundColor: bg,
          borderWidth: border ? 1 : 0,
          borderColor: border ?? "transparent",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: spacing.sm,
          opacity: inactive ? 0.55 : pressed ? 0.85 : 1,
          borderCurve: "continuous",
          ...(variant === "primary" && !inactive ? { boxShadow: `0 4px 12px ${light ? "rgba(67,56,202,0.28)" : "rgba(129,140,248,0.35)"}` } : null),
        }}
      >
        {loading ? <ActivityIndicator color={fg} /> : isValidElement(icon) ? cloneElement(icon as ReactElement<{ color?: string }>, { color: fg }) : icon}
        <Text maxFontSizeMultiplier={1.5} style={{ color: fg, fontSize: small ? fontSizes.sm : fontSizes.base, fontWeight: "700", flexShrink: 1, textAlign: "center" }}>
          {title}
        </Text>
      </Pressable>
    </RA.View>
  );
}

/** Pressable with a spring scale + light haptic: for tiles, cards and rows. Drop-in for Pressable (no render-function style). */
export function PressableScale({ children, style, onPress, scaleTo = 0.97, ...rest }: Omit<React.ComponentProps<typeof Pressable>, "style" | "children"> & { children: ReactNode; style?: StyleProp<ViewStyle>; scaleTo?: number }) {
  const reduced = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  return (
    <RAPressable
      {...rest}
      onPress={onPress ? (e) => { haptic.tap(); onPress(e); } : undefined}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[style, pressStyle(pressed, scaleTo, reduced)]}
    >
      {children}
    </RAPressable>
  );
}

/** Fades and rises its children in on mount; `index` staggers siblings (capped so long lists stay snappy). */
export function Reveal({ children, index = 0, style }: { children: ReactNode; index?: number; style?: StyleProp<ViewStyle> }) {
  const entering = FadeInDown.duration(220).delay(Math.min(index, 4) * 35).easing(EASE_OUT).withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] }).reduceMotion(ReduceMotion.System);
  return (
    <RA.View entering={entering} style={style}>
      {children}
    </RA.View>
  );
}

// ------------------------------------------------------------------ editorial pieces
/** Oversized light two-line headline: muted first line, ink second line, optional small raised count. */
export function HeroTitle({ muted, strong, count }: { muted: string; strong: string; count?: number }) {
  const { theme } = useTheme();
  const size = heroFontSize(useWindowDimensions().width);
  const base: TextStyle = { fontSize: size, lineHeight: Math.round(size * 1.1), fontWeight: "300", letterSpacing: -1 };
  return (
    <View accessibilityRole="header" accessible accessibilityLabel={`${muted} ${strong}${count != null ? ` ${count}` : ""}`}>
      <Text importantForAccessibility="no" maxFontSizeMultiplier={1.2} style={[base, { color: theme.textMuted }]}>
        {muted}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <Text importantForAccessibility="no" maxFontSizeMultiplier={1.2} style={[base, { color: theme.text, flexShrink: 1 }]}>
          {strong}
        </Text>
        {count != null ? (
          <Text importantForAccessibility="no" maxFontSizeMultiplier={1.2} style={{ color: theme.textMuted, fontSize: 16, fontWeight: "400", marginTop: 4, marginLeft: 4, textAlignVertical: "top", fontVariant: ["tabular-nums"] }}>
            {`(${count})`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Fully round label: accent (indigo), ink (near-black) or plain (card) tone; a button when onPress is given. */
export function Pill({ label, tone = "plain", onPress, icon }: { label: string; tone?: "accent" | "ink" | "plain"; onPress?: () => void; icon?: ReactNode }) {
  const { theme } = useTheme();
  const bg = tone === "accent" ? theme.primary : tone === "ink" ? theme.ink : theme.card;
  const fg = tone === "plain" ? theme.text : tone === "accent" ? theme.onPrimary : "#FFFFFF";
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingHorizontal: spacing.md + 2, borderRadius: radii.pill, backgroundColor: bg, alignSelf: "flex-start", borderWidth: tone === "plain" ? StyleSheet.hairlineWidth : 0, borderColor: theme.cardBorder }}>
      {icon}
      <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={{ color: fg, fontSize: fontSizes.sm, fontWeight: "600", flexShrink: 1 }}>
        {label}
      </Text>
    </View>
  );
  if (!onPress) return body;
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{ alignSelf: "flex-start" }}>
      {body}
    </PressableScale>
  );
}

/**
 * One-line, horizontally scrolling row of pills: section switcher (role "tablist") or a single filter (role "radiogroup").
 * Never wraps, so long translations (ru/tr) cannot push the content down into a second row of buttons.
 */
export function PillRow<T extends string>({ label, value, onChange, options, role = "tablist" }: { label: string; value: T; onChange: (v: T) => void; options: ReadonlyArray<{ value: T; label: string }>; role?: "tablist" | "radiogroup" }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole={role} accessibilityLabel={label} style={{ marginHorizontal: -spacing.lg, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
      {options.map((o) => (
        <Pill key={o.value} label={o.label} tone={o.value === value ? "accent" : "plain"} onPress={() => onChange(o.value)} />
      ))}
    </ScrollView>
  );
}

/** 56px round action (ink, accent or plain) with a required accessibility label. */
export function RoundAction({ icon, label, onPress, tone = "ink", disabled }: { icon: ReactNode; label: string; onPress: () => void; tone?: "ink" | "accent" | "plain"; disabled?: boolean }) {
  const { theme } = useTheme();
  const bg = tone === "accent" ? theme.primary : tone === "ink" ? theme.ink : theme.card;
  return (
    <PressableScale onPress={disabled ? undefined : onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: bg, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.4 : 1 }}>
      {isValidElement(icon) ? cloneElement(icon as ReactElement<{ color?: string }>, { color: tone === "plain" ? theme.text : tone === "accent" ? theme.onPrimary : "#FFFFFF" }) : icon}
    </PressableScale>
  );
}

// ------------------------------------------------------------------ input
export function Input({ label, error, hint, style, secure, ...rest }: TextInputProps & { label: string; error?: string | undefined; hint?: string | undefined; secure?: boolean }) {
  const { theme } = useTheme();
  const t = useT();
  const [shown, setShown] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="label">{label}</AppText>
      <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: theme.inputBg, borderColor: error ? theme.danger : theme.border, borderWidth: 1, borderRadius: radii.md, minHeight: MIN_TOUCH + 4 }}>
        <TextInput
          {...rest}
          secureTextEntry={secure ? !shown : rest.secureTextEntry}
          accessibilityLabel={label}
          placeholderTextColor={theme.textMuted}
          maxFontSizeMultiplier={1.6}
          style={[{ flex: 1, color: theme.text, fontSize: fontSizes.base, paddingHorizontal: spacing.md, paddingVertical: spacing.md }, style as StyleProp<TextStyle>]}
        />
        {secure ? (
          <Pressable onPress={() => setShown((s) => !s)} accessibilityRole="button" accessibilityLabel={shown ? t("mobile.auth.hidePassword") : t("mobile.auth.showPassword")} hitSlop={8} style={{ paddingHorizontal: spacing.md, minHeight: MIN_TOUCH, justifyContent: "center" }}>
            <AppText variant="caption" style={{ color: theme.active, fontWeight: "700" }}>
              {shown ? t("mobile.auth.hidePassword") : t("mobile.auth.showPassword")}
            </AppText>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <AppText variant="caption" style={{ color: theme.danger }} accessibilityRole="alert">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" muted>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

/** Rounded (28) search field on a card surface; the label is the accessibility label, not visible text. */
export function SearchField({ label, hint, style, ...rest }: TextInputProps & { label: string; hint?: string | undefined }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: theme.card, borderRadius: 28, borderCurve: "continuous", minHeight: 52, paddingHorizontal: spacing.lg }}>
        <Icon name="search" size="sm" color={theme.textMuted} />
        <TextInput {...rest} accessibilityLabel={label} placeholderTextColor={theme.textMuted} maxFontSizeMultiplier={1.6} style={[{ flex: 1, color: theme.text, fontSize: fontSizes.base, paddingVertical: spacing.md }, style as StyleProp<TextStyle>]} />
      </View>
      {hint ? (
        <AppText variant="caption" muted style={{ paddingHorizontal: spacing.lg }}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ badge / chips
import type { BadgeTone } from "./badge-tone";
export type { BadgeTone };
export function Badge({ children, tone = "neutral" }: { children: string; tone?: BadgeTone }) {
  const { theme } = useTheme();
  const map: Record<BadgeTone, [string, string]> = {
    neutral: [theme.cardStrong, theme.textMuted],
    primary: [theme.primarySoft, theme.active],
    success: [theme.successSoft, theme.success],
    warning: [theme.warningSoft, theme.warning],
    danger: [theme.dangerSoft, theme.danger],
    info: [theme.primarySoft, theme.info],
  };
  const [bg, fg] = map[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" }}>
      <Text maxFontSizeMultiplier={1.4} style={{ color: fg, fontSize: fontSizes.xs, fontWeight: "700" }}>
        {children}
      </Text>
    </View>
  );
}

/** iOS segmented control (up to 3 options): one track, a thumb that slides (transform only, 200ms ease-in-out). */
function IosSegmented<T extends string>({ options, value, onChange, label }: { options: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const seg = width / options.length;
  const dark = theme.mode === "dark";
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width - 4)}
      style={{ flexDirection: "row", padding: 2, borderRadius: 10, borderCurve: "continuous", backgroundColor: theme.cardStrong }}
    >
      {width > 0 ? (
        <RA.View
          pointerEvents="none"
          style={{ position: "absolute", top: 2, bottom: 2, left: 2, width: seg, borderRadius: 8, borderCurve: "continuous", backgroundColor: dark ? theme.border : theme.card, boxShadow: dark ? undefined : "0 1px 3px rgba(16,24,43,0.14)", transform: [{ translateX: idx * seg }], transitionProperty: "transform", transitionDuration: reduced ? 0 : 200, transitionTimingFunction: CSS_EASE_IN_OUT }}
        />
      ) : null}
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              if (!on) haptic.select();
              onChange(o.value);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            hitSlop={{ top: 4, bottom: 4 }}
            style={{ flex: 1, minHeight: 36, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm }}
          >
            <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={{ color: theme.text, fontWeight: on ? "600" : "500", fontSize: fontSizes.sm }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Choice control: iOS segmented control for 2-3 options, wrapping chips for longer lists (categories, letters). */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  const { theme } = useTheme();
  if (options.length <= 3) return <IosSegmented options={options} value={value} onChange={onChange} label={label} />;
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              if (!on) haptic.select();
              onChange(o.value);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{ minHeight: 40, paddingHorizontal: spacing.md, justifyContent: "center", borderRadius: radii.pill, backgroundColor: on ? theme.primary : theme.cardStrong, borderWidth: 1, borderColor: on ? theme.primary : theme.border }}
          >
            <Text maxFontSizeMultiplier={1.4} style={{ color: on ? theme.onPrimary : theme.text, fontWeight: "600", fontSize: fontSizes.sm }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------------ states
export function Skeleton({ height = 24, width, radius = radii.md }: { height?: number; width?: number | `${number}%`; radius?: number }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const [w, setW] = useState(0);
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced || w === 0) return;
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1300, easing: easings.inOut, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v, reduced, w]);
  const sweep = Math.max(80, w * 0.6);
  const dark = theme.mode === "dark";
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{ height, width: width ?? "100%", borderRadius: radius, backgroundColor: theme.cardStrong, overflow: "hidden" }}
    >
      {reduced || w === 0 ? null : (
        <Animated.View style={{ position: "absolute", top: 0, bottom: 0, width: sweep, transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-sweep, w] }) }] }}>
          <LinearGradient colors={dark ? ["rgba(255,255,255,0)", "rgba(255,255,255,0.14)", "rgba(255,255,255,0)"] : ["rgba(255,255,255,0)", "rgba(255,255,255,0.8)", "rgba(255,255,255,0)"]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ flex: 1 }} />
        </Animated.View>
      )}
    </View>
  );
}

/** Card-shaped loading placeholder: title line + body lines. */
export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <Card accessibilityLabel="" style={{ gap: spacing.sm }}>
      <Skeleton height={18} width="55%" radius={9} />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={12} width={i === lines - 1 ? "70%" : "100%"} radius={6} />
      ))}
    </Card>
  );
}

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) UIManager.setLayoutAnimationEnabledExperimental(true);

/**
 * Expandable card: header always visible, body animates open with LayoutAnimation (layout + opacity, no native module).
 * Reduced motion swaps instantly. Header is a button with expanded state for screen readers.
 */
export function ExpandCard({ header, children, defaultOpen = false, label }: { header: ReactNode; children: ReactNode; defaultOpen?: boolean; label: string }) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(defaultOpen);
  const fade = useRef(new Animated.Value(defaultOpen ? 1 : 0)).current;
  const toggle = () => {
    haptic.select();
    if (!reduced) LayoutAnimation.configureNext(LayoutAnimation.create(260, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
    const next = !open;
    setOpen(next);
    if (reduced) fade.setValue(next ? 1 : 0);
    else Animated.timing(fade, { toValue: next ? 1 : 0, duration: 240, useNativeDriver: true }).start();
  };
  return (
    <Card>
      <Pressable onPress={toggle} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} style={{ minHeight: MIN_TOUCH, flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={{ flex: 1 }}>{header}</View>
        <AppText variant="heading" style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
          {"›"}
        </AppText>
      </Pressable>
      {open ? <Animated.View style={{ opacity: fade, gap: spacing.sm }}>{children}</Animated.View> : null}
    </Card>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string | undefined; action?: ReactNode }) {
  return (
    <Card style={{ alignItems: "center", paddingVertical: spacing.xl }}>
      <AppText variant="heading" style={{ textAlign: "center" }} accessibilityRole="header">
        {title}
      </AppText>
      {description ? (
        <AppText muted style={{ textAlign: "center" }}>
          {description}
        </AppText>
      ) : null}
      {action}
    </Card>
  );
}

export function ErrorState({ title, description, action }: { title: string; description?: string | undefined; action?: ReactNode }) {
  const { theme } = useTheme();
  return (
    <Card accessibilityRole="alert" style={{ borderColor: theme.danger, alignItems: "center" }}>
      <AppText variant="heading" style={{ textAlign: "center", color: theme.danger }}>
        {title}
      </AppText>
      {description ? (
        <AppText muted style={{ textAlign: "center" }}>
          {description}
        </AppText>
      ) : null}
      {action}
    </Card>
  );
}

/** Inline notice (warning/error) used for edge-function failures. */
export function Notice({ text, tone = "danger" }: { text: string; tone?: "danger" | "warning" | "success" | "info" }) {
  const { theme } = useTheme();
  const c = { danger: [theme.dangerSoft, theme.danger], warning: [theme.warningSoft, theme.warning], success: [theme.successSoft, theme.success], info: [theme.primarySoft, theme.info] }[tone];
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: c[0], borderRadius: radii.md, padding: spacing.md }}>
      <AppText variant="caption" style={{ color: c[1], fontWeight: "600" }}>
        {text}
      </AppText>
    </View>
  );
}

/** Pushed screens: the native stack header (iOS large-title-free nav bar, system back + swipe-back). `onBack` kept for callers; the native back button handles it. */
export function ScreenHeader({ title }: { title: string; onBack?: () => void }) {
  const { theme } = useTheme();
  // Pinned to the tab bar: there is no stack header (and no back), so the title is drawn in the content instead.
  if (useContext(TabInsetContext) > 0)
    return (
      <Text accessibilityRole="header" maxFontSizeMultiplier={1.2} style={{ fontSize: 34, lineHeight: 40, fontWeight: "300", letterSpacing: -0.6, color: theme.text }}>
        {title}
      </Text>
    );
  return <Stack.Screen options={{ headerShown: true, title }} />;
}

// ------------------------------------------------------------------ offline banner
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => NetInfo.addEventListener((s) => setOnline(s.isConnected !== false && s.isInternetReachable !== false)), []);
  return online;
}

export function OfflineBanner() {
  const t = useT();
  const { theme } = useTheme();
  const online = useOnline();
  if (online) return null;
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ backgroundColor: theme.warningSoft, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
      <Icon name="offline" size="sm" color={theme.warning} />
      <AppText variant="caption" style={{ color: theme.warning, flex: 1, fontWeight: "600" }}>
        {t("mobile.offline.banner")}
      </AppText>
    </View>
  );
}

// ------------------------------------------------------------------ toast
type ToastKind = "success" | "error" | "info";
interface ToastCtx {
  toast: (message: string, kind?: ToastKind) => void;
}
const ToastContext = createContext<ToastCtx>({ toast: () => undefined });
export const useToast = (): ToastCtx => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [item, setItem] = useState<{ id: number; message: string; kind: ToastKind } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((message: string, kind: ToastKind = "info") => {
    if (timer.current) clearTimeout(timer.current);
    setItem({ id: Date.now(), message, kind });
    timer.current = setTimeout(() => setItem(null), 4000);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  const color = item?.kind === "error" ? theme.danger : item?.kind === "success" ? theme.success : theme.active;
  return (
    <ToastContext.Provider value={value}>
      {children}
      {item ? (
        <View pointerEvents="none" style={{ position: "absolute", left: spacing.lg, right: spacing.lg, bottom: insets.bottom + 90 }}>
          <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ backgroundColor: theme.surface, borderColor: color, borderWidth: 1, borderRadius: radii.md, padding: spacing.md, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 12, elevation: 6 }}>
            <AppText variant="caption" style={{ fontWeight: "600" }}>
              {item.message}
            </AppText>
          </View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

// ------------------------------------------------------------------ dialog
const DIALOG_IN = new Keyframe({ 0: { opacity: 0, transform: [{ scale: 0.95 }] }, 100: { opacity: 1, transform: [{ scale: 1 }], easing: EASE_OUT } }).duration(200).reduceMotion(ReduceMotion.System);
/** Alert-style entrance: 0.95 -> 1 scale + fade, 200ms ease-out (occasional UI; opacity only with reduced motion). */
function DialogCard({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <RA.View entering={DIALOG_IN} accessibilityViewIsModal style={{ backgroundColor: theme.surface, borderRadius: radii.xl, borderCurve: "continuous", padding: spacing.xl, gap: spacing.md }}>
      {children}
    </RA.View>
  );
}
export function Dialog({ open, title, children, onClose, actions }: { open: boolean; title: string; children: ReactNode; onClose: () => void; actions: ReactNode }) {
  const { theme } = useTheme();
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} accessibilityViewIsModal>
      {/* Dialogs with an input rise above the keyboard instead of being covered by it. */}
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: "center", padding: spacing.xl }}>
        <DialogCard>
          <AppText variant="heading" accessibilityRole="header">
            {title}
          </AppText>
          {children}
          <View style={{ gap: spacing.sm }}>{actions}</View>
        </DialogCard>
      </KeyboardAvoidingView>
    </Modal>
  );
}

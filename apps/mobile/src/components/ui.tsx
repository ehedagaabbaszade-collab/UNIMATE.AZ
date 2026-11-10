import { useT } from "@unimate/i18n/react";
import NetInfo from "@react-native-community/netinfo";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  LayoutAnimation,
  Modal,
  Platform,
  UIManager,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeProvider";
import { MIN_TOUCH, fontSizes, radii, spacing } from "../theme/tokens";
import { easings, haptic, useEnter, usePressScale, useReducedMotion } from "../lib/motion";
import { GlassSurface, TabInsetContext } from "./Glass";
import { Icon } from "./Icon";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ------------------------------------------------------------------ text
type Variant = "display" | "title" | "heading" | "body" | "caption" | "label";
const VARIANTS: Record<Variant, TextStyle> = {
  display: { fontSize: fontSizes.xxl, fontWeight: "700", letterSpacing: -0.6 },
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
export function Screen({ children, scroll = true, padded = true, style }: { children: ReactNode; scroll?: boolean; padded?: boolean; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  const inset = useContext(TabInsetContext);
  const enter = useEnter(0, 10);
  const body = { padding: padded ? spacing.lg : 0, gap: spacing.lg, paddingBottom: (padded ? spacing.lg : 0) + inset } as const;
  return (
    <LinearGradient colors={theme.bgGradient} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1 }}>
      <StatusBar style={theme.mode === "dark" ? "light" : "dark"} />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <OfflineBanner />
        <Animated.View style={[{ flex: 1 }, enter]}>
          {scroll ? (
            <ScrollView contentContainerStyle={[body, style]} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
              {children}
            </ScrollView>
          ) : (
            <View style={[{ flex: 1 }, body, style]}>{children}</View>
          )}
        </Animated.View>
      </SafeAreaView>
    </LinearGradient>
  );
}

// ------------------------------------------------------------------ card (glass)
export function Card({ children, style, strong, ...rest }: { children: ReactNode; style?: StyleProp<ViewStyle>; strong?: boolean } & Omit<React.ComponentProps<typeof View>, "style">) {
  return (
    <GlassSurface {...rest} strong={!!strong} style={[{ padding: spacing.lg, gap: spacing.sm }, style]}>
      {children}
    </GlassSurface>
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
  const press = usePressScale(0.96);
  const inactive = disabled || loading;
  const bg = variant === "primary" ? theme.primary : variant === "danger" ? theme.dangerSoft : variant === "secondary" ? theme.cardStrong : "transparent";
  const fg = variant === "primary" ? theme.onPrimary : variant === "danger" ? theme.danger : theme.text;
  return (
    <AnimatedPressable
      onPress={inactive ? undefined : () => { haptic.tap(); onPress?.(); }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={({ pressed }) => [
        {
          transform: [{ scale: press.scale }],
          minHeight: small ? 36 : MIN_TOUCH + 4,
          paddingHorizontal: small ? spacing.md : spacing.lg,
          borderRadius: radii.pill,
          backgroundColor: bg,
          borderWidth: variant === "secondary" || variant === "danger" ? 1 : 0,
          borderColor: variant === "danger" ? theme.danger : theme.border,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: spacing.sm,
          opacity: inactive ? 0.55 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : isValidElement(icon) ? cloneElement(icon as ReactElement<{ color?: string }>, { color: fg }) : icon}
      <Text maxFontSizeMultiplier={1.5} style={{ color: fg, fontSize: small ? fontSizes.sm : fontSizes.base, fontWeight: "700", flexShrink: 1, textAlign: "center" }}>
        {title}
      </Text>
    </AnimatedPressable>
  );
}

/** Pressable with a spring scale + light haptic: for tiles, cards and rows. Drop-in for Pressable (no render-function style). */
export function PressableScale({ children, style, onPress, scaleTo = 0.97, ...rest }: Omit<React.ComponentProps<typeof Pressable>, "style" | "children"> & { children: ReactNode; style?: StyleProp<ViewStyle>; scaleTo?: number }) {
  const press = usePressScale(scaleTo);
  return (
    <AnimatedPressable
      {...rest}
      onPress={onPress ? (e) => { haptic.tap(); onPress(e); } : undefined}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[style, { transform: [{ scale: press.scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}

/** Fades and rises its children in on mount; `index` staggers siblings (capped so long lists stay snappy). */
export function Reveal({ children, index = 0, style }: { children: ReactNode; index?: number; style?: StyleProp<ViewStyle> }) {
  const enter = useEnter(Math.min(index, 8) * 60, 16);
  return <Animated.View style={[style, enter]}>{children}</Animated.View>;
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

export function Segmented<T extends string>({ options, value, onChange, label }: { options: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  const { theme } = useTheme();
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

/** Back + title row for pushed (non-tab) screens. */
export function ScreenHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  const t = useT();
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
      {onBack ? (
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={t("common.back")} hitSlop={8} style={{ width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: MIN_TOUCH / 2, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, alignItems: "center", justifyContent: "center" }}>
          <AppText variant="title" style={{ lineHeight: 28 }}>
            {"‹"}
          </AppText>
        </Pressable>
      ) : null}
      <AppText variant="title" accessibilityRole="header" style={{ flex: 1 }}>
        {title}
      </AppText>
    </View>
  );
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
export function Dialog({ open, title, children, onClose, actions }: { open: boolean; title: string; children: ReactNode; onClose: () => void; actions: ReactNode }) {
  const { theme } = useTheme();
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} accessibilityViewIsModal>
      <View style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: "center", padding: spacing.xl }}>
        <View accessibilityViewIsModal style={{ backgroundColor: theme.surface, borderRadius: radii.xl, padding: spacing.xl, gap: spacing.md, borderWidth: 1, borderColor: theme.border }}>
          <AppText variant="heading" accessibilityRole="header">
            {title}
          </AppText>
          {children}
          <View style={{ gap: spacing.sm }}>{actions}</View>
        </View>
      </View>
    </Modal>
  );
}

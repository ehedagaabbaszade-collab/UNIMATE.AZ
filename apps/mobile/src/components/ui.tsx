import { useT } from "@unimate/i18n/react";
import NetInfo from "@react-native-community/netinfo";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
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
import { Icon } from "./Icon";

// ------------------------------------------------------------------ text
type Variant = "display" | "title" | "heading" | "body" | "caption" | "label";
const VARIANTS: Record<Variant, TextStyle> = {
  display: { fontSize: fontSizes.xxl, fontWeight: "800" },
  title: { fontSize: fontSizes.xl, fontWeight: "700" },
  heading: { fontSize: fontSizes.lg, fontWeight: "700" },
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
  const body = { padding: padded ? spacing.lg : 0, gap: spacing.lg } as const;
  return (
    <LinearGradient colors={theme.bgGradient} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1 }}>
      <StatusBar style={theme.mode === "dark" ? "light" : "dark"} />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <OfflineBanner />
        {scroll ? (
          <ScrollView contentContainerStyle={[body, style]} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
            {children}
          </ScrollView>
        ) : (
          <View style={[{ flex: 1 }, body, style]}>{children}</View>
        )}
      </SafeAreaView>
    </LinearGradient>
  );
}

// ------------------------------------------------------------------ card (glass)
export function Card({ children, style, strong, ...rest }: { children: ReactNode; style?: StyleProp<ViewStyle>; strong?: boolean } & Omit<React.ComponentProps<typeof View>, "style">) {
  const { theme } = useTheme();
  return (
    <View
      {...rest}
      style={[
        { backgroundColor: strong ? theme.cardStrong : theme.card, borderColor: theme.cardBorder, borderWidth: 1, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
        theme.mode === "light" ? { shadowColor: "#10182B", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 1 } : null,
        style,
      ]}
    >
      {children}
    </View>
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
  const inactive = disabled || loading;
  const bg = variant === "primary" ? theme.primary : variant === "danger" ? theme.dangerSoft : variant === "secondary" ? theme.cardStrong : "transparent";
  const fg = variant === "primary" ? theme.onPrimary : variant === "danger" ? theme.danger : theme.text;
  return (
    <Pressable
      onPress={inactive ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={({ pressed }) => [
        {
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
      {loading ? <ActivityIndicator color={fg} /> : icon}
      <Text maxFontSizeMultiplier={1.5} style={{ color: fg, fontSize: small ? fontSizes.sm : fontSizes.base, fontWeight: "700", flexShrink: 1, textAlign: "center" }}>
        {title}
      </Text>
    </Pressable>
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
            onPress={() => onChange(o.value)}
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
  const v = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([Animated.timing(v, { toValue: 0.9, duration: 700, useNativeDriver: true }), Animated.timing(v, { toValue: 0.4, duration: 700, useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ height, width: width ?? "100%", borderRadius: radius, backgroundColor: theme.cardStrong, opacity: v }} />;
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

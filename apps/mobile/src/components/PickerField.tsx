import { useT } from "@unimate/i18n/react";
import { PressableScale } from "./ui";
import { useMemo, useState } from "react";
import { Modal, SectionList, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeProvider";
import { MIN_TOUCH, fontSizes, radii, spacing } from "../theme/tokens";
import { AppText, Button } from "./ui";

export interface PickerOption {
  id: string;
  label: string;
  /** Extra text matched by the search box (short name, city...). */
  searchText?: string;
}
export interface PickerSection {
  title?: string;
  data: PickerOption[];
}

const fold = (s: string) => s.toLocaleLowerCase("az").normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i");

/** Select-like field that opens a full-screen list with an optional search box (the institution list has ~100 entries). */
export function PickerField({
  label,
  sections,
  value,
  onChange,
  searchable,
  disabled,
  hint,
  error,
  loading,
}: {
  label: string;
  sections: PickerSection[];
  value: string;
  onChange: (id: string) => void;
  searchable?: boolean;
  disabled?: boolean;
  hint?: string | undefined;
  error?: string | undefined;
  loading?: boolean;
}) {
  const t = useT();
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = sections.flatMap((s) => s.data).find((o) => o.id === value);

  const filtered = useMemo(() => {
    const needle = fold(q.trim());
    if (!needle) return sections.filter((s) => s.data.length > 0);
    return sections.map((s) => ({ ...s, data: s.data.filter((o) => fold(`${o.label} ${o.searchText ?? ""}`).includes(needle)) })).filter((s) => s.data.length > 0);
  }, [sections, q]);

  return (
    <View style={{ gap: 6 }}>
      <AppText variant="label">{label}</AppText>
      <PressableScale
        onPress={() => setOpen(true)}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? t("common.select")}`}
        accessibilityState={{ disabled: !!(disabled || loading) }}
        style={{ minHeight: MIN_TOUCH + 4, borderRadius: radii.md, borderWidth: 1, borderColor: error ? theme.danger : theme.border, backgroundColor: theme.inputBg, paddingHorizontal: spacing.md, justifyContent: "center", opacity: disabled ? 0.55 : 1 }}
      >
        <AppText numberOfLines={2} muted={!selected}>
          {loading ? t("common.loading") : (selected?.label ?? t("common.select"))}
        </AppText>
      </PressableScale>
      {error ? (
        <AppText variant="caption" style={{ color: theme.danger }}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" muted>
          {hint}
        </AppText>
      ) : null}

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            <AppText variant="title" accessibilityRole="header">
              {label}
            </AppText>
            {searchable ? (
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder={t("mobile.search.placeholder")}
                accessibilityLabel={t("mobile.search.placeholder")}
                placeholderTextColor={theme.textMuted}
                autoCorrect={false}
                autoCapitalize="none"
                maxFontSizeMultiplier={1.6}
                style={{ minHeight: MIN_TOUCH + 4, borderRadius: radii.md, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.inputBg, color: theme.text, fontSize: fontSizes.base, paddingHorizontal: spacing.md }}
              />
            ) : null}
          </View>
          <SectionList
            sections={filtered}
            keyExtractor={(o) => o.id}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
            ListEmptyComponent={
              <AppText muted style={{ paddingVertical: spacing.lg }}>
                {t("mobile.search.none")}
              </AppText>
            }
            renderSectionHeader={({ section }) =>
              section.title ? (
                <AppText variant="label" muted style={{ backgroundColor: theme.bg, paddingVertical: spacing.sm }} accessibilityRole="header">
                  {section.title}
                </AppText>
              ) : null
            }
            renderItem={({ item }) => (
              <PressableScale
                onPress={() => {
                  onChange(item.id);
                  setOpen(false);
                  setQ("");
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: item.id === value }}
                style={{ minHeight: MIN_TOUCH + 4, justifyContent: "center", paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.border }}
              >
                <AppText style={{ color: item.id === value ? theme.active : theme.text, fontWeight: item.id === value ? "700" : "400" }}>{item.label}</AppText>
              </PressableScale>
            )}
          />
          <View style={{ padding: spacing.lg }}>
            <Button
              title={t("common.close")}
              variant="secondary"
              onPress={() => {
                setOpen(false);
                setQ("");
              }}
            />
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

import { CV_COLUMNS, CV_FONTS, CV_FONT_SIZES, CV_HEADING_SCALE, CV_MARGINS, CV_MODES, CV_PHOTO_SHAPES, CV_SPACINGS, resolveCvDesign, type CvDesign } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useState } from "react";
import { Modal, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card, Input, PressableScale, Segmented } from "../../components/ui";
import { useTheme } from "../../theme/ThemeProvider";
import { isHex, moveItem, toggleIn } from "./cv-helpers";

const PRESETS = ["#111827", "#1F3A5F", "#2563EB", "#0EA5A4", "#16A34A", "#F59E0B", "#DC2626", "#7C3AED"];

function ColourField({ label, value, onPick }: { label: string; value: string; onPick: (hex: string) => void }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const [text, setText] = useState(value);
  const bad = text.trim() !== "" && !isHex(text);
  return (
    <View style={{ gap: 6 }}>
      <Input
        label={label}
        value={text}
        onChangeText={(v) => {
          setText(v);
          if (isHex(v)) onPick(v.trim());
        }}
        autoCapitalize="characters"
        maxLength={7}
        error={bad ? t("career.cv.design.invalidColour") : undefined}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} accessibilityLabel={t("cvMobile.brandColours")}>
        {PRESETS.map((c) => (
          <PressableScale
            key={c}
            accessibilityRole="button"
            accessibilityLabel={c}
            onPress={() => {
              setText(c);
              onPick(c);
            }}
            style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          >
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c, borderWidth: c.toLowerCase() === value.toLowerCase() ? 3 : 1, borderColor: c.toLowerCase() === value.toLowerCase() ? theme.active : theme.border }} />
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

/** Design sheet: font, size, heading scale, colours, spacing, margins, columns, photo, mode, section order and visibility. Stores only chosen keys. */
export function CvCustomise({ open, template, design, onChange, onClose }: { open: boolean; template: string; design: CvDesign; onChange: (next: CvDesign) => void; onClose: () => void }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [resetKey, setResetKey] = useState(0);
  const d = resolveCvDesign(template, design);
  const set = (patch: CvDesign) => onChange({ ...design, ...patch });
  const opts = <T extends string>(list: readonly T[], label: (v: T) => string) => list.map((v) => ({ value: v, label: label(v) }));
  const scale = (delta: number) => set({ headingScale: Math.min(CV_HEADING_SCALE.max, Math.max(CV_HEADING_SCALE.min, Math.round((d.headingScale + delta) * 10) / 10)) });
  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose} accessibilityViewIsModal>
      <View style={{ flex: 1, backgroundColor: theme.surface, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12, paddingHorizontal: 16, gap: 12 }}>
        <AppText variant="heading">{t("cvMobile.customise")}</AppText>
        <View style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
            <Card>
              <Segmented label={t("career.cv.design.mode")} value={d.mode} onChange={(v) => set({ mode: v })} options={opts(CV_MODES, (v) => t(`career.cv.design.modes.${v}`))} />
              <AppText variant="caption" muted>
                {t("career.cv.design.atsHint")}
              </AppText>
              <Segmented label={t("career.cv.design.font")} value={d.font} onChange={(v) => set({ font: v })} options={opts(CV_FONTS, (v) => t(`career.cv.design.fonts.${v}`))} />
              <Segmented label={t("career.cv.design.fontSize")} value={d.fontSize} onChange={(v) => set({ fontSize: v })} options={opts(CV_FONT_SIZES, (v) => t(`career.cv.design.fontSizes.${v}`))} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <AppText style={{ flex: 1 }}>{`${t("career.cv.design.headingScale")}: ${d.headingScale.toFixed(1)}`}</AppText>
                <Button small variant="secondary" title="-" accessibilityLabel={`${t("career.cv.design.headingScale")} -`} onPress={() => scale(-0.1)} />
                <Button small variant="secondary" title="+" accessibilityLabel={`${t("career.cv.design.headingScale")} +`} onPress={() => scale(0.1)} />
              </View>
            </Card>
            <Card key={resetKey}>
              <ColourField label={t("career.cv.design.primary")} value={d.primary} onPick={(primary) => set({ primary })} />
              <ColourField label={t("career.cv.design.accent")} value={d.accent} onPick={(accent) => set({ accent })} />
              <ColourField label={t("career.cv.design.background")} value={d.background} onPick={(background) => set({ background })} />
            </Card>
            <Card>
              <Segmented label={t("career.cv.design.spacing")} value={d.spacing} onChange={(v) => set({ spacing: v })} options={opts(CV_SPACINGS, (v) => t(`career.cv.design.spacings.${v}`))} />
              <Segmented label={t("career.cv.design.margins")} value={d.margins} onChange={(v) => set({ margins: v })} options={opts(CV_MARGINS, (v) => t(`career.cv.design.marginOptions.${v}`))} />
              <Segmented label={t("career.cv.design.columns")} value={d.columns} onChange={(v) => set({ columns: v })} options={opts(CV_COLUMNS, (v) => t(`career.cv.design.columnOptions.${v}`))} />
              <PressableScale accessibilityRole="checkbox" accessibilityState={{ checked: d.showPhoto }} accessibilityLabel={t("career.cv.design.showPhoto")} onPress={() => set({ showPhoto: !d.showPhoto })} style={{ minHeight: 44, justifyContent: "center" }}>
                <AppText>{`${d.showPhoto ? "[x]" : "[ ]"} ${t("career.cv.design.showPhoto")}`}</AppText>
              </PressableScale>
              <Segmented label={t("career.cv.design.photoShape")} value={d.photoShape} onChange={(v) => set({ photoShape: v })} options={opts(CV_PHOTO_SHAPES, (v) => t(`career.cv.design.photoShapes.${v}`))} />
            </Card>
            <Card>
              <AppText variant="label">{t("career.cv.design.sectionOrder")}</AppText>
              {d.sectionOrder.map((s, i) => {
                const hidden = d.hidden.includes(s);
                return (
                  <View key={s} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, opacity: hidden ? 0.5 : 1 }}>
                    <AppText style={{ flex: 1, minWidth: 120 }}>{t(`career.cv.section.${s}`)}</AppText>
                    <Button small variant="secondary" title="↑" accessibilityLabel={t("career.cv.design.moveUp")} disabled={i === 0} onPress={() => set({ sectionOrder: moveItem(d.sectionOrder, i, -1) })} />
                    <Button small variant="secondary" title="↓" accessibilityLabel={t("career.cv.design.moveDown")} disabled={i === d.sectionOrder.length - 1} onPress={() => set({ sectionOrder: moveItem(d.sectionOrder, i, 1) })} />
                    <Button small variant="secondary" title={t(hidden ? "career.cv.design.show" : "career.cv.design.hide")} onPress={() => set({ hidden: toggleIn(d.hidden, s) })} />
                  </View>
                );
              })}
            </Card>
            <Button
              variant="secondary"
              title={t("career.cv.design.reset")}
              onPress={() => {
                onChange({});
                setResetKey((k) => k + 1);
              }}
            />
          </ScrollView>
        </View>
        <Button title={t("common.close")} onPress={onClose} />
      </View>
    </Modal>
  );
}

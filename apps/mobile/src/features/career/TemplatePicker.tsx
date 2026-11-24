import { CV_TEMPLATES, type CvTemplate } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useState } from "react";
import { Image, Modal, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "../../components/Icon";
import { AppText, Button, PressableScale } from "../../components/ui";
import { useTheme } from "../../theme/ThemeProvider";

// Real renders of the shared renderer: node scripts/cv-pdf-check.mjs --previews
const PREVIEWS: Record<CvTemplate, number> = {
  "modern-minimal": require("../../../assets/cv-templates/modern-minimal.png"),
  "corporate": require("../../../assets/cv-templates/corporate.png"),
  "executive": require("../../../assets/cv-templates/executive.png"),
  "creative": require("../../../assets/cv-templates/creative.png"),
  "academic": require("../../../assets/cv-templates/academic.png"),
  "graduate": require("../../../assets/cv-templates/graduate.png"),
  "two-column": require("../../../assets/cv-templates/two-column.png"),
  "ats-classic": require("../../../assets/cv-templates/ats-classic.png"),
  "modern-european": require("../../../assets/cv-templates/modern-european.png"),
  "clean-international": require("../../../assets/cv-templates/clean-international.png"),
};

export function TemplatePicker({ value, onChange }: { value: string; onChange: (v: CvTemplate) => void }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [preview, setPreview] = useState<CvTemplate | null>(null);
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 }}>
        {CV_TEMPLATES.map((id) => {
          const selected = id === value;
          const name = t(`career.cv.templates.${id}`);
          return (
            <View key={id} style={{ width: "48%", minWidth: 0 }}>
              <PressableScale accessibilityRole="button" accessibilityLabel={name} accessibilityState={{ selected }} onPress={() => (selected ? setPreview(id) : onChange(id))}>
                <View style={{ borderRadius: 12, borderWidth: selected ? 2 : 1, borderColor: selected ? theme.active : theme.border, overflow: "hidden" }}>
                  <Image source={PREVIEWS[id]} accessibilityIgnoresInvertColors style={{ width: "100%", aspectRatio: 400 / 566 }} resizeMode="cover" />
                  {selected ? (
                    <View style={{ position: "absolute", top: 6, right: 6, borderRadius: 999, padding: 3, backgroundColor: theme.active }}>
                      <Icon name="check" size="sm" color="#FFFFFF" />
                    </View>
                  ) : null}
                </View>
              </PressableScale>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                <AppText variant="caption" style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>
                  {name}
                </AppText>
                <PressableScale accessibilityRole="button" accessibilityLabel={`${t("career.cv.previewNote")}: ${name}`} hitSlop={10} onPress={() => setPreview(id)}>
                  <Icon name="eye" size="sm" />
                </PressableScale>
              </View>
            </View>
          );
        })}
      </View>
      <Modal visible={preview !== null} animationType="fade" onRequestClose={() => setPreview(null)} accessibilityViewIsModal>
        <View style={{ flex: 1, backgroundColor: "#000000EE", paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12, paddingHorizontal: 16, gap: 12 }}>
          {preview ? (
            <>
              <AppText variant="heading" style={{ color: "#FFFFFF" }}>
                {t(`career.cv.templates.${preview}`)}
              </AppText>
              <Image source={PREVIEWS[preview]} accessibilityIgnoresInvertColors style={{ flex: 1, width: "100%" }} resizeMode="contain" />
              <AppText variant="caption" style={{ color: "#FFFFFF", textAlign: "center" }}>
                {t("career.cv.previewNote")}
              </AppText>
              <Button title={t("common.close")} onPress={() => setPreview(null)} />
            </>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

export function NewCvTemplateModal({ open, busy, initial, onCancel, onCreate }: { open: boolean; busy: boolean; initial: CvTemplate; onCancel: () => void; onCreate: (v: CvTemplate) => void }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState<CvTemplate>(initial);
  return (
    <Modal visible={open} animationType="slide" onRequestClose={onCancel} accessibilityViewIsModal>
      <View style={{ flex: 1, backgroundColor: theme.surface, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12, paddingHorizontal: 16, gap: 12 }}>
        <AppText variant="heading">{t("career.cv.pickTemplate")}</AppText>
        <View style={{ flex: 1 }}>
          <ScrollView>
            <TemplatePicker value={value} onChange={setValue} />
          </ScrollView>
        </View>
        <Button title={t("career.cv.createWithTemplate")} loading={busy} onPress={() => onCreate(value)} />
        <Button title={t("common.cancel")} variant="secondary" onPress={onCancel} />
      </View>
    </Modal>
  );
}


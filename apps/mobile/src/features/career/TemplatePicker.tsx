import { CV_LANGUAGES, CV_TEMPLATE_CATALOG, CV_TEMPLATE_CATEGORIES, cvTemplateMeta, type CvLanguage, type CvTemplate, type CvTemplateCategory } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useMemo, useState } from "react";
import { Image, Modal, ScrollView, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Badge, Button, PressableScale, Segmented } from "../../components/ui";
import { useTheme } from "../../theme/ThemeProvider";
import { buildSampleHtml } from "./cv-export";
import { CvWebPreview } from "./CvWebPreview";

// Real renders of the shared renderer (node scripts/cv-pdf-check.mjs --previews). Legacy ids keep their old picture for list thumbnails.
export const CV_PREVIEWS: Record<string, number> = {
  "modern-minimal": require("../../../assets/cv-templates/modern-minimal.png"),
  corporate: require("../../../assets/cv-templates/corporate.png"),
  executive: require("../../../assets/cv-templates/executive.png"),
  creative: require("../../../assets/cv-templates/creative.png"),
  academic: require("../../../assets/cv-templates/academic.png"),
  graduate: require("../../../assets/cv-templates/graduate.png"),
  "two-column": require("../../../assets/cv-templates/two-column.png"),
  "ats-classic": require("../../../assets/cv-templates/ats-classic.png"),
  "modern-european": require("../../../assets/cv-templates/modern-european.png"),
  "clean-international": require("../../../assets/cv-templates/clean-international.png"),
  europass: require("../../../assets/cv-templates/europass.png"),
  sidebar: require("../../../assets/cv-templates/sidebar.png"),
  headline: require("../../../assets/cv-templates/headline.png"),
  timeline: require("../../../assets/cv-templates/timeline.png"),
  elegant: require("../../../assets/cv-templates/elegant.png"),
  photocard: require("../../../assets/cv-templates/photocard.png"),
  split: require("../../../assets/cv-templates/split.png"),
  classic: require("../../../assets/cv-templates/classic.png"),
  modern: require("../../../assets/cv-templates/modern.png"),
  compact: require("../../../assets/cv-templates/compact.png"),
  minimal: require("../../../assets/cv-templates/minimal.png"),
  ats: require("../../../assets/cv-templates/ats.png"),
};
/** Thumbnail for any stored template id (unknown ids fall back to the default template picture). */
export const cvPreviewFor = (id: string): number => CV_PREVIEWS[id] ?? CV_PREVIEWS[cvTemplateMeta(id).id]!;

type Filter = "all" | CvTemplateCategory;

/** Template gallery: category chips, cards, full-screen picture preview (no WebView in this app, so the picture is a real render of sample data). */
export function TemplateGallery({ open, current, busy, actionLabel, onClose, onUse }: { open: boolean; current?: string | undefined; busy?: boolean; actionLabel: string; onClose: () => void; onUse: (id: CvTemplate) => void }) {
  const { t, locale } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>("all");
  const [preview, setPreview] = useState<CvTemplate | null>(null);
  const shown = CV_TEMPLATE_CATALOG.filter((m) => filter === "all" || m.categories.includes(filter));
  const currentId = current ? cvTemplateMeta(current).id : null;
  const pm = preview ? cvTemplateMeta(preview) : null;
  const { height: wh } = useWindowDimensions();
  const lang = (CV_LANGUAGES as readonly string[]).includes(locale) ? (locale as CvLanguage) : "az";
  const sampleHtml = useMemo(() => (pm ? buildSampleHtml(pm.id, lang) : null), [pm, lang]);
  const chips = [{ value: "all" as Filter, label: t("cvMobile.categoryAll") }, ...CV_TEMPLATE_CATEGORIES.map((c) => ({ value: c as Filter, label: t(`career.cv.templateCategory.${c}`) }))];
  return (
    <Modal visible={open} animationType="slide" onRequestClose={pm ? () => setPreview(null) : onClose} accessibilityViewIsModal>
      <View style={{ flex: 1, backgroundColor: theme.surface, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12, paddingHorizontal: 16, gap: 12 }}>
        {pm ? (
          <>
            <AppText variant="heading">{t(pm.nameKey)}</AppText>
            <View style={{ flex: 1 }}>
              <CvWebPreview html={sampleHtml} height={Math.max(300, wh - insets.top - insets.bottom - 340)} />
            </View>
            <AppText muted>{t(pm.descriptionKey)}</AppText>
            {pm.atsFriendly ? <Badge tone="success">{t("career.cv.atsFriendly")}</Badge> : null}
            <AppText variant="caption" muted>
              {t("career.cv.previewNote")}
            </AppText>
            <Button title={actionLabel} loading={busy ?? false} onPress={() => onUse(pm.id)} />
            <Button title={t("common.close")} variant="secondary" onPress={() => setPreview(null)} />
          </>
        ) : (
          <>
            <AppText variant="heading">{t("cvMobile.galleryTitle")}</AppText>
            <Segmented label={t("career.cv.template")} value={filter} onChange={setFilter} options={chips} />
            <View style={{ flex: 1 }}>
              <ScrollView contentContainerStyle={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 16, paddingBottom: 8 }}>
                {shown.map((m) => {
                  const selected = m.id === currentId;
                  return (
                    <View key={m.id} style={{ width: "48%", minWidth: 0, gap: 4 }}>
                      <PressableScale accessibilityRole="button" accessibilityLabel={t(m.nameKey)} accessibilityState={{ selected }} onPress={() => setPreview(m.id)}>
                        <View style={{ borderRadius: 12, borderWidth: selected ? 2 : 1, borderColor: selected ? theme.active : theme.border, overflow: "hidden" }}>
                          <Image source={CV_PREVIEWS[m.id]} accessibilityIgnoresInvertColors style={{ width: "100%", aspectRatio: 400 / 566 }} resizeMode="cover" />
                        </View>
                      </PressableScale>
                      <AppText variant="label" numberOfLines={1}>
                        {t(m.nameKey)}
                      </AppText>
                      <AppText variant="caption" muted numberOfLines={3}>
                        {t(m.descriptionKey)}
                      </AppText>
                      {m.atsFriendly ? <Badge tone="success">{t("career.cv.atsFriendly")}</Badge> : null}
                      <Button small title={actionLabel} variant={selected ? "secondary" : "primary"} onPress={() => onUse(m.id)} />
                    </View>
                  );
                })}
              </ScrollView>
            </View>
            <Button title={t("common.close")} variant="secondary" onPress={onClose} />
          </>
        )}
      </View>
    </Modal>
  );
}

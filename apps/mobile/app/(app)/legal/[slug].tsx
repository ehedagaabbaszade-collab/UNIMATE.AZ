import { useI18n } from "@unimate/i18n/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import { AppText, EmptyState, Notice, Screen, ScreenHeader } from "../../../src/components/ui";
import { LEGAL_SLUGS, legal, type LegalSlug } from "../../../src/lib/legal";

/** Draft legal pages shared with the web app (same content module), in the user's language. */
export default function LegalPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const known = (LEGAL_SLUGS as readonly string[]).includes(String(slug));
  const doc = known ? legal[locale][slug as LegalSlug] : null;
  return (
    <Screen>
      <ScreenHeader title={doc?.title ?? t("legal.title")} onBack={() => router.back()} />
      {!doc ? (
        <EmptyState title={t("legal.notFound")} />
      ) : (
        <View style={{ gap: 14 }}>
          <Notice tone="warning" text={t("legal.draftBanner")} />
          <AppText muted variant="caption">
            {t("legal.lastUpdated")}
          </AppText>
          {doc.sections.map((s) => (
            <View key={s.h} style={{ gap: 6 }}>
              <AppText variant="heading" accessibilityRole="header">
                {s.h}
              </AppText>
              {s.p?.map((p, i) => (
                <AppText key={i} selectable>
                  {p}
                </AppText>
              ))}
              {s.ul?.map((li, i) => (
                <AppText key={i} selectable>
                  {"• "}
                  {li}
                </AppText>
              ))}
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

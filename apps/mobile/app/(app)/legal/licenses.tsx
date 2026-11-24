import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { Linking, Pressable, View } from "react-native";
import { AppText, ExpandCard, Screen, ScreenHeader } from "../../../src/components/ui";
import list from "../../../src/features/legal/third-party.json";

type Entry = { name: string; version: string; license: string; url: string };

const LICENSE_NAMES: Record<string, string> = {
  MIT: "MIT License",
  ISC: "ISC License",
  "Apache-2.0": "Apache License 2.0",
  "BSD-2-Clause": "BSD 2-Clause License",
  "BSD-3-Clause": "BSD 3-Clause License",
  "0BSD": "Zero-Clause BSD License",
  "MPL-2.0": "Mozilla Public License 2.0",
  Unlicense: "The Unlicense",
  "CC0-1.0": "Creative Commons Zero 1.0",
  "CC-BY-4.0": "Creative Commons Attribution 4.0",
  "BlueOak-1.0.0": "Blue Oak Model License 1.0.0",
  "Python-2.0": "Python Software Foundation License 2.0",
};

/** Packages grouped by license, largest group first (bundled JSON from `npm run licenses:build`). */
const groups = Object.entries(
  (list as Entry[]).reduce<Record<string, Entry[]>>((acc, e) => {
    (acc[e.license || "UNKNOWN"] ??= []).push(e);
    return acc;
  }, {}),
).sort((a, b) => b[1].length - a[1].length);

export default function LicensesScreen() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Screen>
      <ScreenHeader title={t("legal.licenses.title")} onBack={() => router.back()} />
      <View style={{ gap: 14 }}>
        <AppText selectable>{t("legal.licenses.ownership")}</AppText>
        <AppText selectable>{t("legal.licenses.intro")}</AppText>
        {groups.map(([id, entries]) => (
          <ExpandCard
            key={id}
            label={`${LICENSE_NAMES[id] ?? id}, ${t("legal.licenses.count", { n: entries.length })}`}
            header={
              <View style={{ gap: 2, flex: 1, minWidth: 0 }}>
                <AppText variant="heading" accessibilityRole="header">
                  {LICENSE_NAMES[id] ?? id}
                </AppText>
                <AppText muted variant="caption">
                  {`SPDX: ${id} · ${t("legal.licenses.count", { n: entries.length })}`}
                </AppText>
              </View>
            }
          >
            <View style={{ gap: 2 }}>
              {entries.map((e) => (
                <Pressable
                  key={`${e.name}@${e.version}`}
                  accessibilityRole={e.url ? "link" : "text"}
                  disabled={!e.url}
                  onPress={() => void Linking.openURL(e.url).catch(() => undefined)}
                  style={{ paddingVertical: 6, minHeight: 44, justifyContent: "center" }}
                >
                  <AppText variant="caption" selectable>
                    {`${e.name} ${e.version}`}
                  </AppText>
                </Pressable>
              ))}
            </View>
          </ExpandCard>
        ))}
      </View>
    </Screen>
  );
}

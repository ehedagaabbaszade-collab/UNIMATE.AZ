import { LOCALES, LOCALE_NAMES, createTranslator } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { View } from "react-native";
import { useLocaleControl } from "../state/locale";
import { Segmented, useToast } from "./ui";

/** Language chooser (endonyms). The change is applied at once and persisted by the LocaleProvider (device + profiles.locale). */
export function LanguageSelector() {
  const { t, locale } = useI18n();
  const { setLocale } = useLocaleControl();
  const { toast } = useToast();
  return (
    <View>
      <Segmented
        label={t("language.label")}
        value={locale}
        options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
        onChange={(l) => {
          void setLocale(l).then((ok) => {
            if (!ok) toast(createTranslator(l)("language.saveFailed"), "error");
          });
        }}
      />
    </View>
  );
}

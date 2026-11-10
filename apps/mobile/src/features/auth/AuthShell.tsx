import type { ReactNode } from "react";
import { View } from "react-native";
import { BrandLogo } from "../../components/Brand";
import { LanguageSelector } from "../../components/LanguageSelector";
import { Card, Screen } from "../../components/ui";

/** Shared frame for the signed-out screens: logo, language chooser (az default), and a card. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <Screen>
      <View style={{ alignItems: "center", paddingTop: 8 }}>
        <BrandLogo height={110} />
      </View>
      <LanguageSelector />
      <Card style={{ gap: 14 }}>{children}</Card>
    </Screen>
  );
}

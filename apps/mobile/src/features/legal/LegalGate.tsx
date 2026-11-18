import { isFunctionMissing, legalErrorKind, legalGate, type LegalGate as Gate } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useEffect, useState } from "react";
import { Modal, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppText, Button, Notice } from "../../components/ui";
import { useSession } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { spacing } from "../../theme/tokens";
import { BirthDateField, ConsentChecks, birthIssue, type Checked, type ConsentType } from "./ConsentFields";

export const consentPlatform = (): "ios" | "android" => (Platform.OS === "ios" ? "ios" : "android");

/** Blocks the signed-in app until the birth date is on file and every required document is (re)accepted. */
export function LegalGate() {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { supabase: sb, signOut } = useSession();
  const [gate, setGate] = useState<Gate | null>(null);
  const [birth, setBirth] = useState("");
  const [checked, setChecked] = useState<Checked>({});
  const [busy, setBusy] = useState(false);
  const [underage, setUnderage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sb) return;
    void Promise.all([sb.rpc("legal_profile_status"), sb.rpc("legal_consent_status")]).then(([p, c]) => {
      // Fail open only when the functions are not deployed yet (remote DB not migrated).
      if (p.error || c.error || isFunctionMissing(p.error) || isFunctionMissing(c.error)) return;
      const g = legalGate(p.data, c.data);
      if (g.needsBirth || g.pending.length) setGate(g);
    });
  }, [sb]);

  if (!gate || !sb) return null;
  const pending = gate.pending as ConsentType[];
  const birthErr = gate.needsBirth ? birthIssue(birth) : null;
  const ready = !birthErr && pending.every((k) => checked[k]);

  async function submit() {
    if (!ready || !sb) return;
    setBusy(true);
    setError(null);
    const b = gate!.needsBirth ? await sb.rpc("set_birth_date", { p_birth: birth }) : null;
    const r = b?.error ? b : pending.length ? await sb.rpc("record_consents", { p_types: pending, p_platform: consentPlatform(), p_context: "reconsent" }) : null;
    setBusy(false);
    if (r?.error) {
      if (legalErrorKind(r.error) === "underage") return setUnderage(true);
      return setError(t("common.genericError"));
    }
    setGate(null);
  }

  return (
    <Modal visible animationType="slide" onRequestClose={() => undefined}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
          <AppText variant="title" accessibilityRole="header">
            {t("consent.gateTitle")}
          </AppText>
          {underage ? (
            <Notice text={t("consent.errUnderage")} />
          ) : (
            <>
              <AppText muted>{t("consent.gateBody")}</AppText>
              {error ? <Notice text={error} /> : null}
              {gate.needsBirth ? <BirthDateField onChange={setBirth} error={birth && birthErr ? t(birthErr) : undefined} /> : null}
              <ConsentChecks types={pending} checked={checked} onCheck={(k, v) => setChecked((c) => ({ ...c, [k]: v }))} />
              <Button title={t("consent.gateCta")} onPress={() => void submit()} loading={busy} disabled={!ready} />
            </>
          )}
          <View>
            <Button title={t("nav.signOut")} variant="secondary" onPress={() => void signOut()} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

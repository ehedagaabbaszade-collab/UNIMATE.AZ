import { useI18n } from "@unimate/i18n/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, View, useWindowDimensions } from "react-native";
import { Button, Input, Pill, Screen, ScreenHeader } from "../../../src/components/ui";
import { CardPreview } from "../../../src/features/payments/CardPreview";
import { cvvValid, detectBrand, digitsOf, expiryValid, formatCardNumber, formatExpiry, isTestCard, last4 } from "../../../src/features/payments/card";
import { DemoBadge, Processing } from "../../../src/features/payments/parts";
import { paidPlan, planPrice, usePayment } from "../../../src/features/payments/usePayment";
import { spacing } from "../../../src/theme/tokens";

/** Step 2 (card): demo form. Card fields live in component state only: never logged, stored or sent anywhere. */
export default function CheckoutCardRoute() {
  const { t, number: fmt } = useI18n();
  const router = useRouter();
  const plan = paidPlan(useLocalSearchParams<{ plan?: string }>().plan);
  const { busy, pay, cancel } = usePayment(plan);
  const [holder, setHolder] = useState("");
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [flipped, setFlipped] = useState(false);
  const [cvvSeen, setCvvSeen] = useState(false);
  const compact = useWindowDimensions().height < 740;
  const [kb, setKb] = useState(false);
  useEffect(() => {
    const a = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setKb(true));
    const b = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKb(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  // Small phone + keyboard: drop decoration so the four fields and Pay stay on screen without scrolling.
  const squeeze = compact && kb;

  const brand = detectBrand(number);
  const full = digitsOf(number).length === 16;
  const numberError = full && !isTestCard(number) ? t("mobile.checkout.errDemo") : undefined;
  const expiryError = expiry.length === 5 && !expiryValid(expiry) ? t("mobile.checkout.errExpiry") : undefined;
  const cvvError = cvvSeen && !flipped && cvv.length > 0 && !cvvValid(cvv) ? t("mobile.checkout.errCvv") : undefined;
  const canPay = !busy && holder.trim().length >= 2 && isTestCard(number) && expiryValid(expiry) && cvvValid(cvv);
  const amount = fmt(planPrice(plan), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fillTest = () => {
    setHolder("Test User");
    setNumber("4242 4242 4242 4242");
    setExpiry(`12/${String((new Date().getFullYear() + 3) % 100).padStart(2, "0")}`);
    setCvv("123");
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <Screen scroll={false} style={{ gap: compact ? spacing.sm : spacing.lg }}>
        <ScreenHeader title={t("mobile.checkout.card")} />
        {squeeze ? null : (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
              <View style={{ flexShrink: 1 }}>
                <DemoBadge />
              </View>
              <Pill label={t("mobile.checkout.fillTest")} tone="accent" onPress={fillTest} />
            </View>
            <View style={{ width: compact ? 220 : "100%", alignSelf: "center" }}>
              <CardPreview number={number} holder={holder} expiry={expiry} cvv={cvv} brand={brand} flipped={flipped} />
            </View>
          </>
        )}
        <Input label={t("mobile.checkout.holder")} value={holder} onChangeText={setHolder} autoCapitalize="characters" autoCorrect={false} autoComplete="off" textContentType="none" onFocus={() => setFlipped(false)} />
        <Input label={t("mobile.checkout.number")} value={number} onChangeText={(v) => setNumber(formatCardNumber(v))} keyboardType="number-pad" maxLength={19} autoComplete="off" textContentType="none" error={numberError} onFocus={() => setFlipped(false)} />
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Input label={t("mobile.checkout.expiry")} placeholder={t("mobile.checkout.expiryPh")} value={expiry} onChangeText={(v) => setExpiry(formatExpiry(v))} keyboardType="number-pad" maxLength={5} autoComplete="off" textContentType="none" error={expiryError} onFocus={() => setFlipped(false)} />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label={t("mobile.checkout.cvv")}
              value={cvv}
              onChangeText={(v) => setCvv(digitsOf(v).slice(0, 4))}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              autoComplete="off"
              textContentType="none"
              error={cvvError}
              onFocus={() => {
                setCvvSeen(true);
                setFlipped(true);
              }}
              onBlur={() => setFlipped(false)}
            />
          </View>
        </View>
        <Button title={t("mobile.checkout.pay", { amount })} disabled={!canPay} onPress={() => void pay("card", { kind: "card", number, expiry, cvv, holder }, { brand, last4: last4(number) })} />
        {squeeze ? null : <Button small={compact} title={t("mobile.checkout.cancel")} variant="ghost" onPress={() => router.dismissTo("/plans")} />}
      </Screen>
      {busy ? <Processing onCancel={cancel} /> : null}
    </KeyboardAvoidingView>
  );
}

import { PRICE_AZN } from "@unimate/core";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import type { CardBrand } from "./card";
import { getPaymentProvider, type ConfirmPayload, type PaidPlan, type PayMethod, type PaymentIntent } from "./provider";

/** Brand names are not translated. */
export const BRAND_NAME: Record<CardBrand, string> = { visa: "Visa", mastercard: "Mastercard" };
/** Platform pay: Apple Pay on iOS, Google Pay elsewhere (demo sheet only, no real wallet API). */
export const WALLET_NAME = Platform.OS === "ios" ? "Apple Pay" : "Google Pay";

export const paidPlan = (p: unknown): PaidPlan => (p === "PRO" ? "PRO" : "PLUS");
export const planPrice = (p: PaidPlan): number => PRICE_AZN[p];

/** Runs one simulated payment and replaces the screen with the result. Cancels a pending intent on unmount. */
export function usePayment(plan: PaidPlan) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const intent = useRef<PaymentIntent | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (intent.current) getPaymentProvider().cancel(intent.current);
    };
  }, []);

  const pay = useCallback(
    async (method: PayMethod, payload: ConfirmPayload, shown: { brand?: CardBrand | null; last4?: string }) => {
      const provider = getPaymentProvider();
      const amountAzn = PRICE_AZN[plan];
      setBusy(true);
      const { intentId } = await provider.createIntent({ planId: plan, amountAzn, method });
      const current: PaymentIntent = { intentId, planId: plan, amountAzn, method };
      intent.current = current;
      const res = await provider.confirm(current, payload);
      intent.current = null;
      if (!alive.current) return;
      setBusy(false);
      router.replace({ pathname: "/checkout/result", params: { plan, method, status: res.status, tx: res.transactionId ?? "", err: res.errorCode ?? "", brand: shown.brand ?? "", last4: shown.last4 ?? "", at: String(Date.now()) } });
    },
    [plan, router],
  );
  const cancel = useCallback(() => {
    if (intent.current) getPaymentProvider().cancel(intent.current);
  }, []);
  return { busy, pay, cancel };
}

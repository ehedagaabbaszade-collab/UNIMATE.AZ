import { TEST_CARDS, digitsOf } from "./card";

/** DEMO ONLY: no network, no money. Real adapters (Payriff, Epoint) plug in via getPaymentProvider(). */
export type PayMethod = "card" | "wallet";
export type PaidPlan = "PLUS" | "PRO";
export interface PaymentIntent {
  intentId: string;
  planId: PaidPlan;
  amountAzn: number;
  method: PayMethod;
}
/** Demo-only payload. A real provider uses a server-side redirect/hosted checkout: card data never enters the app. */
export type ConfirmPayload = { kind: "card"; number: string; expiry: string; cvv: string; holder: string } | { kind: "wallet" };
export interface PaymentResult {
  status: "succeeded" | "failed" | "canceled";
  transactionId?: string;
  errorCode?: string;
}

export interface PaymentProvider {
  id: string;
  displayName: string;
  supports(method: PayMethod): boolean;
  createIntent(input: { planId: PaidPlan; amountAzn: number; method: PayMethod }): Promise<{ intentId: string }>;
  confirm(intent: PaymentIntent, payload: ConfirmPayload): Promise<PaymentResult>;
  cancel(intent: PaymentIntent): void;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class DemoProvider implements PaymentProvider {
  id = "demo";
  displayName = "Demo";
  private pending = new Map<string, { timer: ReturnType<typeof setTimeout>; resolve: (r: PaymentResult) => void }>();
  constructor(
    private readonly delayMs: readonly [number, number] = [1600, 2400],
    private readonly rng: () => number = Math.random,
  ) {}

  supports(): boolean {
    return true;
  }

  async createIntent(): Promise<{ intentId: string }> {
    return { intentId: `pi_demo_${Math.floor(this.rng() * 1e9).toString(36)}` };
  }

  confirm(intent: PaymentIntent, payload: ConfirmPayload): Promise<PaymentResult> {
    const outcome = (): PaymentResult => {
      if (payload.kind === "wallet") return { status: "succeeded", transactionId: this.txId() };
      const rule = TEST_CARDS[digitsOf(payload.number)];
      if (rule === "succeeded") return { status: "succeeded", transactionId: this.txId() };
      return { status: "failed", errorCode: rule ? "card_declined" : "demo_card_only" };
    };
    const [lo, hi] = this.delayMs;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(intent.intentId);
        resolve(outcome());
      }, lo + this.rng() * (hi - lo));
      this.pending.set(intent.intentId, { timer, resolve });
    });
  }

  cancel(intent: PaymentIntent): void {
    const p = this.pending.get(intent.intentId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(intent.intentId);
    p.resolve({ status: "canceled" });
  }

  private txId(): string {
    return `UM-${Array.from({ length: 8 }, () => ALPHABET[Math.floor(this.rng() * ALPHABET.length)]).join("")}`;
  }
}

const demo = new DemoProvider();
/** Swap point: return a Payriff/Epoint adapter here (server-side redirect/hosted checkout, never card data in the app). */
export function getPaymentProvider(): PaymentProvider {
  return demo;
}

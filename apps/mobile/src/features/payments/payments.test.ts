import { afterEach, describe, expect, it, vi } from "vitest";
import { cvvValid, detectBrand, expiryValid, formatCardNumber, formatExpiry, isTestCard, luhn, maskCard } from "./card";
import { DemoProvider, type PaymentIntent } from "./provider";

describe("card helpers", () => {
  it("formats, detects brand, luhn", () => {
    expect(formatCardNumber("4242424242424242999")).toBe("4242 4242 4242 4242");
    expect(detectBrand("4242")).toBe("visa");
    expect(detectBrand("5555 5555")).toBe("mastercard");
    expect(detectBrand("3400")).toBeNull();
    expect(luhn("4242 4242 4242 4242")).toBe(true);
    expect(luhn("4242 4242 4242 4243")).toBe(false);
  });
  it("expiry and cvv", () => {
    const now = new Date(2026, 10, 15);
    expect(formatExpiry("1226")).toBe("12/26");
    expect(formatExpiry("4")).toBe("04");
    expect(expiryValid("11/26", now)).toBe(true);
    expect(expiryValid("10/26", now)).toBe(false);
    expect(expiryValid("13/30", now)).toBe(false);
    expect(cvvValid("123")).toBe(true);
    expect(cvvValid("12")).toBe(false);
    expect(cvvValid("12345")).toBe(false);
  });
  it("test cards and mask", () => {
    expect(isTestCard("4242 4242 4242 4242")).toBe(true);
    expect(isTestCard("4111 1111 1111 1111")).toBe(false);
    expect(maskCard("4242424242424242")).toBe("4242 •••• •••• 4242");
  });
});

describe("DemoProvider", () => {
  afterEach(() => vi.useRealTimers());
  const intent: PaymentIntent = { intentId: "i1", planId: "PLUS", amountAzn: 4.99, method: "card" };
  const card = (number: string) => ({ kind: "card" as const, number, expiry: "12/30", cvv: "123", holder: "A B" });
  const run = async (p: Promise<unknown>) => {
    await vi.advanceTimersByTimeAsync(2500);
    return p;
  };

  it("succeeds for known cards, declines 0002, rejects others", async () => {
    vi.useFakeTimers();
    const d = new DemoProvider();
    expect(await run(d.confirm(intent, card("4242 4242 4242 4242")))).toMatchObject({ status: "succeeded", transactionId: expect.stringMatching(/^UM-[A-Z0-9]{8}$/) });
    expect(await run(d.confirm(intent, card("5555555555554444")))).toMatchObject({ status: "succeeded" });
    expect(await run(d.confirm(intent, card("4000000000000002")))).toMatchObject({ status: "failed", errorCode: "card_declined" });
    expect(await run(d.confirm(intent, card("4111111111111111")))).toMatchObject({ status: "failed", errorCode: "demo_card_only" });
    expect(await run(d.confirm(intent, { kind: "wallet" }))).toMatchObject({ status: "succeeded" });
  });
  it("cancel resolves canceled before the delay", async () => {
    vi.useFakeTimers();
    const d = new DemoProvider();
    const p = d.confirm(intent, card("4242424242424242"));
    d.cancel(intent);
    expect(await p).toEqual({ status: "canceled" });
  });
});

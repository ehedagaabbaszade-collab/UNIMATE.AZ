import { describe, expect, it } from "vitest";
import { FakeProvider } from "../testing";
import * as index from "../index";
import { DEFAULT_PRICE_TABLE, ProviderNotConfiguredError, computeCost, routeModel, sumCosts } from "./provider";

describe("routing", () => {
  it("routes by plan and task", () => {
    expect(routeModel("FREE", "chat")).toBe("small");
    expect(routeModel("PLUS", "chat")).toBe("standard");
    expect(routeModel("PRO", "quiz")).toBe("premium");
  });
});

describe("cost accounting", () => {
  it("computes micro costs", () => {
    // standard: $1/MTok in, $4/MTok out => 1000 in + 500 out = 1000 + 2000 micro-USD
    const c = computeCost("standard", { inputTokens: 1000, outputTokens: 500 });
    expect(c.usdMicro).toBe(3000);
    expect(c.aznMicro).toBe(5100);
  });
  it("supports custom price table and rate", () => {
    const table = { ...DEFAULT_PRICE_TABLE, small: { inputUsdPerMTok: 2, outputUsdPerMTok: 2 } };
    expect(computeCost("small", { inputTokens: 10, outputTokens: 10 }, table, 2)).toEqual({ usdMicro: 40, aznMicro: 80 });
  });
  it("zero usage costs zero; negative throws", () => {
    expect(computeCost("premium", { inputTokens: 0, outputTokens: 0 })).toEqual({ usdMicro: 0, aznMicro: 0 });
    expect(() => computeCost("premium", { inputTokens: -1, outputTokens: 0 })).toThrow(RangeError);
  });
  it("sums", () => {
    expect(sumCosts([{ usdMicro: 1, aznMicro: 2 }, { usdMicro: 3, aznMicro: 4 }])).toEqual({ usdMicro: 4, aznMicro: 6 });
  });
});

describe("errors and fake provider", () => {
  it("ProviderNotConfiguredError", () => {
    const e = new ProviderNotConfiguredError("openai");
    expect(e).toBeInstanceOf(Error);
    expect(e.provider).toBe("openai");
    expect(e.name).toBe("ProviderNotConfiguredError");
  });
  it("FakeProvider is deterministic", async () => {
    const p = new FakeProvider();
    const a = await p.generate({ task: "chat", model: "m", prompt: "hello" });
    const b = await new FakeProvider().generate({ task: "chat", model: "m", prompt: "hello" });
    expect(a).toEqual(b);
    const e1 = await p.embed({ model: "m", inputs: ["x", "y"] });
    const e2 = await p.embed({ model: "m", inputs: ["x", "y"] });
    expect(e1.vectors).toEqual(e2.vectors);
    expect(e1.vectors[0]).not.toEqual(e1.vectors[1]);
  });
  it("FakeProvider is not exported from index", () => {
    expect("FakeProvider" in index).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validatedUpdate } from "./validated-update";

const schema = z.object({ items: z.array(z.number().int().max(600)).max(2) });

describe("validatedUpdate", () => {
  it("accepts a valid next value", () => {
    expect(validatedUpdate(schema, { items: [1] }, (p) => ({ items: [...p.items, 2] }))).toEqual({ value: { items: [1, 2] }, ok: true });
  });
  it("keeps the previous value when the next one would not load back", () => {
    const prev = { items: [1, 2] };
    expect(validatedUpdate(schema, prev, (p) => ({ items: [...p.items, 3] }))).toEqual({ value: prev, ok: false });
    expect(validatedUpdate(schema, { items: [1] }, () => ({ items: [999] })).ok).toBe(false);
  });
});

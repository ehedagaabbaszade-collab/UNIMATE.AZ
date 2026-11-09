import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("toolchain", () => {
  it("runs vitest and resolves zod", () => {
    expect(z.string().parse("unimate")).toBe("unimate");
  });
});

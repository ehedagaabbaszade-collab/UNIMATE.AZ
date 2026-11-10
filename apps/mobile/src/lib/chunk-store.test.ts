import { describe, expect, it } from "vitest";
import { createChunkedStorage, splitChunks, type KvBackend } from "./chunk-store";

const memory = (): KvBackend & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, get: async (k) => map.get(k) ?? null, set: async (k, v) => void map.set(k, v), remove: async (k) => void map.delete(k) };
};

describe("chunked secure storage", () => {
  it("splits and rejoins large values", async () => {
    const kv = memory();
    const s = createChunkedStorage(kv, 10);
    const v = "x".repeat(95) + "ğəı";
    await s.setItem("sb", v);
    expect(kv.map.size).toBeGreaterThan(5);
    expect(await s.getItem("sb")).toBe(v);
  });
  it("overwrites without leaving stale parts and removes everything", async () => {
    const kv = memory();
    const s = createChunkedStorage(kv, 4);
    await s.setItem("k", "abcdefghijkl");
    await s.setItem("k", "ab");
    expect(await s.getItem("k")).toBe("ab");
    await s.removeItem("k");
    expect(kv.map.size).toBe(0);
    expect(await s.getItem("k")).toBeNull();
  });
  it("returns null for a torn write", async () => {
    const kv = memory();
    const s = createChunkedStorage(kv, 4);
    await s.setItem("k", "abcdefgh");
    kv.map.delete("k.1");
    expect(await s.getItem("k")).toBeNull();
  });
  it("splitChunks handles empty input", () => expect(splitChunks("")).toEqual([""]));
});

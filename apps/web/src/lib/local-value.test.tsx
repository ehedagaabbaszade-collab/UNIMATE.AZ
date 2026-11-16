// @vitest-environment jsdom
import "@/test/dom";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { useLocalValue } from "./local-value";

const schema = z.object({ n: z.number() });

describe("useLocalValue", () => {
  beforeEach(() => localStorage.clear());

  it("persists updates for a valid or missing value", async () => {
    const { result } = renderHook(() => useLocalValue("k", schema, { n: 0 }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    let ok = false;
    act(() => void (ok = result.current.update(() => ({ n: 2 }))));
    expect(ok).toBe(true);
    expect(localStorage.getItem("k")).toBe('{"n":2}');
  });

  it.each(["{not json", '{"n":"x"}'])("does not overwrite a corrupt stored value (%s)", async (raw) => {
    localStorage.setItem("k", raw);
    const { result } = renderHook(() => useLocalValue("k", schema, { n: 0 }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.value).toEqual({ n: 0 }); // reads still show the default
    let ok = true;
    act(() => void (ok = result.current.update(() => ({ n: 5 }))));
    expect(ok).toBe(false);
    expect(localStorage.getItem("k")).toBe(raw);
  });
});

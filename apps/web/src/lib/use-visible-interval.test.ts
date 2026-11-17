// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVisibleInterval } from "./use-visible-interval";

const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("useVisibleInterval", () => {
  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
  });

  it("polls while visible, stops while hidden, refreshes on return", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    renderHook(() => useVisibleInterval(fn, 1000, true));
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(2);
    setHidden(true);
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(2);
    setHidden(false);
    expect(fn).toHaveBeenCalledTimes(3); // immediate refresh
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("does nothing when inactive", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    renderHook(() => useVisibleInterval(fn, 1000, false));
    vi.advanceTimersByTime(3000);
    expect(fn).not.toHaveBeenCalled();
  });
});

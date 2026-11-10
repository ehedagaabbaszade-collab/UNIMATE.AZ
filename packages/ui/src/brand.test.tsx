// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BRAND_ASSETS, BrandLogo, BrandMark } from "./Brand";

afterEach(() => cleanup());
const srcs = (c: HTMLElement) => [...c.querySelectorAll("img")].map((i) => i.getAttribute("src"));

describe("BrandLogo", () => {
  it("light uses logo-light.png only, with explicit size and a single accessible name", () => {
    const { container } = render(<BrandLogo label="UNIMATE.AZ logo" variant="light" height={100} />);
    expect(srcs(container)).toEqual(["/brand/logo-light.png"]);
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("height", "100");
    expect(img).toHaveAttribute("width", "120"); // 800/665 * 100
    expect(img).toHaveAttribute("alt", "");
    expect(screen.getAllByRole("img", { name: "UNIMATE.AZ logo" })).toHaveLength(1);
  });
  it("dark uses mark-tile.png + wordmark-white.png only", () => {
    const { container } = render(<BrandLogo label="UNIMATE.AZ logo" variant="dark" />);
    expect(srcs(container)).toEqual(["/brand/mark-tile.png", "/brand/wordmark-white.png"]);
  });
  it("auto renders both artworks, switched by theme CSS, still one accessible image", () => {
    const { container } = render(<BrandLogo label="UNIMATE.AZ logo" />);
    expect(srcs(container)).toEqual(["/brand/logo-light.png", "/brand/mark-tile.png", "/brand/wordmark-white.png"]);
    expect(container.firstElementChild).toHaveClass("um-brand--auto");
    expect(container.querySelector(".um-brand__light")).not.toBeNull();
    expect(container.querySelector(".um-brand__dark")).not.toBeNull();
    expect(screen.getAllByRole("img", { name: "UNIMATE.AZ logo" })).toHaveLength(1);
  });
  it("row layout lays the dark lockup out horizontally", () => {
    const { container } = render(<BrandLogo label="x" variant="dark" layout="row" height={32} />);
    expect(container.firstElementChild).toHaveClass("um-brand--row");
    expect(container.querySelector("img")).toHaveAttribute("height", "32");
  });
  it("every image has width and height (no layout shift)", () => {
    const { container } = render(<BrandLogo label="x" />);
    for (const i of container.querySelectorAll("img")) {
      expect(i.getAttribute("width")).toMatch(/^\d+$/);
      expect(i.getAttribute("height")).toMatch(/^\d+$/);
    }
  });
});

describe("BrandMark", () => {
  it("light = mark.png, dark = mark-tile.png", () => {
    expect(srcs(render(<BrandMark label="m" variant="light" />).container)).toEqual(["/brand/mark.png"]);
    cleanup();
    expect(srcs(render(<BrandMark label="m" variant="dark" />).container)).toEqual(["/brand/mark-tile.png"]);
  });
  it("keeps the intrinsic aspect ratio", () => {
    const { container } = render(<BrandMark label="m" variant="light" height={38} />);
    expect(container.querySelector("img")).toHaveAttribute("width", "32"); // 320/380 * 38
  });
});

describe("brand assets", () => {
  it("exist in the web and admin public folders", () => {
    for (const app of ["web", "admin"]) {
      for (const a of Object.values(BRAND_ASSETS)) {
        expect(existsSync(join(process.cwd(), `apps/${app}/public/brand/${a.src}`)), `${app}/${a.src}`).toBe(true);
      }
    }
  });
});

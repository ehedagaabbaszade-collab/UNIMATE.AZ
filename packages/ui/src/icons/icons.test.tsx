// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileIcon, Icon, LanguageChip, ModuleIcon, StatusIcon } from "./Icon";
import { FILE_TYPES, ICON_GROUPS, ICON_NAMES, ICON_PATHS, ICON_STROKE, MODULE_TILES } from "./paths";

afterEach(() => cleanup());

// Hard-coded on purpose: this is the list from PROGRESS.md 3c(c) / the brand board, not derived from the registry.
const EXPECTED: Record<string, string[]> = {
  modules: ["ai-study", "campus", "notes", "planner", "career", "gamification", "profile", "settings"],
  aiStudy: ["upload", "summary", "quiz", "flashcard", "exam-simulation", "study-plan", "ai-chat"],
  campus: ["post", "group", "event", "announcement", "reaction", "comment", "report"],
  notes: ["materials", "search", "saved", "rating", "download", "quiz", "flashcard"],
  planner: ["calendar", "timetable", "tasks", "exams", "reminder", "pomodoro", "gpa"],
  career: ["jobs", "internship", "scholarship", "cv", "interview-prep", "development"],
  gamification: ["xp", "streak", "achievements", "challenges", "leaderboard", "rewards"],
  system: ["home", "notifications", "search", "add", "more"],
  files: ["file-pdf", "file-docx", "file-pptx", "file-xlsx", "file-image", "file-video", "file-audio", "file-zip"],
  statuses: ["success", "info", "warning", "error", "pending", "locked"],
};

describe("icon registry", () => {
  it.each(Object.entries(EXPECTED))("contains every %s icon", (_group, names) => {
    for (const n of names) expect(ICON_NAMES, n).toContain(n);
  });
  it("groups the module list exactly", () => {
    expect([...ICON_GROUPS.module]).toEqual(EXPECTED.modules);
    expect(Object.keys(MODULE_TILES)).toEqual(EXPECTED.modules);
  });
  it("has path data for every name, on the 24px grid, with no empty paths", () => {
    for (const name of ICON_NAMES) {
      const d = ICON_PATHS[name];
      expect(d.viewBox, name).toBe("0 0 24 24");
      expect(d.paths.length, name).toBeGreaterThan(0);
      for (const p of d.paths) expect(p, name).toMatch(/^M[-\d. ]/);
    }
  });
  it("keeps every path start inside the 24 grid", () => {
    for (const name of ICON_NAMES) {
      for (const p of ICON_PATHS[name].paths) {
        const m = /^M(-?[\d.]+)[ ,](-?[\d.]+)/.exec(p)!;
        expect(Number(m[1]), name).toBeGreaterThanOrEqual(0);
        expect(Number(m[1]), name).toBeLessThanOrEqual(24);
        expect(Number(m[2]), name).toBeGreaterThanOrEqual(0);
        expect(Number(m[2]), name).toBeLessThanOrEqual(24);
      }
    }
  });
  it("paths.ts is framework-neutral (no React/DOM/CSS variables) so React Native can import it", () => {
    const src = readFileSync(join(process.cwd(), "packages/ui/src/icons/paths.ts"), "utf8");
    expect(src).not.toMatch(/from "react|document\.|window\.|var\(--/);
  });
  it("has a file icon for every file type", () => {
    for (const k of Object.keys(FILE_TYPES)) expect(ICON_NAMES).toContain(`file-${k}`);
  });
});

describe("Icon", () => {
  it("renders a decorative currentColor svg with the shared stroke, caps and joins", () => {
    const { container } = render(<Icon name="home" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(svg).toHaveAttribute("stroke-width", String(ICON_STROKE));
    expect(svg).toHaveAttribute("stroke-linecap", "round");
    expect(svg).toHaveAttribute("stroke-linejoin", "round");
    expect(svg.querySelectorAll("path")).toHaveLength(ICON_PATHS.home.paths.length);
  });
  it("is announced only when a label is given", () => {
    render(<Icon name="warning" label="Warning" />);
    expect(screen.getByRole("img", { name: "Warning" })).toBeInTheDocument();
  });
  it("accepts size tokens", () => {
    const { container } = render(<Icon name="add" size="xl" />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "48");
  });
  it("renders every registered name", () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelector("svg path")).not.toBeNull();
      unmount();
    }
  });
});

describe("composites", () => {
  it("ModuleIcon draws the module glyph on a gradient tile", () => {
    const { container } = render(<ModuleIcon module="career" size={56} label="Career" />);
    const tile = screen.getByRole("img", { name: "Career" });
    expect(tile).toHaveClass("um-tile");
    expect(tile.style.background).toContain("linear-gradient");
    expect(container.querySelector("svg")).toHaveAttribute("width", "31");
  });
  it("FileIcon shows a label for document types and a glyph for media", () => {
    const { rerender, container } = render(<FileIcon kind="pdf" />);
    expect(container).toHaveTextContent("PDF");
    rerender(<FileIcon kind="video" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
  it("StatusIcon uses the semantic token colour", () => {
    const { container } = render(<StatusIcon status="error" />);
    expect((container.querySelector("svg") as SVGElement).style.color).toBe("var(--danger)");
  });
  it("LanguageChip upper-cases the code", () => {
    render(<LanguageChip code="az" label="Azərbaycan" />);
    expect(screen.getByLabelText("Azərbaycan")).toHaveTextContent("AZ");
  });
});

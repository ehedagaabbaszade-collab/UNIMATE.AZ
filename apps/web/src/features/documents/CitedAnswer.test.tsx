// @vitest-environment jsdom
import "@/test/dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/provider";
import { CitedAnswer } from "./CitedAnswer";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const FAKE = "99999999-9999-4999-8999-999999999999";

const renderIt = (answer: string, citations: Array<{ chunk_id: string; page_start: number | null; page_end: number | null }>, onSelect = vi.fn()) =>
  render(
    <I18nProvider locale="en">
      <CitedAnswer answer={answer} citations={citations} onSelect={onSelect} />
    </I18nProvider>,
  );

describe("CitedAnswer", () => {
  it("renders chips with page numbers from structured citations and reports clicks", () => {
    const onSelect = vi.fn();
    renderIt(`Cells divide [${A}].`, [{ chunk_id: A, page_start: 4, page_end: 4 }, { chunk_id: B, page_start: 7, page_end: 9 }], onSelect);
    expect(screen.getByRole("button", { name: /p\. 4$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /p\. 7–9$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /p\. 7–9$/ }));
    expect(onSelect).toHaveBeenCalledWith(B);
  });

  it("never renders a chip or the raw id for a marker that is not in the validated citations", () => {
    const { container } = renderIt(`Fabricated [${FAKE}] claim.`, []);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.textContent).not.toContain(FAKE);
    expect(screen.getByText(/not source-grounded/i)).toBeInTheDocument();
  });

  it("renders answer text as text, not HTML", () => {
    const { container } = renderIt('<img src=x onerror="alert(1)"> hello', []);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img");
  });
});

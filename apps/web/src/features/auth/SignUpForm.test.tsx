// @vitest-environment jsdom
import "@/test/dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { catalogs } from "@unimate/i18n";
import { I18nProvider } from "@unimate/i18n/react";

const signUp = vi.fn();
const replace = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({ getBrowserClient: () => ({ auth: { signUp } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("../academic/AcademicPicker", () => ({ AcademicPicker: () => null }));
vi.mock("./RoleSwitch", () => ({ RoleSwitch: () => null }));

import { SignUpForm } from "./SignUpForm";

const setup = () =>
  render(
    <I18nProvider locale="en" messages={catalogs.en}>
      <SignUpForm as="student" />
    </I18nProvider>,
  );
const submitBtn = () => screen.getByRole("button", { name: "Create account" });
const box = (re: RegExp) => screen.getByRole("checkbox", { name: re });
const fillAll = (birth: string) => {
  fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Ada" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-password" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "secret-password" } });
  fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value: birth } });
};
const tickRequired = () => [/Terms of Service/, /Privacy Policy/, /AI Disclaimer/].forEach((re) => fireEvent.click(box(re)));

describe("SignUpForm legal fields", () => {
  beforeEach(() => {
    signUp.mockReset();
    replace.mockReset();
  });

  it("starts disabled with nothing pre-checked", () => {
    setup();
    expect(submitBtn()).toBeDisabled();
    for (const c of screen.getAllByRole("checkbox")) expect(c).not.toBeChecked();
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
  });

  it("shows the underage message and keeps the button disabled", () => {
    setup();
    fillAll("2999-01-01");
    expect(screen.getByText("The date of birth cannot be in the future.")).toBeInTheDocument();
    const y = new Date().getFullYear() - 10;
    fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value: `${y}-01-01` } });
    tickRequired();
    expect(screen.getByText("You must be at least 16 years old to use UNIMATE.AZ.")).toBeInTheDocument();
    expect(submitBtn()).toBeDisabled();
  });

  it("stays disabled until all three required boxes are ticked", () => {
    setup();
    fillAll("2000-01-01");
    fireEvent.click(box(/Terms of Service/));
    fireEvent.click(box(/Privacy Policy/));
    expect(submitBtn()).toBeDisabled();
    fireEvent.click(box(/AI Disclaimer/));
    expect(submitBtn()).toBeEnabled();
  });

  it("sends birth_date, consents and platform (marketing only when ticked)", async () => {
    signUp.mockResolvedValue({ data: { session: null }, error: null });
    setup();
    fillAll("2000-01-01");
    tickRequired();
    fireEvent.click(box(/news, campaigns/));
    fireEvent.click(submitBtn());
    await waitFor(() => expect(signUp).toHaveBeenCalled());
    expect(signUp.mock.calls[0]![0].options.data).toMatchObject({ birth_date: "2000-01-01", consents: ["terms", "privacy_notice", "ai_disclaimer", "marketing"], platform: "web", display_name: "Ada" });
  });

  it("maps a server UNDERAGE error to the localized message", async () => {
    signUp.mockResolvedValue({ data: {}, error: { message: "UNDERAGE" } });
    setup();
    fillAll("2000-01-01");
    tickRequired();
    fireEvent.click(submitBtn());
    expect(await screen.findByRole("alert")).toHaveTextContent("at least 16");
  });
});

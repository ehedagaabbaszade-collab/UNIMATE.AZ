// @vitest-environment jsdom
import "@/test/dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@unimate/i18n/react";

const signIn = vi.fn();
const replace = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({ getBrowserClient: () => ({ auth: { signInWithPassword: signIn } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

import { SignInForm } from "./SignInForm";

const setup = (props: { next?: string } = {}) =>
  render(
    <I18nProvider locale="en">
      <SignInForm {...props} />
    </I18nProvider>,
  );
const fill = (email: string, password: string) => {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
};

describe("SignInForm", () => {
  beforeEach(() => {
    signIn.mockReset();
    replace.mockReset();
  });

  it("shows zod validation errors and does not call Supabase", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(signIn).not.toHaveBeenCalled();
  });

  it("signs in and redirects to a safe next path", async () => {
    signIn.mockResolvedValue({ error: null });
    setup({ next: "/documents" });
    fill("a@b.co", "secret-password");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/documents"));
    expect(signIn).toHaveBeenCalledWith({ email: "a@b.co", password: "secret-password" });
  });

  it("ignores an external next target", async () => {
    signIn.mockResolvedValue({ error: null });
    setup({ next: "https://evil.example" });
    fill("a@b.co", "secret-password");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("maps invalid credentials to a friendly message without echoing server text", async () => {
    signIn.mockResolvedValue({ error: { message: "Invalid login credentials", status: 400, code: "invalid_credentials" } });
    setup();
    fill("a@b.co", "wrong-password");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
    expect(replace).not.toHaveBeenCalled();
  });
});

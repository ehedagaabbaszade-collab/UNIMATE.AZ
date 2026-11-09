// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Avatar, Badge, Button, EmptyState, ErrorState, Input, OfflineBanner, ProgressRing, Tabs, initialsOf, useOnlineStatus } from "./index";

afterEach(() => cleanup());

describe("OfflineBanner", () => {
  it("renders nothing when online", () => {
    const { container } = render(<OfflineBanner online message="You are offline" />);
    expect(container).toBeEmptyDOMElement();
  });
  it("is a polite live status region when offline", () => {
    render(<OfflineBanner online={false} message="You are offline" />);
    const el = screen.getByRole("status");
    expect(el).toHaveTextContent("You are offline");
    expect(el).toHaveAttribute("aria-live", "polite");
  });
  it("useOnlineStatus follows window online/offline events", () => {
    function Probe() {
      return <OfflineBanner online={useOnlineStatus()} message="offline!" />;
    }
    render(<Probe />);
    expect(screen.queryByText("offline!")).toBeNull();
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    act(() => void window.dispatchEvent(new Event("offline")));
    expect(screen.getByText("offline!")).toBeInTheDocument();
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    act(() => void window.dispatchEvent(new Event("online")));
    expect(screen.queryByText("offline!")).toBeNull();
  });
});

describe("Input", () => {
  it("links label, hint and error for assistive tech", () => {
    render(<Input label="Email" hint="We never share it" error="Required" />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby")!.split(" ");
    expect(describedBy).toHaveLength(2);
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
  });
});

describe("Button", () => {
  it("is disabled and busy while loading", () => {
    render(<Button loading>Save</Button>);
    const b = screen.getByRole("button", { name: "Save" });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("aria-busy", "true");
  });
});

describe("Tabs", () => {
  const items = [
    { id: "a", label: "A", content: <p>panel a</p> },
    { id: "b", label: "B", content: <p>panel b</p> },
    { id: "c", label: "C", content: <p>panel c</p> },
  ];
  it("supports roving tabindex and arrow-key navigation", () => {
    render(<Tabs items={items} label="Sections" />);
    const [a, b] = screen.getAllByRole("tab");
    expect(a).toHaveAttribute("aria-selected", "true");
    expect(a).toHaveAttribute("tabindex", "0");
    expect(b).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(a!, { key: "ArrowRight" });
    expect(b).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("panel b");
    fireEvent.keyDown(b!, { key: "End" });
    expect(screen.getByRole("tabpanel")).toHaveTextContent("panel c");
    fireEvent.keyDown(screen.getAllByRole("tab")[2]!, { key: "ArrowRight" });
    expect(screen.getByRole("tabpanel")).toHaveTextContent("panel a");
  });
});

describe("ProgressRing", () => {
  it("exposes progressbar semantics and clamps the value", () => {
    render(<ProgressRing value={15} max={10} label="3 of 10">x</ProgressRing>);
    const bar = screen.getByRole("progressbar", { name: "3 of 10" });
    expect(bar).toHaveAttribute("aria-valuenow", "10");
    expect(bar).toHaveAttribute("aria-valuemax", "10");
  });
});

describe("states, badge, avatar", () => {
  it("ErrorState is an alert, EmptyState is not", () => {
    render(
      <>
        <ErrorState title="Broken" />
        <EmptyState title="Nothing" />
      </>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Broken");
    expect(screen.getByText("Nothing")).toBeInTheDocument();
    render(<Badge tone="success">ok</Badge>);
    expect(screen.getByText("ok")).toHaveClass("um-badge--success");
  });
  it("derives initials safely", () => {
    expect(initialsOf("Aysel Məmmədova")).toBe("AM");
    expect(initialsOf("  ")).toBe("?");
    expect(initialsOf(null)).toBe("?");
    render(<Avatar name="Elvin Quliyev" />);
    expect(screen.getByRole("img", { name: "Elvin Quliyev" })).toHaveTextContent("EQ");
  });
});

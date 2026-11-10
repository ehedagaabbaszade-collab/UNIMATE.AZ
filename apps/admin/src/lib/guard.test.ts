import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ROLES, NAV, atLeast, canAccess, canChangeRoles, decide, isStaff, minRoleFor, navFor, safeNext, toRole } from "./guard";

describe("roles", () => {
  it("only moderator, admin and super_admin are staff", () => {
    expect(APP_ROLES.filter((r) => isStaff(r))).toEqual(["moderator", "admin", "super_admin"]);
    expect(isStaff(null)).toBe(false);
    expect(isStaff(undefined)).toBe(false);
  });
  it("toRole rejects anything that is not a known role", () => {
    expect(toRole("admin")).toBe("admin");
    expect(toRole("root")).toBeNull();
    expect(toRole(undefined)).toBeNull();
    expect(toRole({})).toBeNull();
  });
  it("only super_admin may change roles", () => {
    expect(APP_ROLES.filter((r) => canChangeRoles(r))).toEqual(["super_admin"]);
    expect(atLeast("admin", "moderator")).toBe(true);
    expect(atLeast("moderator", "admin")).toBe(false);
  });
});

describe("route access (role -> allowed routes)", () => {
  const table: Record<string, string[]> = {
    student: [],
    moderator: ["/", "/moderation"],
    admin: ["/", "/moderation", "/users", "/academic", "/career", "/subscriptions", "/prompts"],
    super_admin: ["/", "/moderation", "/users", "/academic", "/career", "/subscriptions", "/prompts"],
  };
  const all = ["/", "/moderation", "/users", "/users/abc", "/academic", "/career", "/subscriptions", "/prompts"];
  for (const [role, allowed] of Object.entries(table)) {
    it(`${role}: exactly ${allowed.join(" ") || "nothing"}`, () => {
      const base = (p: string) => (p.startsWith("/users/") ? "/users" : p);
      expect(all.filter((p) => canAccess(toRole(role), p)).map(base).filter((p, i, a) => a.indexOf(p) === i).sort()).toEqual([...allowed].sort());
    });
  }
  it("moderators see moderation only (plus the overview)", () => {
    expect(navFor("moderator").map((n) => n.href)).toEqual(["/", "/moderation"]);
  });
  it("admins see everything; the nav order is stable", () => {
    expect(navFor("admin").map((n) => n.href)).toEqual(NAV.map((n) => n.href));
  });
  it("students and anonymous users get no navigation", () => {
    expect(navFor("student")).toEqual([]);
    expect(navFor(null)).toEqual([]);
  });
  it("unknown paths are deny-by-default (admin minimum), nested paths inherit", () => {
    expect(minRoleFor("/something-new")).toBe("admin");
    expect(canAccess("moderator", "/something-new")).toBe(false);
    expect(minRoleFor("/users/123")).toBe("admin");
    expect(canAccess("moderator", "/users/123")).toBe(false);
    expect(canAccess("moderator", "/moderation/anything")).toBe(true);
    // prefix lookalikes do not match
    expect(minRoleFor("/usersX")).toBe("admin");
    expect(minRoleFor("/moderationX")).toBe("admin");
  });
});

describe("decide (request guard)", () => {
  it("anonymous -> sign-in, student -> denied, staff -> allow/denied by route", () => {
    expect(decide(false, null, "/users")).toEqual({ kind: "sign-in" });
    expect(decide(false, null, "/")).toEqual({ kind: "sign-in" });
    expect(decide(true, "student", "/")).toEqual({ kind: "denied" });
    expect(decide(true, null, "/")).toEqual({ kind: "denied" });
    expect(decide(true, "moderator", "/users")).toEqual({ kind: "denied" });
    expect(decide(true, "moderator", "/moderation")).toEqual({ kind: "allow" });
    expect(decide(true, "admin", "/prompts")).toEqual({ kind: "allow" });
  });
  it("sign-in and access-denied are public and never loop", () => {
    expect(decide(false, null, "/sign-in")).toEqual({ kind: "allow" });
    expect(decide(true, "student", "/access-denied")).toEqual({ kind: "allow" });
  });
});

describe("safeNext (open redirect)", () => {
  it("accepts same-origin paths only", () => {
    expect(safeNext("/users")).toBe("/users");
    expect(safeNext("//evil.test")).toBe("/");
    expect(safeNext("/\\evil.test")).toBe("/");
    expect(safeNext("https://evil.test")).toBe("/");
    expect(safeNext("/a\nb")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});

/** Every console page must call requireRoute with its own path; otherwise a role could slip past the per-page gate. */
describe("every console page is guarded with its own route", () => {
  const root = path.resolve(__dirname, "../app/(console)");
  const pages: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const f = path.join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else if (n === "page.tsx") pages.push(f);
    }
  };
  walk(root);
  it("finds the console pages", () => expect(pages.length).toBe(18));
  for (const f of pages) {
    const rel = path.relative(root, path.dirname(f)).replaceAll("\\", "/");
    const route = rel === "" ? "/" : `/${rel.replace(/\/\[.*$/, "")}`;
    it(`${rel || "(root)"} -> requireRoute("${route}")`, () => {
      expect(readFileSync(f, "utf8")).toContain(`requireRoute("${route}")`);
    });
  }
  it("the proxy and the layout use the shared guard", () => {
    const proxy = readFileSync(path.resolve(__dirname, "../proxy.ts"), "utf8");
    expect(proxy).toContain("decide(");
    expect(proxy).toContain('from("profiles")');
    const layout = readFileSync(path.join(root, "layout.tsx"), "utf8");
    expect(layout).toContain("getStaffSession");
    expect(layout).toContain('redirect("/access-denied")');
  });
});

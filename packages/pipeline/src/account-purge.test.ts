import { describe, expect, it } from "vitest";
import { DEFAULT_PURGE_CAPS, PurgeCapError, listUserObjects, purgeDueAccounts, type PurgeDeps, type PurgeStorage, type PurgeStorageEntry } from "./account-purge";

const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";
const U3 = "00000000-0000-4000-8000-000000000003";

/** In-memory storage: a flat set of object paths; list() derives files/folders (id null) for one prefix like Supabase. */
class FakeStorage implements PurgeStorage {
  readonly removed: string[] = [];
  calls = 0;
  failRemove = false;
  constructor(public objects: Set<string>) {}
  async list(prefix: string, opts: { limit: number; offset: number }) {
    this.calls++;
    const seen = new Map<string, PurgeStorageEntry>();
    for (const p of [...this.objects].sort()) {
      if (!p.startsWith(`${prefix}/`)) continue;
      const rest = p.slice(prefix.length + 1);
      const slash = rest.indexOf("/");
      if (slash === -1) seen.set(rest, { name: rest, id: `id-${p}` });
      else if (!seen.has(rest.slice(0, slash))) seen.set(rest.slice(0, slash), { name: rest.slice(0, slash), id: null });
    }
    return { data: [...seen.values()].slice(opts.offset, opts.offset + opts.limit), error: null };
  }
  async remove(paths: string[]) {
    if (this.failRemove) return { error: new Error("boom") };
    for (const p of paths) {
      this.objects.delete(p);
      this.removed.push(p);
    }
    return { error: null };
  }
}

const mk = (storage: PurgeStorage, over: Partial<PurgeDeps> = {}) => {
  const events: string[] = [];
  const deps: PurgeDeps = {
    storage,
    dueUsers: async () => [U1],
    claim: async (u) => (events.push(`claim:${u}`), true),
    recordFailure: async (u, r) => void events.push(`fail:${u}:${r}`),
    recordPurged: async (u) => void events.push(`purged:${u}`),
    deleteUser: async (u) => void events.push(`delete:${u}`),
    ...over,
  };
  return { deps, events };
};

describe("listUserObjects", () => {
  it("lists nested folders (id null) recursively and paginates", async () => {
    const paths = [`${U1}/a.pdf`, `${U1}/f1/b.pdf`, `${U1}/f1/f2/c.pdf`, `${U1}/f1/f2/f3/d.pdf`, ...Array.from({ length: 5 }, (_, i) => `${U1}/many/${i}.txt`)];
    const s = new FakeStorage(new Set(paths));
    const got = await listUserObjects(s, U1, { pageSize: 2, maxListCalls: 100, maxObjects: 100 });
    expect([...got].sort()).toEqual([...paths].sort());
    expect(s.calls).toBeGreaterThan(5);
  });
  it("never lists the bucket root for an invalid id", async () => {
    const s = new FakeStorage(new Set(["x/y"]));
    await expect(listUserObjects(s, "", DEFAULT_PURGE_CAPS)).rejects.toThrow(/invalid user id/);
    expect(s.calls).toBe(0);
  });
  it("throws PurgeCapError when objects or list calls exceed the caps", async () => {
    const objs = new Set(Array.from({ length: 10 }, (_, i) => `${U1}/${i}`));
    await expect(listUserObjects(new FakeStorage(objs), U1, { pageSize: 100, maxListCalls: 10, maxObjects: 5 })).rejects.toBeInstanceOf(PurgeCapError);
    const deep = new Set([`${U1}/a/b/c/d/e/f.txt`]);
    await expect(listUserObjects(new FakeStorage(deep), U1, { pageSize: 100, maxListCalls: 3, maxObjects: 100 })).rejects.toBeInstanceOf(PurgeCapError);
  });
  it("terminates on a listing that never shrinks (cap, not an endless loop)", async () => {
    const endless: PurgeStorage = {
      list: async (_p, o) => ({ data: Array.from({ length: o.limit }, (_, i) => ({ name: `${o.offset + i}`, id: "x" })), error: null }),
      remove: async () => ({ error: null }),
    };
    await expect(listUserObjects(endless, U1, { pageSize: 10, maxListCalls: 50, maxObjects: 1_000_000 })).rejects.toBeInstanceOf(PurgeCapError);
  });
});

describe("purgeDueAccounts", () => {
  it("happy path: claim, remove nested files, deleteUser, then the account.purged audit", async () => {
    const s = new FakeStorage(new Set([`${U1}/a`, `${U1}/dir/b`]));
    const { deps, events } = mk(s);
    expect(await purgeDueAccounts(deps)).toEqual({ purged: 1, failed: 0, skipped: 0 });
    expect(s.removed.sort()).toEqual([`${U1}/a`, `${U1}/dir/b`]);
    expect(events).toEqual([`claim:${U1}`, `delete:${U1}`, `purged:${U1}`]);
  });

  it("a refused claim (cancelled / not pending) never touches storage or deleteUser", async () => {
    const s = new FakeStorage(new Set([`${U1}/a`]));
    const { deps, events } = mk(s, { claim: async () => false });
    expect(await purgeDueAccounts(deps)).toEqual({ purged: 0, failed: 0, skipped: 1 });
    expect(s.calls).toBe(0);
    expect(s.removed).toEqual([]);
    expect(events).toEqual([]);
  });

  it("a cap hit records the failure and the NEXT user is still purged", async () => {
    const big = Array.from({ length: 6 }, (_, i) => `${U1}/f${i}`);
    const s = new FakeStorage(new Set([...big, `${U2}/ok`]));
    const { deps, events } = mk(s, { dueUsers: async () => [U1, U2] });
    const r = await purgeDueAccounts(deps, { caps: { pageSize: 100, maxListCalls: 50, maxObjects: 5 } });
    expect(r).toEqual({ purged: 1, failed: 1, skipped: 0 });
    expect(events).toEqual([`claim:${U1}`, `fail:${U1}:storage_cap`, `claim:${U2}`, `delete:${U2}`, `purged:${U2}`]);
    expect(s.removed).toEqual([`${U2}/ok`]); // the capped user was not half-purged
  });

  it("storage removal and deleteUser failures are recorded with their step and do not stop the run", async () => {
    const s = new FakeStorage(new Set([`${U1}/a`, `${U2}/a`, `${U3}/a`]));
    const { deps, events } = mk(s, {
      dueUsers: async () => [U1, U2, U3],
      deleteUser: async (u) => {
        if (u === U2) throw new Error("gotrue down");
        events.push(`delete:${u}`);
      },
    });
    s.failRemove = true;
    const r1 = await purgeDueAccounts(deps);
    expect(r1).toEqual({ purged: 0, failed: 3, skipped: 0 });
    expect(events.filter((e) => e.startsWith("fail:")).every((e) => e.endsWith(":storage_remove"))).toBe(true);
    events.length = 0;
    s.failRemove = false;
    const r2 = await purgeDueAccounts(deps);
    expect(r2).toEqual({ purged: 2, failed: 1, skipped: 0 });
    expect(events).toContain(`fail:${U2}:delete_user`);
    expect(events).toContain(`purged:${U3}`);
    expect(events).not.toContain(`purged:${U2}`);
  });

  it("an invalid id from the RPC is counted as failed and never listed; failing recordPurged/recordFailure do not abort", async () => {
    const s = new FakeStorage(new Set([`${U1}/a`]));
    const { deps } = mk(s, {
      dueUsers: async () => ["", U1],
      recordPurged: async () => {
        throw new Error("audit down");
      },
    });
    expect(await purgeDueAccounts(deps)).toEqual({ purged: 1, failed: 1, skipped: 0 });
    const s2 = new FakeStorage(new Set([`${U1}/a`]));
    const m2 = mk(s2, {
      claim: async () => {
        throw new Error("rpc down");
      },
      recordFailure: async () => {
        throw new Error("also down");
      },
    });
    expect(await purgeDueAccounts(m2.deps)).toEqual({ purged: 0, failed: 1, skipped: 0 });
  });
});

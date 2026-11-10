// Orchestration of the scheduled account purge (supabase/functions/purge-accounts is a thin adapter over this).
// Pure and dependency-injected so it is unit-tested without Deno, Storage or GoTrue.
//
// Per due user: claim (atomic pending re-check + cancel lock) -> list storage RECURSIVELY under "<uid>/" (capped) ->
// remove -> GoTrue deleteUser -> audit `account.purged`. Any failure records the attempt (the due list sorts users with
// more attempts last) and moves on: one stuck user can never block later purges.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PurgeStorageEntry {
  name: string;
  /** Supabase Storage returns folders with id = null. */
  id: string | null;
}
export interface PurgeStorage {
  list(prefix: string, opts: { limit: number; offset: number }): Promise<{ data: PurgeStorageEntry[] | null; error: unknown }>;
  remove(paths: string[]): Promise<{ error: unknown }>;
}
export interface PurgeDeps {
  storage: PurgeStorage;
  /** Users whose grace period is over (service_role RPC due_account_deletions). Throws on error. */
  dueUsers(limit: number): Promise<string[]>;
  /** claim_account_purge: true only if the request is still pending and was not claimed by a live worker. */
  claim(uid: string): Promise<boolean>;
  recordFailure(uid: string, reason: string): Promise<void>;
  /** record_account_purged: writes the `account.purged` audit row (after deleteUser succeeded). */
  recordPurged(uid: string): Promise<void>;
  /** GoTrue admin deleteUser. Throws on error. */
  deleteUser(uid: string): Promise<void>;
  log?(message: string): void;
}
export interface PurgeCaps {
  pageSize: number;
  /** Max list() calls per user (bounds folder fan-out and pagination). */
  maxListCalls: number;
  /** Max objects per user. A user above the cap is skipped and recorded, never half-purged. */
  maxObjects: number;
}
export const DEFAULT_PURGE_CAPS: PurgeCaps = { pageSize: 100, maxListCalls: 200, maxObjects: 10_000 };

export class PurgeCapError extends Error {
  constructor() {
    super("storage listing cap exceeded");
    this.name = "PurgeCapError";
  }
}

/** Every object path under `<uid>/` including nested folders. Throws PurgeCapError beyond the caps; other errors propagate. */
export async function listUserObjects(storage: PurgeStorage, uid: string, caps: PurgeCaps = DEFAULT_PURGE_CAPS): Promise<string[]> {
  if (!UUID.test(uid)) throw new Error("invalid user id"); // an empty prefix would list the bucket root
  const files: string[] = [];
  const pending = [uid];
  let calls = 0;
  while (pending.length > 0) {
    const prefix = pending.pop()!;
    for (let offset = 0; ; offset += caps.pageSize) {
      if (++calls > caps.maxListCalls) throw new PurgeCapError();
      const { data, error } = await storage.list(prefix, { limit: caps.pageSize, offset });
      if (error) throw error;
      const entries = data ?? [];
      for (const e of entries) {
        if (e.id === null) pending.push(`${prefix}/${e.name}`);
        else if (files.push(`${prefix}/${e.name}`) > caps.maxObjects) throw new PurgeCapError();
      }
      if (entries.length < caps.pageSize) break;
    }
  }
  return files;
}

export interface PurgeSummary {
  purged: number;
  failed: number;
  /** Not purged and not a failure: the claim was refused (cancelled, not due, or claimed by another worker). */
  skipped: number;
}

export async function purgeDueAccounts(deps: PurgeDeps, o: { limit?: number; caps?: PurgeCaps } = {}): Promise<PurgeSummary> {
  const caps = o.caps ?? DEFAULT_PURGE_CAPS;
  const log = deps.log ?? (() => undefined);
  const out: PurgeSummary = { purged: 0, failed: 0, skipped: 0 };
  for (const uid of await deps.dueUsers(o.limit ?? 25)) {
    if (typeof uid !== "string" || !UUID.test(uid)) {
      out.failed++;
      continue;
    }
    let step = "claim";
    try {
      if (!(await deps.claim(uid))) {
        out.skipped++;
        continue;
      }
      step = "storage_list";
      const files = await listUserObjects(deps.storage, uid, caps);
      step = "storage_remove";
      for (let i = 0; i < files.length; i += caps.pageSize) {
        const { error } = await deps.storage.remove(files.slice(i, i + caps.pageSize));
        if (error) throw error;
      }
      step = "delete_user";
      await deps.deleteUser(uid);
    } catch (e) {
      out.failed++;
      const reason = e instanceof PurgeCapError ? "storage_cap" : step;
      log(`purge failed for one account (${reason})`);
      try {
        await deps.recordFailure(uid, reason);
      } catch {
        log("could not record the purge failure");
      }
      continue;
    }
    out.purged++;
    try {
      await deps.recordPurged(uid);
    } catch {
      log("account purged but the audit row could not be written");
    }
  }
  return out;
}

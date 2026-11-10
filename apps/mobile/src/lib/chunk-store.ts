/**
 * Supabase session JSON is usually larger than the ~2 KB per-value limit of SecureStore, so a value is split across
 * numbered keys. Pure helpers plus an adapter over an injected key/value backend (SecureStore in the app, a Map in tests).
 */
export const CHUNK_SIZE = 1800;

export const splitChunks = (value: string, size = CHUNK_SIZE): string[] => {
  const out: string[] = [];
  for (let i = 0; i < value.length; i += size) out.push(value.slice(i, i + size));
  return out.length ? out : [""];
};

export interface KvBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const countKey = (k: string) => `${k}.n`;
const partKey = (k: string, i: number) => `${k}.${i}`;

export function createChunkedStorage(kv: KvBackend, size = CHUNK_SIZE) {
  const removeAll = async (key: string) => {
    const n = Number((await kv.get(countKey(key))) ?? 0);
    for (let i = 0; i < (Number.isInteger(n) ? n : 0); i++) await kv.remove(partKey(key, i));
    await kv.remove(countKey(key));
  };
  return {
    async getItem(key: string): Promise<string | null> {
      const n = Number(await kv.get(countKey(key)));
      if (!Number.isInteger(n) || n <= 0) return null;
      let out = "";
      for (let i = 0; i < n; i++) {
        const part = await kv.get(partKey(key, i));
        if (part === null) return null; // torn write: behave as signed out rather than hand back a corrupt session
        out += part;
      }
      return out;
    },
    async setItem(key: string, value: string): Promise<void> {
      const parts = splitChunks(value, size);
      await removeAll(key);
      for (let i = 0; i < parts.length; i++) await kv.set(partKey(key, i), parts[i]!);
      await kv.set(countKey(key), String(parts.length));
    },
    removeItem: removeAll,
  };
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";
import { createChunkedStorage } from "./chunk-store";
import { getSupabaseEnv } from "./env";

// Sessions live in the OS keystore (Keychain / Keystore) via SecureStore, split into chunks (value size limit).
// Web (dev inspection only): SecureStore has no web implementation, so fall back to localStorage.
const ls = (globalThis as unknown as { localStorage?: Record<"getItem" | "setItem" | "removeItem", (...a: string[]) => string | null | void> }).localStorage;
const secureStorage =
  process.env.EXPO_OS === "web"
    ? {
        getItem: async (k: string) => (ls ? ls.getItem(k) : null),
        setItem: async (k: string, v: string) => void ls?.setItem(k, v),
        removeItem: async (k: string) => void ls?.removeItem(k),
      }
    : createChunkedStorage({
        get: (k) => SecureStore.getItemAsync(k),
        set: (k, v) => SecureStore.setItemAsync(k, v),
        remove: (k) => SecureStore.deleteItemAsync(k),
      });

let client: SupabaseClient | null | undefined;

/** The single Supabase client, or null when EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY are not set. Only the anon key is ever used. */
export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const env = getSupabaseEnv();
  if (!env) return (client = null);
  client = createClient(env.url, env.anonKey, {
    auth: { storage: secureStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, flowType: "pkce" },
  });
  // Refresh tokens only while the app is in the foreground.
  AppState.addEventListener("change", (s) => {
    if (s === "active") void client?.auth.startAutoRefresh();
    else void client?.auth.stopAutoRefresh();
  });
  return client;
}

export function requireSupabase(): SupabaseClient {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not configured");
  return sb;
}

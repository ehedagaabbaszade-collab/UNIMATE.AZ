const PUBLIC_PREFIX = "/storage/v1/object/public/avatars/";

/** Path inside the `avatars` bucket when `url` is an object of OUR project's public bucket, else null. */
export function avatarPathFromUrl(url: string | null | undefined, supabaseUrl: string | null | undefined): string | null {
  if (!url || !supabaseUrl) return null;
  const prefix = `${supabaseUrl.replace(/\/+$/, "")}${PUBLIC_PREFIX}`;
  if (!url.startsWith(prefix)) return null;
  const path = url.slice(prefix.length).split(/[?#]/)[0] ?? "";
  if (!path || path.includes("..")) return null;
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}

/** Only render avatars served by our own Supabase project (blocks tracking pixels / foreign hosts). */
export const isOwnAvatarUrl = (url: string | null | undefined, supabaseUrl: string | null | undefined): url is string => avatarPathFromUrl(url, supabaseUrl) !== null;

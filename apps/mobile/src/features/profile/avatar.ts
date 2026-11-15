import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { getSupabaseEnv } from "../../lib/env";
import { useSession, useUser } from "../../state/session";
import { avatarPathFromUrl, isOwnAvatarUrl } from "./avatar-url";

/**
 * The one avatar data source (Home header, Profile, Settings): profiles.avatar_url (public 'avatars' bucket, owner-only
 * writes under `<uid>/`). A local preview shows while uploading; any failure restores the previous avatar and throws.
 * shortcut: no offline fallback copy (an offline pick fails with the usual error), add a local cache if that matters.
 */
export function useAvatar(uid: string) {
  const { profile, supabase: sb } = useUser();
  const { refreshProfile } = useSession();
  const [preview, setPreview] = useState<string | null | undefined>(undefined); // undefined = no pending change
  const supabaseUrl = getSupabaseEnv()?.url ?? null;
  const current = profile?.avatar_url ?? null;
  const server = isOwnAvatarUrl(current, supabaseUrl) ? current : null;
  const uri = preview === undefined ? server : preview;

  const deleteOld = async (oldUrl: string | null) => {
    const old = avatarPathFromUrl(oldUrl, supabaseUrl);
    if (old) await sb.storage.from("avatars").remove([old]).catch(() => undefined); // orphan object is harmless
  };
  async function setUrl(url: string | null) {
    const { error } = await sb.from("profiles").update({ avatar_url: url }).eq("id", uid).select("id").single(); // 0 rows = error
    if (error) throw new Error(error.message);
  }

  /** Opens the library with a square crop. Resolves false when cancelled; throws on permission/IO/upload errors. */
  async function pick(): Promise<boolean> {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (res.canceled || !res.assets[0]) return false;
    const local = res.assets[0].uri;
    setPreview(local);
    const path = `${uid}/${Crypto.randomUUID()}.jpg`;
    let uploaded = false;
    try {
      const bytes = await new File(local).arrayBuffer();
      const up = await sb.storage.from("avatars").upload(path, bytes, { contentType: "image/jpeg", upsert: false });
      if (up.error) throw new Error(up.error.message);
      uploaded = true;
      await setUrl(sb.storage.from("avatars").getPublicUrl(path).data.publicUrl);
      await deleteOld(current);
      await refreshProfile();
      return true;
    } catch (e) {
      if (uploaded) await sb.storage.from("avatars").remove([path]).catch(() => undefined);
      throw e;
    } finally {
      setPreview(undefined);
    }
  }
  async function remove() {
    setPreview(null);
    try {
      await setUrl(null);
      await deleteOld(current);
      await refreshProfile();
    } finally {
      setPreview(undefined);
    }
  }
  return { uri, pick, remove };
}

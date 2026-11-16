import { describe, expect, it } from "vitest";
import { avatarPathFromUrl, isOwnAvatarUrl } from "./avatar-url";

const base = "https://abc.supabase.co";
const ok = `${base}/storage/v1/object/public/avatars/u1/x.jpg`;

describe("avatar url allow-check", () => {
  it("accepts our own public avatars and derives the path", () => {
    expect(isOwnAvatarUrl(ok, base)).toBe(true);
    expect(isOwnAvatarUrl(ok, `${base}/`)).toBe(true);
    expect(avatarPathFromUrl(`${ok}?t=1`, base)).toBe("u1/x.jpg");
  });
  it("rejects foreign hosts, other buckets, traversal and empties", () => {
    expect(isOwnAvatarUrl("https://evil.example/pixel.gif", base)).toBe(false);
    expect(isOwnAvatarUrl(`${base}.evil.example/storage/v1/object/public/avatars/u1/x.jpg`, base)).toBe(false);
    expect(isOwnAvatarUrl(`${base}/storage/v1/object/public/documents/u1/x.jpg`, base)).toBe(false);
    expect(avatarPathFromUrl(`${base}/storage/v1/object/public/avatars/../x`, base)).toBeNull();
    expect(isOwnAvatarUrl(null, base)).toBe(false);
    expect(isOwnAvatarUrl(ok, null)).toBe(false);
  });
});

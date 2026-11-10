import { describe, expect, it } from "vitest";
import { buildCommentTree, campusErrorKey, campusTextProblem, canReplyTo, isInviteCode, linkify, nextPostCursor, normalizeInviteCode, notificationHref, type CommentRow } from "./campus";

const row = (id: string, parent: string | null, depth = 0): CommentRow => ({ id, post_id: "p", parent_id: parent, depth, author_id: "a", author_name: null, author_username: null, is_mine: false, body: id, language: null, created_at: id, edited_at: null, is_deleted: false, like_count: 0, helpful_count: 0, my_liked: false, my_helpful: false, is_accepted: false });
const UUID = "123e4567-e89b-42d3-a456-426614174000";

describe("campus rules", () => {
  it("threads comments and promotes orphans to roots", () => {
    const tree = buildCommentTree([row("a", null), row("b", "a", 1), row("c", "b", 2), row("d", "gone", 1)]);
    expect(tree.map((n) => n.id)).toEqual(["a", "d"]);
    expect(tree[0]!.children[0]!.children[0]!.id).toBe("c");
  });
  it("caps reply depth like the server", () => {
    expect([0, 1, 2, 3].map(canReplyTo)).toEqual([true, true, true, false]);
  });
  it("mirrors the server text rules and keeps math/https readable", () => {
    expect(campusTextProblem("x<y and y>3, see https://example.org/a")).toBeNull();
    expect(campusTextProblem("<script>alert(1)</script>")).toBe("html");
    expect(campusTextProblem("<img src=x>")).toBe("html");
    expect(campusTextProblem("go to http://x.example")).toBe("link");
    expect(campusTextProblem("javascript:alert(1)")).toBe("link");
    expect(campusTextProblem("bad\u0001char")).toBe("control");
  });
  it("linkify only links https and trims trailing punctuation", () => {
    expect(linkify("see https://example.org/a, ok")).toEqual([{ text: "see " }, { text: "https://example.org/a", href: "https://example.org/a" }, { text: ", ok" }]);
    expect(linkify("plain text")).toEqual([{ text: "plain text" }]);
  });
  it("maps server errors to translation keys", () => {
    expect(campusErrorKey("rate limit exceeded for post")).toBe("rateLimited");
    expect(campusErrorKey("duplicate content")).toBe("duplicate");
    expect(campusErrorKey("invalid title (HTML, non-https links and control characters are not allowed)")).toBe("invalidText");
    expect(campusErrorKey("event is full")).toBe("full");
    expect(campusErrorKey("you are banned from this community")).toBe("banned");
    expect(campusErrorKey("must be an active member of the community")).toBe("notAllowed");
    expect(campusErrorKey("invalid invite code")).toBe("notFound");
    expect(campusErrorKey(undefined)).toBe("generic");
  });
  it("derives notification deep links from params only when they look like ids", () => {
    expect(notificationHref({ kind: "campus", params: { post_id: UUID } })).toBe(`/campus/post/${UUID}`);
    expect(notificationHref({ kind: "campus", params: { event_id: UUID, post_id: UUID } })).toBe(`/campus/event/${UUID}`);
    expect(notificationHref({ kind: "campus", params: { community_id: UUID, user_id: UUID } })).toBe(`/campus/community/${UUID}`);
    expect(notificationHref({ kind: "campus", params: { user_id: UUID } })).toBe(`/campus/user/${UUID}`);
    expect(notificationHref({ kind: "campus", params: { post_id: "../../x" } })).toBeNull();
    expect(notificationHref({ kind: "achievement", params: { post_id: UUID } })).toBeNull();
  });
  it("paginates by cursor and normalises invite codes", () => {
    expect(nextPostCursor([{ id: "1", created_at: "t1" }], 2)).toBeNull();
    expect(nextPostCursor([{ id: "1", created_at: "t1" }, { id: "2", created_at: "t2" }], 2)).toEqual({ ts: "t2", id: "2" });
    expect(normalizeInviteCode(" ab12 cd34 ef ")).toBe("AB12CD34EF");
    expect(isInviteCode("ab12cd34ef")).toBe(true);
    expect(isInviteCode("short")).toBe(false);
  });
});

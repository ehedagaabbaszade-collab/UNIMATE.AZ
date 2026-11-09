import { ProviderNotConfiguredError } from "@unimate/core";
import { describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "./providers/anthropic";
import { createProviderFromEnv, modelsFromEnv, NotConfiguredProvider } from "./providers/env";
import { ProviderHttpError } from "./providers/http";
import { OpenAiCompatProvider } from "./providers/openai";

// NOTE: every test here uses a MOCKED fetch. No adapter was ever run against a live API.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const mockFetch = (res: Response | (() => Response | Promise<Response>)) =>
  vi.fn(async (_u: string, _i: RequestInit) => (typeof res === "function" ? res() : res.clone()));
const body = (f: ReturnType<typeof mockFetch>, n = 0) => JSON.parse(f.mock.calls[n]![1].body as string);
const headers = (f: ReturnType<typeof mockFetch>) => f.mock.calls[0]![1].headers as Record<string, string>;

describe("OpenAiCompatProvider (mocked fetch)", () => {
  it("shapes the chat request and parses the reply + usage", async () => {
    const f = mockFetch(json({ model: "gpt-x-2026", choices: [{ message: { content: "Salam ə" } }], usage: { prompt_tokens: 11, completion_tokens: 3 } }));
    const p = new OpenAiCompatProvider({ apiKey: "sk-test-123456789", baseUrl: "https://api.groq.com/openai/v1/", fetch: f });
    const r = await p.generate({ task: "chat", model: "llama-x", system: "SYS", prompt: "Q", maxOutputTokens: 99 });
    expect(r).toEqual({ text: "Salam ə", model: "gpt-x-2026", usage: { inputTokens: 11, outputTokens: 3 } });
    expect(f.mock.calls[0]![0]).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(headers(f).authorization).toBe("Bearer sk-test-123456789");
    expect(body(f)).toEqual({ model: "llama-x", messages: [{ role: "system", content: "SYS" }, { role: "user", content: "Q" }], max_tokens: 99 });
  });

  it("omits system and max_tokens when not given", async () => {
    const f = mockFetch(json({ choices: [{ message: { content: "ok" } }] }));
    await new OpenAiCompatProvider({ apiKey: "k", fetch: f }).generate({ task: "chat", model: "m", prompt: "Q" });
    expect(f.mock.calls[0]![0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(body(f)).toEqual({ model: "m", messages: [{ role: "user", content: "Q" }] });
  });

  it("embeddings: orders by index, forwards dimensions, reports usage", async () => {
    const f = mockFetch(json({ data: [{ index: 1, embedding: [2] }, { index: 0, embedding: [1] }], usage: { prompt_tokens: 7, total_tokens: 7 } }));
    const p = new OpenAiCompatProvider({ apiKey: "k", fetch: f, embedDimensions: 1536 });
    const r = await p.embed({ model: "emb", inputs: ["a", "b"] });
    expect(r.vectors).toEqual([[1], [2]]);
    expect(r.usage).toEqual({ inputTokens: 7, outputTokens: 0 });
    expect(body(f)).toEqual({ model: "emb", input: ["a", "b"], dimensions: 1536 });
    expect(f.mock.calls[0]![0]).toMatch(/\/embeddings$/);
  });

  it("embeddings: wrong count or malformed payload is an error", async () => {
    const p = new OpenAiCompatProvider({ apiKey: "k", fetch: mockFetch(json({ data: [{ index: 0, embedding: [1] }] })) });
    await expect(p.embed({ model: "e", inputs: ["a", "b"] })).rejects.toMatchObject({ code: "provider_bad_response" });
  });

  it.each([
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [401, false],
    [404, false],
  ])("HTTP %i -> retryable=%s, and the key never appears in the error", async (status, retryable) => {
    const f = mockFetch(json({ error: { message: "Incorrect API key provided: sk-test-123456789abc" } }, status));
    const e = await new OpenAiCompatProvider({ apiKey: "sk-test-123456789abc", fetch: f }).generate({ task: "chat", model: "m", prompt: "p" }).catch((x) => x);
    expect(e).toBeInstanceOf(ProviderHttpError);
    expect(e.status).toBe(status);
    expect(e.retryable).toBe(retryable);
    expect(e.message).not.toContain("sk-test-123456789abc");
  });

  it("non-JSON error body (HTML) is not echoed", async () => {
    const f = mockFetch(new Response("<html>secret-ish page</html>", { status: 502 }));
    const e = await new OpenAiCompatProvider({ apiKey: "k", fetch: f }).generate({ task: "chat", model: "m", prompt: "p" }).catch((x) => x);
    expect(e.message).toBe("openai-compatible responded 502");
  });

  it("network failure and timeouts are retryable; bad payloads are errors", async () => {
    const net = new OpenAiCompatProvider({ apiKey: "k", fetch: mockFetch(() => { throw new TypeError("fetch failed: ECONNRESET with key k"); }) });
    await expect(net.generate({ task: "chat", model: "m", prompt: "p" })).rejects.toMatchObject({ code: "provider_network", retryable: true });
    const to = new OpenAiCompatProvider({ apiKey: "k", fetch: mockFetch(() => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }) });
    await expect(to.generate({ task: "chat", model: "m", prompt: "p" })).rejects.toMatchObject({ code: "provider_timeout", retryable: true });
    const bad = new OpenAiCompatProvider({ apiKey: "k", fetch: mockFetch(json({ choices: [] })) });
    await expect(bad.generate({ task: "chat", model: "m", prompt: "p" })).rejects.toMatchObject({ code: "provider_bad_response" });
    const garbage = new OpenAiCompatProvider({ apiKey: "k", fetch: mockFetch(new Response("not json", { status: 200 })) });
    await expect(garbage.generate({ task: "chat", model: "m", prompt: "p" })).rejects.toMatchObject({ code: "provider_bad_response" });
  });

  it("requires an api key", () => {
    expect(() => new OpenAiCompatProvider({ apiKey: "" })).toThrow(RangeError);
  });
});

describe("AnthropicProvider (mocked fetch)", () => {
  it("shapes the Messages request and joins text blocks", async () => {
    const f = mockFetch(json({ model: "claude-x", content: [{ type: "text", text: "A" }, { type: "tool_use" }, { type: "text", text: "B" }], usage: { input_tokens: 5, output_tokens: 2 } }));
    const p = new AnthropicProvider({ apiKey: "ak-123", fetch: f });
    const r = await p.generate({ task: "summarize", model: "claude-x", system: "SYS", prompt: "P" });
    expect(r).toEqual({ text: "AB", model: "claude-x", usage: { inputTokens: 5, outputTokens: 2 } });
    expect(f.mock.calls[0]![0]).toBe("https://api.anthropic.com/v1/messages");
    expect(headers(f)).toMatchObject({ "x-api-key": "ak-123", "anthropic-version": "2023-06-01" });
    expect(headers(f).authorization).toBeUndefined();
    expect(body(f)).toEqual({ model: "claude-x", max_tokens: 2048, system: "SYS", messages: [{ role: "user", content: "P" }] });
  });
  it("uses maxOutputTokens when given; maps errors", async () => {
    const f = mockFetch(json({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, 529));
    const p = new AnthropicProvider({ apiKey: "k", fetch: f });
    const e = await p.generate({ task: "chat", model: "m", prompt: "p", maxOutputTokens: 10 }).catch((x) => x);
    expect(body(f).max_tokens).toBe(10);
    expect(e).toBeInstanceOf(ProviderHttpError);
    expect(e.retryable).toBe(true);
    const e401 = await new AnthropicProvider({ apiKey: "k", fetch: mockFetch(json({ error: { message: "invalid x-api-key" } }, 401)) }).generate({ task: "chat", model: "m", prompt: "p" }).catch((x) => x);
    expect(e401.retryable).toBe(false);
  });
  it("embed is unsupported with a clear error", async () => {
    await expect(new AnthropicProvider({ apiKey: "k", fetch: mockFetch(json({})) }).embed({ model: "e", inputs: ["a"] })).rejects.toMatchObject({ code: "embeddings_unsupported" });
  });
});

describe("createProviderFromEnv", () => {
  it("no key -> NotConfiguredProvider whose calls throw ProviderNotConfiguredError (never fakes)", async () => {
    for (const env of [{}, { AI_PROVIDER: "openai", AI_API_KEY: "  " }, { AI_PROVIDER: "anthropic" }]) {
      const p = createProviderFromEnv(env);
      expect(p).toBeInstanceOf(NotConfiguredProvider);
      await expect(p.generate({ task: "chat", model: "m", prompt: "x" })).rejects.toBeInstanceOf(ProviderNotConfiguredError);
      await expect(p.embed({ model: "m", inputs: ["x"] })).rejects.toBeInstanceOf(ProviderNotConfiguredError);
    }
  });
  it("openai-compatible with base URL, used for both chat and embeddings", async () => {
    const f = mockFetch(json({ choices: [{ message: { content: "x" } }] }));
    const p = createProviderFromEnv({ AI_API_KEY: "k", AI_BASE_URL: "https://openrouter.ai/api/v1" }, f);
    await p.generate({ task: "chat", model: "m", prompt: "p" });
    expect(f.mock.calls[0]![0]).toBe("https://openrouter.ai/api/v1/chat/completions");
  });
  it("anthropic chat + separate OpenAI-compatible embeddings", async () => {
    const f = mockFetch(() => (f.mock.calls.length === 1 ? json({ content: [{ type: "text", text: "hi" }] }) : json({ data: [{ index: 0, embedding: [1] }] })));
    const p = createProviderFromEnv({ AI_PROVIDER: "anthropic", AI_API_KEY: "a", EMBED_API_KEY: "e", EMBED_BASE_URL: "https://emb.example/v1" }, f);
    await p.generate({ task: "chat", model: "m", prompt: "p" });
    await p.embed({ model: "e", inputs: ["x"] });
    expect(f.mock.calls.map((c) => c[0])).toEqual(["https://api.anthropic.com/v1/messages", "https://emb.example/v1/embeddings"]);
  });
  it("rejects unknown provider and bad dimensions; model defaults/overrides", () => {
    expect(() => createProviderFromEnv({ AI_PROVIDER: "nope" })).toThrow(RangeError);
    expect(() => createProviderFromEnv({ AI_API_KEY: "k", AI_EMBED_DIMENSIONS: "abc" })).toThrow(RangeError);
    expect(modelsFromEnv({ AI_MODEL_SMALL: "s" }).small).toBe("s");
    expect(modelsFromEnv({}).embed).toBeTruthy();
  });
});

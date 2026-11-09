import type { AiProvider, EmbedRequest, EmbedResult, GenerateRequest, GenerateResult } from "@unimate/core";
import { PipelineError } from "../errors";
import { postJson, type FetchFn } from "./http";

export interface OpenAiCompatOptions {
  apiKey: string;
  /** e.g. https://api.openai.com/v1 (default), https://api.groq.com/openai/v1, https://openrouter.ai/api/v1 */
  baseUrl?: string;
  name?: string;
  fetch?: FetchFn;
  timeoutMs?: number;
  /** Sent as `dimensions` to /embeddings when set (OpenAI text-embedding-3 supports it). */
  embedDimensions?: number;
}

/**
 * OpenAI-compatible chat + embeddings over fetch. NOT tested against any live service; request shaping and
 * error handling are covered by mocked-fetch unit tests only.
 * Uses `max_tokens` (accepted by Groq/OpenRouter/most servers); some newer OpenAI models want `max_completion_tokens`.
 */
export class OpenAiCompatProvider implements AiProvider {
  readonly name: string;
  private readonly base: string;
  private readonly fetchFn: FetchFn;
  constructor(private readonly o: OpenAiCompatOptions) {
    if (!o.apiKey) throw new RangeError("apiKey required");
    this.name = o.name ?? "openai-compatible";
    this.base = (o.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.fetchFn = o.fetch ?? ((u, i) => fetch(u, i));
  }
  private auth = () => ({ authorization: `Bearer ${this.o.apiKey}` });

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const messages = [...(req.system ? [{ role: "system", content: req.system }] : []), { role: "user", content: req.prompt }];
    const j = await postJson(
      this.name,
      this.fetchFn,
      `${this.base}/chat/completions`,
      this.auth(),
      { model: req.model, messages, ...(req.maxOutputTokens ? { max_tokens: req.maxOutputTokens } : {}) },
      this.o.timeoutMs ?? 60_000,
    );
    const text = j?.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new PipelineError("provider_bad_response", `${this.name} response had no message content`, true, true);
    return { text, model: typeof j.model === "string" ? j.model : req.model, usage: usageOf(j?.usage?.prompt_tokens, j?.usage?.completion_tokens) };
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const j = await postJson(
      this.name,
      this.fetchFn,
      `${this.base}/embeddings`,
      this.auth(),
      { model: req.model, input: req.inputs, ...(this.o.embedDimensions ? { dimensions: this.o.embedDimensions } : {}) },
      this.o.timeoutMs ?? 60_000,
    );
    const data: Array<{ index?: number; embedding?: unknown }> = Array.isArray(j?.data) ? j.data : [];
    const sorted = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (sorted.length !== req.inputs.length || sorted.some((d) => !Array.isArray(d.embedding)))
      throw new PipelineError("provider_bad_response", `${this.name} embeddings response malformed`, true, true);
    return {
      vectors: sorted.map((d) => d.embedding as number[]),
      model: typeof j.model === "string" ? j.model : req.model,
      usage: usageOf(j?.usage?.prompt_tokens ?? j?.usage?.total_tokens, 0),
    };
  }
}

export const usageOf = (i: unknown, o: unknown) => ({
  inputTokens: Number.isFinite(i) && (i as number) >= 0 ? (i as number) : 0,
  outputTokens: Number.isFinite(o) && (o as number) >= 0 ? (o as number) : 0,
});

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
  /**
   * "openai" (default): `embedDimensions` is sent as `dimensions`.
   * "nvidia": NVIDIA API Catalog retrieval embedders. Sends `input_type` (query/passage) and `truncate: "END"`, never
   * `dimensions` (the hosted NIM only returns its native 2048); vectors are cut to `embedDimensions` and
   * L2-renormalised, which NVIDIA's Nemotron embed model cards document as supported.
   */
  embedProtocol?: "openai" | "nvidia";
  /**
   * Hybrid reasoning models (Nemotron 3.5, GLM, DeepSeek) otherwise spend most of the token budget thinking before
   * answering. Sends `chat_template_kwargs` to disable it plus the `/no_think` system switch; non-reasoning models
   * ignore both. Any `<think>` block that still arrives is stripped from the answer.
   */
  disableThinking?: boolean;
  /** openai: sent as `dimensions`. nvidia: the length vectors are sliced to (the DB column size). */
  embedDimensions?: number;
}

/** First `n` components, L2-renormalised. Throws on a vector shorter than `n`, or zero / non-finite. */
export function sliceNormalize(v: number[], n: number): number[] {
  if (v.length < n) throw new PipelineError("embed_dims", `Embedding has ${v.length} dimensions, need at least ${n}`, false, true);
  const head = v.slice(0, n);
  const norm = Math.sqrt(head.reduce((a, x) => a + x * x, 0));
  if (!(norm > 0) || !Number.isFinite(norm)) throw new PipelineError("provider_bad_response", "Embedding vector is zero or not finite", true, true);
  return head.map((x) => x / norm);
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
    const nt = this.o.disableThinking === true;
    const system = nt ? `/no_think${req.system ? `\n${req.system}` : ""}` : req.system;
    const messages = [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: req.prompt }];
    const j = await postJson(
      this.name,
      this.fetchFn,
      `${this.base}/chat/completions`,
      this.auth(),
      {
        model: req.model,
        messages,
        ...(req.maxOutputTokens ? { max_tokens: req.maxOutputTokens } : {}),
        ...(nt ? { chat_template_kwargs: { enable_thinking: false, thinking: false } } : {}),
      },
      this.o.timeoutMs ?? 60_000,
    );
    const raw = j?.choices?.[0]?.message?.content;
    const text = typeof raw === "string" && nt ? raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim() : raw;
    if (typeof text !== "string") throw new PipelineError("provider_bad_response", `${this.name} response had no message content`, true, true);
    return { text, model: typeof j.model === "string" ? j.model : req.model, usage: usageOf(j?.usage?.prompt_tokens, j?.usage?.completion_tokens) };
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const nvidia = this.o.embedProtocol === "nvidia";
    if (nvidia && !req.inputType) throw new PipelineError("embed_input_type", "NVIDIA embeddings need inputType (query or passage)", false);
    const body = nvidia
      ? { model: req.model, input: req.inputs, input_type: req.inputType, encoding_format: "float", truncate: "END" }
      : { model: req.model, input: req.inputs, ...(this.o.embedDimensions ? { dimensions: this.o.embedDimensions } : {}) };
    const j = await postJson(this.name, this.fetchFn, `${this.base}/embeddings`, this.auth(), body, this.o.timeoutMs ?? 60_000);
    const data: Array<{ index?: number; embedding?: unknown }> = Array.isArray(j?.data) ? j.data : [];
    const sorted = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (sorted.length !== req.inputs.length || sorted.some((d) => !Array.isArray(d.embedding)))
      throw new PipelineError("provider_bad_response", `${this.name} embeddings response malformed`, true, true);
    return {
      vectors: sorted.map((d) => (nvidia && this.o.embedDimensions ? sliceNormalize(d.embedding as number[], this.o.embedDimensions) : (d.embedding as number[]))),
      model: typeof j.model === "string" ? j.model : req.model,
      usage: usageOf(j?.usage?.prompt_tokens ?? j?.usage?.total_tokens, 0),
    };
  }
}

export const usageOf = (i: unknown, o: unknown) => ({
  inputTokens: Number.isFinite(i) && (i as number) >= 0 ? (i as number) : 0,
  outputTokens: Number.isFinite(o) && (o as number) >= 0 ? (o as number) : 0,
});

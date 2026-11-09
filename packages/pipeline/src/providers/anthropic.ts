import type { AiProvider, EmbedRequest, EmbedResult, GenerateRequest, GenerateResult } from "@unimate/core";
import { PipelineError } from "../errors";
import { postJson, type FetchFn } from "./http";
import { usageOf } from "./openai";

export interface AnthropicOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchFn;
  timeoutMs?: number;
  /** Required by the API; used when a request does not set maxOutputTokens. */
  defaultMaxTokens?: number;
}

/** Anthropic Messages API adapter. NOT tested live (mocked fetch only). Anthropic offers no embeddings endpoint. */
export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  private readonly base: string;
  private readonly fetchFn: FetchFn;
  constructor(private readonly o: AnthropicOptions) {
    if (!o.apiKey) throw new RangeError("apiKey required");
    this.base = (o.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
    this.fetchFn = o.fetch ?? ((u, i) => fetch(u, i));
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const j = await postJson(
      this.name,
      this.fetchFn,
      `${this.base}/v1/messages`,
      { "x-api-key": this.o.apiKey, "anthropic-version": "2023-06-01" },
      {
        model: req.model,
        max_tokens: req.maxOutputTokens ?? this.o.defaultMaxTokens ?? 2048,
        ...(req.system ? { system: req.system } : {}),
        messages: [{ role: "user", content: req.prompt }],
      },
      this.o.timeoutMs ?? 60_000,
    );
    const blocks: Array<{ type?: string; text?: unknown }> = Array.isArray(j?.content) ? j.content : [];
    const text = blocks.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text as string).join("");
    if (!text && j?.stop_reason !== "end_turn" && !blocks.length)
      throw new PipelineError("provider_bad_response", "anthropic response had no content", true, true);
    return { text, model: typeof j.model === "string" ? j.model : req.model, usage: usageOf(j?.usage?.input_tokens, j?.usage?.output_tokens) };
  }

  async embed(_req: EmbedRequest): Promise<EmbedResult> {
    throw new PipelineError("embeddings_unsupported", "Anthropic has no embeddings API; configure an embeddings provider", false);
  }
}

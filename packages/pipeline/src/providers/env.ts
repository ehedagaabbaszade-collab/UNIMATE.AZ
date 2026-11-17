import { ProviderNotConfiguredError, type AiProvider, type EmbedRequest, type EmbedResult, type GenerateRequest, type GenerateResult } from "@unimate/core";
import type { ModelMap } from "../ai";
import { AnthropicProvider } from "./anthropic";
import type { FetchFn } from "./http";
import { OpenAiCompatProvider } from "./openai";

export type Env = Record<string, string | undefined>;

/** Every call throws ProviderNotConfiguredError. Never returns fake output. */
export class NotConfiguredProvider implements AiProvider {
  readonly configured = false;
  constructor(readonly name: string) {}
  async generate(_req: GenerateRequest): Promise<GenerateResult> {
    throw new ProviderNotConfiguredError(this.name);
  }
  async embed(_req: EmbedRequest): Promise<EmbedResult> {
    throw new ProviderNotConfiguredError(this.name);
  }
}

/** generate() from one provider, embed() from another (e.g. Anthropic chat + OpenAI-compatible embeddings). */
class CompositeProvider implements AiProvider {
  constructor(
    readonly name: string,
    private readonly chat: AiProvider,
    private readonly embedder: AiProvider,
  ) {}
  generate(req: GenerateRequest) {
    return this.chat.generate(req);
  }
  embed(req: EmbedRequest) {
    return this.embedder.embed(req);
  }
}

const nonEmpty = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

/**
 * Environment variables:
 *   AI_PROVIDER        "openai" (any OpenAI-compatible server, default) | "anthropic"
 *   AI_API_KEY         key for chat (falls back to OPENAI_API_KEY / ANTHROPIC_API_KEY)
 *   AI_BASE_URL        override base URL (Groq, OpenRouter, ...)
 *   EMBED_API_KEY, EMBED_BASE_URL   embeddings endpoint (OpenAI-compatible); defaults to the chat settings when
 *                      the chat provider is OpenAI-compatible. Required for AI_PROVIDER=anthropic.
 *   AI_EMBED_DIMENSIONS  optional `dimensions` for embeddings (DB column is vector(1536))
 *   AI_EMBED_PROTOCOL  "openai" (default) | "nvidia": NVIDIA retrieval embedders get input_type and are sliced to
 *                      AI_EMBED_DIMENSIONS instead of receiving `dimensions` (see OpenAiCompatOptions.embedProtocol)
 *   AI_DISABLE_THINKING  "true": chat asks hybrid reasoning models to answer without a thinking phase
 * With no key this returns a NotConfiguredProvider (calls throw ProviderNotConfiguredError); it never fabricates output.
 */
export function createProviderFromEnv(env: Env, fetchFn?: FetchFn): AiProvider {
  const kind = (nonEmpty(env.AI_PROVIDER) ?? "openai").toLowerCase();
  if (kind !== "openai" && kind !== "anthropic") throw new RangeError(`Unknown AI_PROVIDER "${kind}"`);
  const common = fetchFn ? { fetch: fetchFn } : {};
  const dims = nonEmpty(env.AI_EMBED_DIMENSIONS) ? Number(env.AI_EMBED_DIMENSIONS) : undefined;
  if (dims !== undefined && (!Number.isInteger(dims) || dims < 1)) throw new RangeError("AI_EMBED_DIMENSIONS must be a positive integer");
  const protocol = (nonEmpty(env.AI_EMBED_PROTOCOL) ?? "openai").toLowerCase();
  if (protocol !== "openai" && protocol !== "nvidia") throw new RangeError(`Unknown AI_EMBED_PROTOCOL "${protocol}"`);
  if (protocol === "nvidia" && dims === undefined) throw new RangeError("AI_EMBED_PROTOCOL=nvidia needs AI_EMBED_DIMENSIONS (the DB column size)");
  const noThink = ["1", "true", "yes"].includes((nonEmpty(env.AI_DISABLE_THINKING) ?? "").toLowerCase());
  const dimOpt = {
    ...(dims ? { embedDimensions: dims } : {}),
    ...(protocol === "nvidia" ? { embedProtocol: "nvidia" as const } : {}),
    ...(noThink ? { disableThinking: true } : {}),
  };

  if (kind === "anthropic") {
    const key = nonEmpty(env.AI_API_KEY) ?? nonEmpty(env.ANTHROPIC_API_KEY);
    if (!key) return new NotConfiguredProvider("anthropic");
    const baseUrl = nonEmpty(env.AI_BASE_URL);
    const chat = new AnthropicProvider({ apiKey: key, ...(baseUrl ? { baseUrl } : {}), ...common });
    const ek = nonEmpty(env.EMBED_API_KEY);
    if (!ek) return chat; // chat works; embed() throws a clear "no embeddings API" error
    const eb = nonEmpty(env.EMBED_BASE_URL);
    return new CompositeProvider("anthropic+openai-embeddings", chat, new OpenAiCompatProvider({ apiKey: ek, ...(eb ? { baseUrl: eb } : {}), ...dimOpt, ...common }));
  }

  const key = nonEmpty(env.AI_API_KEY) ?? nonEmpty(env.OPENAI_API_KEY);
  if (!key) return new NotConfiguredProvider("openai");
  const baseUrl = nonEmpty(env.AI_BASE_URL);
  const chat = new OpenAiCompatProvider({ apiKey: key, ...(baseUrl ? { baseUrl } : {}), ...dimOpt, ...common });
  const ek = nonEmpty(env.EMBED_API_KEY);
  if (!ek) return chat;
  const eb = nonEmpty(env.EMBED_BASE_URL) ?? baseUrl;
  return new CompositeProvider("openai-compatible", chat, new OpenAiCompatProvider({ apiKey: ek, ...(eb ? { baseUrl: eb } : {}), ...dimOpt, ...common }));
}

/** Model names per tier from env, with placeholder defaults. */
export function modelsFromEnv(env: Env): ModelMap {
  return {
    small: nonEmpty(env.AI_MODEL_SMALL) ?? "gpt-4o-mini",
    standard: nonEmpty(env.AI_MODEL_STANDARD) ?? "gpt-4o",
    premium: nonEmpty(env.AI_MODEL_PREMIUM) ?? "gpt-4o",
    embed: nonEmpty(env.AI_EMBED_MODEL) ?? "text-embedding-3-small",
  };
}

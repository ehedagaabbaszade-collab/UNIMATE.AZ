import { stableHash } from "./text/chunk";
import type { AiProvider, EmbedRequest, EmbedResult, GenerateRequest, GenerateResult } from "./ai/provider";

const approxTokens = (s: string) => Math.ceil(s.length / 4);

/** Deterministic provider for tests. Intentionally NOT exported from the package index. */
export class FakeProvider implements AiProvider {
  readonly name = "fake";
  readonly calls: Array<GenerateRequest | EmbedRequest> = [];
  private readonly responder: ((req: GenerateRequest) => string) | undefined;
  constructor(responder?: (req: GenerateRequest) => string) {
    this.responder = responder;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    this.calls.push(req);
    const text = this.responder ? this.responder(req) : `fake:${stableHash(req.prompt)}`;
    return {
      text,
      model: req.model,
      usage: { inputTokens: approxTokens((req.system ?? "") + req.prompt), outputTokens: approxTokens(text) },
    };
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    this.calls.push(req);
    const vectors = req.inputs.map((s) => {
      const h = stableHash(s);
      return Array.from({ length: 7 }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255);
    });
    return {
      vectors,
      model: req.model,
      usage: { inputTokens: req.inputs.reduce((n, s) => n + approxTokens(s), 0), outputTokens: 0 },
    };
  }
}

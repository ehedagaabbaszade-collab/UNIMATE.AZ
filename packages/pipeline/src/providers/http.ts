import { PipelineError, sanitizeError } from "../errors";

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export class ProviderHttpError extends PipelineError {
  readonly status: number;
  constructor(provider: string, status: number, detail: string) {
    super(
      "provider_http",
      `${provider} responded ${status}${detail ? `: ${detail}` : ""}`,
      status === 408 || status === 409 || status === 429 || status >= 500,
      // 4xx other than 408/429 means the request was refused (not billed); everything else may have been billed
      !(status >= 400 && status < 500 && status !== 408 && status !== 429),
    );
    this.name = "ProviderHttpError";
    this.status = status;
  }
}

/** POSTs JSON and returns parsed JSON. Errors never contain the request headers (API keys). */
export async function postJson(
  provider: string,
  fetchFn: FetchFn,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<any> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timeout = (e as Error).name === "TimeoutError" || (e as Error).name === "AbortError";
    throw new PipelineError(timeout ? "provider_timeout" : "provider_network", `${provider} request ${timeout ? "timed out" : "failed"}`, true, timeout);
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    let detail = "";
    try {
      const j = JSON.parse(text);
      const m = j?.error?.message ?? j?.message ?? j?.error;
      detail = typeof m === "string" ? m : "";
    } catch {
      /* non-JSON error body: ignore it, it may be an HTML page */
    }
    // sanitizeError strips anything that looks like a key/token that a server might echo back.
    throw new ProviderHttpError(provider, res.status, sanitizeError(new Error(detail)).replace(/^Error: /, "").slice(0, 200));
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new PipelineError("provider_bad_response", `${provider} returned invalid JSON`, true, true);
  }
}

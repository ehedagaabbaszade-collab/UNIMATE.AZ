// Benchmarks NVIDIA API Catalog chat models on a real UNIMATE task: an Azerbaijani multiple-choice quiz as JSON.
// Usage (the key is read from the environment and never printed):
//   PowerShell: $env:NVIDIA_API_KEY="nvapi-..."; node scripts/bench-nvidia.mjs
//   bash:       NVIDIA_API_KEY=nvapi-... node scripts/bench-nvidia.mjs
// Optional: pass model ids as arguments to test other models.
const KEY = process.env.NVIDIA_API_KEY || process.env.AI_API_KEY;
if (!KEY) {
  console.error("Set NVIDIA_API_KEY in this shell first.");
  process.exit(1);
}
const BASE = "https://integrate.api.nvidia.com/v1";
// --nothink: ask hybrid reasoning models (Nemotron, GLM, ...) to answer directly without a thinking phase.
const NOTHINK = process.argv.includes("--nothink");
const ARGS = process.argv.slice(2).filter((a) => a !== "--nothink");
const MODELS = ARGS.length
  ? ARGS
  : [
      "google/gemma-4-31b-it", // current
      "deepseek-ai/deepseek-v4.1-flash",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-nano-3-30b-a3b",
      "z-ai/glm-5.3-flash",
      "minimaxai/minimax-m3.1-flash",
    ];

const SOURCE = `Fotosintez yaşıl bitkilərin günəş işığının enerjisindən istifadə edərək karbon qazı və sudan qlükoza və oksigen
əmələ gətirməsi prosesidir. Proses xloroplastlarda gedir və xlorofil piqmenti işığı udur. İşıq fazasında suyun parçalanması
nəticəsində oksigen ayrılır, ATP və NADPH yaranır. Qaranlıq fazada (Kalvin tsikli) karbon qazı fiksasiya olunur və qlükoza sintez edilir.`;
const SYSTEM = "Sən universitet tələbələri üçün test hazırlayan köməkçisən. Yalnız JSON qaytar, başqa heç nə yazma.";
const PROMPT = `Aşağıdakı mətnə əsasən Azərbaycan dilində 5 test sualı hazırla. Format:
{"questions":[{"prompt":"...","options":["A","B","C","D"],"answer":0,"explanation":"..."}]}
Mətn:
${SOURCE}`;

const strip = (t) => t.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();

async function run(model) {
  const t0 = performance.now();
  let firstToken = null;
  let text = "";
  let usage = null;
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: NOTHINK ? `/no_think\n${SYSTEM}` : SYSTEM }, { role: "user", content: PROMPT }],
        max_tokens: 2048,
        temperature: 0.3,
        stream: true,
        stream_options: { include_usage: true },
        ...(NOTHINK ? { chat_template_kwargs: { enable_thinking: false, thinking: false } } : {}),
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return { model, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}` };
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:") || line === "data: [DONE]") continue;
        const j = JSON.parse(line.slice(5));
        const d = j.choices?.[0]?.delta;
        const piece = (d?.content ?? "") + (d?.reasoning_content ?? "");
        if (piece && firstToken === null) firstToken = performance.now() - t0;
        text += d?.content ?? "";
        if (j.usage) usage = j.usage;
      }
    }
  } catch (e) {
    return { model, error: e instanceof Error ? e.message : String(e) };
  }
  const total = (performance.now() - t0) / 1000;
  let valid = false;
  let sample;
  try {
    const q = JSON.parse(strip(text)).questions;
    valid = Array.isArray(q) && q.length >= 1 && q.every((x) => Array.isArray(x.options) && Number.isInteger(x.answer));
    sample = q?.[0]?.prompt ?? "";
  } catch {
    sample = strip(text).slice(0, 80);
  }
  const out = usage?.completion_tokens ?? null;
  return { model, total: total.toFixed(1), first: firstToken ? (firstToken / 1000).toFixed(1) : "-", out, tps: out ? (out / total).toFixed(0) : "-", valid, thinks: /<think>/.test(text), sample };
}

console.log("Azerbaijani 5-question quiz, streamed. Times in seconds.\n");
for (const m of MODELS) {
  const r = await run(m);
  if (r.error) console.log(`${m}\n  ERROR ${r.error}\n`);
  else console.log(`${m}\n  total ${r.total}s | first token ${r.first}s | ${r.out ?? "?"} tokens | ${r.tps} tok/s | valid JSON: ${r.valid} | thinking: ${r.thinks}\n  Q1: ${r.sample}\n`);
}

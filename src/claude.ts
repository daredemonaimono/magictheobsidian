import { requestUrl } from "obsidian";

// $/100万トークン (入力, 出力)
export const MODELS: Record<string, { label: string; in: number; out: number }> = {
  "claude-haiku-5-5": { label: "Haiku 5.5", in: 0.1, out: 0.5 },
  "claude-sonnet-5-5": { label: "Sonnet 5.5", in: 2, out: 10 },
  "claude-opus-5-5": { label: "Opus 5.5", in: 4, out: 20 },
};

export interface Reply {
  text: string;
  inTokens: number;
  outTokens: number;
  cost: number; // $
}

// Messages API を 1 回呼ぶ。思考は effort low で浅くして費用を抑える。
// shortcut: ストリーミング無し・リトライ無し (requestUrl は逐次受信できない)。本実装で見直す
export async function askClaude(key: string, model: string, system: string, user: string): Promise<Reply> {
  const res = await requestUrl({
    url: "https://api.anthropic.com/v1/messages",
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      cache_control: { type: "ephemeral" },
      output_config: { effort: "low" },
      system,
      messages: [{ role: "user", content: user }],
    }),
    throw: false,
  });
  if (res.status !== 200) throw new Error(`API ${res.status}: ${res.json?.error?.message ?? res.text.slice(0, 200)}`);
  const u = res.json.usage ?? {};
  const p = MODELS[model] ?? MODELS["claude-haiku-5-5"];
  const inTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  const outTokens = u.output_tokens ?? 0;
  // 書き込み 1.25 倍、読み出し 0.1 倍
  const inCost = ((u.input_tokens ?? 0) + 1.25 * (u.cache_creation_input_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0)) * p.in;
  const text = (res.json.content as { type: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text).join("");
  return { text, inTokens, outTokens, cost: (inCost + outTokens * p.out) / 1e6 };
}

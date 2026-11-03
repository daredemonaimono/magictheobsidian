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
export async function askClaude(key: string, model: string, system: string, user: string, think = false): Promise<Reply> {
  // 思考なし: Haiku は disabled、Sonnet は between_tools (disabled は 400)、Opus は止められない (effort low のみ)
  const thinking = think ? undefined : model.includes("haiku") ? { type: "disabled" } : model.includes("sonnet") ? { type: "between_tools" } : undefined;
  const res = await requestUrl({
    url: "https://api.anthropic.com/v1/messages",
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: think || !thinking ? 8192 : 800,
      ...(thinking ? { thinking } : {}),
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

// AI の返事から、最初の JSON のオブジェクトを取り出す。前置きの文や ```json の囲み、文字列の中の { } があっても、括弧の対応で切り出す。
// 読めなければ、返事の先頭を付けて、エラーにする (途中で切れたときも、ここで分かる)
export function extractJson(text: string): any {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  for (const src of [fence?.[1], text]) {
    if (!src) continue;
    for (let i = src.indexOf("{"); i >= 0; i = src.indexOf("{", i + 1)) {
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let j = i; j < src.length; j++) {
        const ch = src[j];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === "\\") esc = true;
          else if (ch === '"') inStr = false;
        } else if (ch === '"') inStr = true;
        else if (ch === "{") depth++;
        else if (ch === "}" && --depth === 0) {
          try {
            return JSON.parse(src.slice(i, j + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error(`AI の返事を JSON として読めない (途中で切れたか、形が違う): ${text.slice(0, 200).replace(/\n/g, " ")}`);
}

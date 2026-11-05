import { requestUrl } from "obsidian";

// Anthropic の Messages API を、Obsidian の requestUrl で直接呼ぶ (画面からの fetch は CORS で拒否され、モバイルでも動かすため SDK は入れない)。
// temperature などのサンプリング引数と thinking は送らない (新しいモデルは 400 になる)。thinking は既定のまま
export interface Msg {
  role: "user" | "assistant";
  content: string;
}
export type Http = (url: string, headers: Record<string, string>, body: string) => Promise<{ status: number; json: any }>;
export class ClaudeError extends Error {}

export const obsidianHttp: Http = async (url, headers, body) => {
  const r = await requestUrl({ url, method: "POST", headers, body, throw: false });
  return { status: r.status, json: r.json };
};

export async function askClaude(o: { apiKey: string; model: string; system: string; messages: Msg[]; http: Http; onUsage?: (u: { input: number; output: number }) => void }): Promise<string> {
  const scrub = (s: string) => s.split(o.apiKey).join("***"); // キーはメッセージに出さない
  const body = JSON.stringify({ model: o.model, max_tokens: 16000, system: o.system, messages: o.messages });
  const res = await o.http("https://api.anthropic.com/v1/messages", { "x-api-key": o.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body);
  if (res.status === 401) throw new ClaudeError("APIキーが無効");
  if (res.status === 429) throw new ClaudeError("レート制限に達した。少し待ってからやり直す");
  if (res.status >= 500) throw new ClaudeError("API が混雑している (サーバーのエラー)。少し待ってからやり直す");
  if (res.status !== 200) throw new ClaudeError(scrub(`HTTP ${res.status}: ${res.json?.error?.message ?? ""}`));
  const u = res.json?.usage;
  if (u && o.onUsage) o.onUsage({ input: Number(u.input_tokens ?? 0), output: Number(u.output_tokens ?? 0) }); // 使ったトークン数 (対戦のログに残す)
  if (res.json?.stop_reason === "refusal") throw new ClaudeError("AI が応答を拒否した");
  const text = ((res.json?.content ?? []) as { type: string; text?: string }[])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  if (!text) throw new ClaudeError("空の返事だった");
  return text;
}

import { ClaudeError, Http, Msg } from "./claude";

// Claude 以外の AI (対戦の相手用)。OpenAI の chat/completions (と、同じ形の互換 API: Ollama・LM Studio など) と、Google の Gemini。どちらも Obsidian の requestUrl で直接呼ぶ (SDK なし)
// 返すのは、返事の文章と、使ったトークン数。キーは、メッセージに出さない
export interface ProviderReply {
  text: string;
  input?: number;
  output?: number;
  cacheRead?: number; // Claude のキャッシュから読んだ入力トークン (input に含む)
  cacheWrite?: number;
}

export const OPENAI_BASE = "https://api.openai.com/v1";

function failure(status: number, json: any, key: string): ClaudeError {
  const scrub = (s: string) => (key ? s.split(key).join("***") : s);
  if (status === 401 || status === 403) return new ClaudeError("APIキーが無効 (または、権限が無い)");
  if (status === 429) return new ClaudeError("レート制限に達した。少し待ってからやり直す");
  if (status >= 500) return new ClaudeError("API が混雑している (サーバーのエラー)。少し待ってからやり直す");
  return new ClaudeError(scrub(`HTTP ${status}: ${json?.error?.message ?? ""}`));
}

// messages = 会話の続き (ルール作りの聞き直しなど)。無ければ、user の1通だけ
export async function askOpenAI(o: { apiKey: string; baseUrl?: string; model: string; system: string; user: string; messages?: Msg[]; http: Http }): Promise<ProviderReply> {
  const base = (o.baseUrl || OPENAI_BASE).replace(/\/+$/, "");
  const headers: Record<string, string> = { "content-type": "application/json", ...(o.apiKey ? { authorization: `Bearer ${o.apiKey}` } : {}) };
  const body = JSON.stringify({ model: o.model, messages: [{ role: "system", content: o.system }, ...(o.messages ?? [{ role: "user", content: o.user }])] });
  const res = await o.http(`${base}/chat/completions`, headers, body);
  if (res.status !== 200) throw failure(res.status, res.json, o.apiKey);
  const choice = res.json?.choices?.[0];
  if (choice?.message?.refusal) throw new ClaudeError("AI が応答を拒否した");
  const text = String(choice?.message?.content ?? "");
  if (!text) throw new ClaudeError("空の返事だった");
  const u = res.json?.usage;
  return { text, ...(u ? { input: Number(u.prompt_tokens ?? 0), output: Number(u.completion_tokens ?? 0) } : {}) };
}

export async function askGemini(o: { apiKey: string; model: string; system: string; user: string; messages?: Msg[]; http: Http }): Promise<ProviderReply> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(o.model)}:generateContent`;
  const body = JSON.stringify({ systemInstruction: { parts: [{ text: o.system }] }, contents: (o.messages ?? [{ role: "user", content: o.user }]).map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })) });
  const res = await o.http(url, { "x-goog-api-key": o.apiKey, "content-type": "application/json" }, body); // キーは、URL ではなく、ヘッダーで送る
  if (res.status !== 200) throw failure(res.status, res.json, o.apiKey);
  const cand = res.json?.candidates?.[0];
  if (res.json?.promptFeedback?.blockReason) throw new ClaudeError(`AI が応答を拒否した (${res.json.promptFeedback.blockReason})`);
  const text = ((cand?.content?.parts ?? []) as { text?: string; thought?: boolean }[]).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  if (!text) throw new ClaudeError("空の返事だった");
  const u = res.json?.usageMetadata;
  return { text, ...(u ? { input: Number(u.promptTokenCount ?? 0), output: Number(u.candidatesTokenCount ?? 0) + Number(u.thoughtsTokenCount ?? 0) } : {}) };
}

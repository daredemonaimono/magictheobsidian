// AI の API (Claude / OpenAI / Gemini)。ここは、通信の中身 (リクエストの形と、答えの読み方) だけ。実際の通信は、main.ts (Obsidian の requestUrl)。
// **API キーは、リクエストのヘッダーにだけ載せる** (URL には入れない。ログにも出さない。保存は、Obsidian の SecretStorage だけ)。
export type Provider = "claude" | "openai" | "gemini";
export const PROVIDERS: { id: Provider; name: string }[] = [
  { id: "claude", name: "Claude (Anthropic)" },
  { id: "openai", name: "OpenAI" },
  { id: "gemini", name: "Gemini (Google)" },
];
export interface Msg {
  role: "user" | "assistant";
  content: string;
}
export interface HttpRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}
export type Http = (req: HttpRequest) => Promise<{ status: number; json: unknown }>;

// 既定のモデル (一覧を取得するまでの、初期の候補)
export const DEFAULT_MODELS: Record<Provider, string> = { claude: "claude-sonnet-5-5", openai: "gpt-5", gemini: "gemini-2.5-pro" };

export function chatRequest(p: Provider, model: string, key: string, system: string, messages: Msg[], maxTokens = 4096): HttpRequest {
  const json = { "Content-Type": "application/json" };
  if (p === "claude") {
    return { url: "https://api.anthropic.com/v1/messages", method: "POST", headers: { ...json, "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, max_tokens: maxTokens, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], messages }) }; // 同じ手引きを何度も送るので、キャッシュさせる (2 回目から、入力の料金・時間が減る)
  }
  if (p === "openai") {
    return { url: "https://api.openai.com/v1/chat/completions", method: "POST", headers: { ...json, Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: "system", content: system }, ...messages] }) };
  }
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    method: "POST",
    headers: { ...json, "x-goog-api-key": key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })), generationConfig: { maxOutputTokens: maxTokens } }),
  };
}

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export function chatText(p: Provider, res: unknown): string {
  const r = res as J;
  const text =
    p === "claude" ? (r.content as J[] | undefined)?.filter((c) => c.type === "text").map((c) => c.text).join("")
    : p === "openai" ? r.choices?.[0]?.message?.content
    : (r.candidates?.[0]?.content?.parts as J[] | undefined)?.map((x) => x.text ?? "").join("");
  if (typeof text !== "string" || !text.trim()) {
    // 何が返ったか (終わった理由・ブロックの種類) を、添える。本文・キーは、含めない
    const why = p === "claude" ? `stop_reason=${r.stop_reason}, blocks=[${(r.content as J[] | undefined)?.map((c) => c.type).join(",") ?? ""}]` : p === "openai" ? `finish_reason=${r.choices?.[0]?.finish_reason}` : `finishReason=${r.candidates?.[0]?.finishReason}, block=${r.promptFeedback?.blockReason ?? "-"}`;
    throw new Error(`empty response (${why})`);
  }
  return text;
}

// 出力の上限で、途中で切れたか
export const truncated = (p: Provider, res: unknown): boolean => {
  const r = res as J;
  return p === "claude" ? r.stop_reason === "max_tokens" : p === "openai" ? r.choices?.[0]?.finish_reason === "length" : r.candidates?.[0]?.finishReason === "MAX_TOKENS";
};

// エラーの本文から、短いメッセージを取る (キーは、本文に入らない)
export function errorText(res: unknown): string {
  const r = res as J;
  return String(r?.error?.message ?? r?.error ?? r?.message ?? "").slice(0, 200);
}

export function modelsRequest(p: Provider, key: string): HttpRequest {
  if (p === "claude") return { url: "https://api.anthropic.com/v1/models?limit=100", method: "GET", headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } };
  if (p === "openai") return { url: "https://api.openai.com/v1/models", method: "GET", headers: { Authorization: `Bearer ${key}` } };
  return { url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", method: "GET", headers: { "x-goog-api-key": key } };
}

export function modelIds(p: Provider, res: unknown): string[] {
  const r = res as J;
  const ids =
    p === "gemini"
      ? ((r.models as J[] | undefined) ?? []).filter((m) => (m.supportedGenerationMethods as string[] | undefined)?.includes("generateContent")).map((m) => String(m.name).replace(/^models\//, ""))
      : ((r.data as J[] | undefined) ?? []).map((m) => String(m.id));
  // OpenAI は、文章を作れないモデル (埋め込み・音声・画像など) も混ざる
  return [...new Set(p === "openai" ? ids.filter((x) => /^(gpt|o\d|chatgpt)/.test(x) && !/(embed|audio|tts|whisper|image|realtime|transcribe|moderation)/.test(x)) : ids)].sort();
}

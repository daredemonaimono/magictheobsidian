import { ClaudeError, Http, Msg, askClaude } from "./claude";
import { OPENAI_BASE, ProviderReply, askGemini, askOpenAI } from "./providers";

// AI の設定: 接続 (キー) は、種類ごとに 1 つ。使い分けは、場面ごと (対戦の相手・ルールを書かせる・メモの下書き) に、種類とモデルを選ぶ。
// 場面で種類を切り替えても、キーも、各種類のモデルも、残る。純粋な関数 (キーの取り出しと通信は、呼ぶ側が渡す)
export type Provider = "claude" | "openai" | "gemini" | "jev"; // jev = 選ぶ仕事だけ (対戦の判断・ノードを選ぶ)。文章を作る場面 (ルール・メモ) では、選べない
export type Scene = "battle" | "rules" | "nodes" | "memo";
export const PROVIDERS: [Provider, string][] = [["claude", "Claude"], ["openai", "OpenAI"], ["gemini", "Gemini"], ["jev", "Jev"]];
export const JEV_SCENES: Scene[] = ["battle", "nodes"]; // Jev を選べる場面
export const providersFor = (scene: Scene): [Provider, string][] => PROVIDERS.filter(([id]) => id !== "jev" || JEV_SCENES.includes(scene));
export type TextProvider = Exclude<Provider, "jev">; // 文章を作れる AI
export const SCENES: [Scene, string, string][] = [
  ["battle", "対戦の相手", "「対戦の相手」を AI にしたときの判断 (盤面を渡して、行動を選ばせる)。判断のたびに、呼ぶ。"],
  ["rules", "ルールを書かせる", "「Battle: build rules with AI」: カードの効果から、ルール (ノード) を、AI に書かせる。"],
  ["nodes", "ノードを選ぶ", "「ルールを書かせる」の前に、カードの効果から、使いそうなノードを選ばせる (短い一覧で、安い AI で足りる。使わないときは、全ノードを渡す)。"],
  ["memo", "メモの下書き", "「Battle: draft deck memo」: 対戦の履歴から、デッキのメモの下書きを作らせる。"],
];

export interface SceneAi {
  provider: Provider;
  models: Record<Provider, string>; // 種類ごとのモデル。種類を切り替えても、残る
}
export interface AiSettings {
  keys: Record<Provider, string>; // API キーの、Obsidian のキーチェーン上の名前 (キーそのものは、設定のファイルに書かない)
  openaiBaseUrl: string; // OpenAI の欄の URL。互換 API (Ollama・LM Studio など) なら、その URL
  scenes: Record<Scene, SceneAi>;
  // Jev の設定。confidence = 対戦の判断で、Jev の自信がこれ以上なら、その答えを使う (未満なら、fallback の AI に聞き直す)。recall = ノードを選ぶとき、「要る」の確率がこれ以上のノードを選ぶ (低いほど、見落とさない)。fallback = 聞き直す AI (none なら、Jev の答えをそのまま使う)
  jev: { confidence: number; recall: number; fallback: TextProvider | "none" };
}

const models = (claude: string): Record<Provider, string> => ({ claude, openai: "gpt-4o-mini", gemini: "gemini-2.5-flash", jev: "jev-latest" });
export const DEFAULT_AI: AiSettings = {
  keys: { claude: "", openai: "", gemini: "", jev: "" },
  openaiBaseUrl: OPENAI_BASE,
  jev: { confidence: 0.7, recall: 0.2, fallback: "claude" },
  scenes: { battle: { provider: "claude", models: models("claude-sonnet-5-5") }, rules: { provider: "claude", models: models("claude-opus-5-5") }, nodes: { provider: "claude", models: models("claude-haiku-5-5") }, memo: { provider: "claude", models: models("claude-sonnet-5-5") } },
};

const isProvider = (v: unknown): v is Provider => v === "claude" || v === "openai" || v === "gemini" || v === "jev";
const isText = (v: unknown): v is TextProvider => v === "claude" || v === "openai" || v === "gemini";
const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && v >= lo && v <= hi ? v : d);
const str = (v: unknown, d: string) => (typeof v === "string" && v.trim() ? v : d);

// 保存してあった設定 (d = data.json の中身) から、AI の設定を作る。新しい形 (d.ai) があればそれ、無ければ、昔の形 (claudeKeySecret / battleModel / battleProvider / openai〜 / gemini〜) から
export function migrateAi(d: any): AiSettings {
  const clone = (): AiSettings => JSON.parse(JSON.stringify(DEFAULT_AI));
  const out = clone();
  const a = d?.ai;
  if (a && typeof a === "object") {
    for (const p of ["claude", "openai", "gemini", "jev"] as const) out.keys[p] = str(a.keys?.[p], "");
    out.jev = { confidence: num(a.jev?.confidence, out.jev.confidence, 0.5, 1), recall: num(a.jev?.recall, out.jev.recall, 0.01, 0.9), fallback: isText(a.jev?.fallback) || a.jev?.fallback === "none" ? a.jev.fallback : out.jev.fallback };
    out.openaiBaseUrl = str(a.openaiBaseUrl, out.openaiBaseUrl);
    for (const [s] of SCENES) {
      const sc = a.scenes?.[s];
      if (isProvider(sc?.provider) && (sc.provider !== "jev" || JEV_SCENES.includes(s))) out.scenes[s].provider = sc.provider; // Jev は、選ぶ場面だけ
      for (const p of ["claude", "openai", "gemini", "jev"] as const) out.scenes[s].models[p] = str(sc?.models?.[p], out.scenes[s].models[p]);
    }
    return out;
  }
  // 昔の形
  out.keys = { claude: str(d?.claudeKeySecret, ""), openai: str(d?.openaiKeySecret, ""), gemini: str(d?.geminiKeySecret, ""), jev: "" };
  out.openaiBaseUrl = str(d?.openaiBaseUrl, out.openaiBaseUrl);
  const battleProvider: Provider = isProvider(d?.battleProvider) ? d.battleProvider : "claude";
  out.scenes.battle = { provider: battleProvider, models: { claude: str(d?.battleModel, out.scenes.battle.models.claude), openai: str(d?.openaiModel, out.scenes.battle.models.openai), gemini: str(d?.geminiModel, out.scenes.battle.models.gemini), jev: out.scenes.battle.models.jev } };
  out.scenes.memo = { provider: battleProvider, models: { ...out.scenes.battle.models } }; // メモの下書きは、昔は、対戦の相手と同じ AI を使っていた
  out.scenes.rules.models.claude = str(d?.claudeModel, out.scenes.rules.models.claude);
  return out;
}

// 互換 API で、URL を変えている (自分のパソコンの AI など): キー無しでよい
const ownEndpoint = (ai: AiSettings) => ai.openaiBaseUrl.replace(/\/+$/, "") !== OPENAI_BASE;

// その場面で、AI を呼べるか (キーがある。OpenAI の互換 API で、URL を変えているときは、キー無しでもよい)
export function aiReady(ai: AiSettings, scene: Scene, secret: (name: string) => string | null): boolean {
  const p = ai.scenes[scene].provider;
  return !!secret(ai.keys[p]) || (p === "openai" && ownEndpoint(ai));
}
export const aiLabel = (ai: AiSettings, scene: Scene): string => `${ai.scenes[scene].provider}:${ai.scenes[scene].models[ai.scenes[scene].provider]}`;
export const providerName = (p: Provider): string => PROVIDERS.find(([id]) => id === p)![1];

// その場面の AI に、聞く。キーが無ければ ClaudeError
export async function runAi(o: { ai: AiSettings; scene: Scene; secret: (name: string) => string | null; http: Http; system: string; messages: Msg[] }): Promise<ProviderReply> {
  const sc = o.ai.scenes[o.scene];
  const key = o.secret(o.ai.keys[sc.provider]) ?? "";
  const model = sc.models[sc.provider];
  if (sc.provider === "jev") throw new ClaudeError("Jev は、文章を作れない (選ぶ仕事だけ)");
  if (!aiReady(o.ai, o.scene, o.secret)) throw new ClaudeError(`${providerName(sc.provider)} の API キーが未設定`);
  if (sc.provider === "openai") return askOpenAI({ apiKey: key, baseUrl: o.ai.openaiBaseUrl, model, system: o.system, user: "", messages: o.messages, http: o.http });
  if (sc.provider === "gemini") return askGemini({ apiKey: key, model, system: o.system, user: "", messages: o.messages, http: o.http });
  let usage: { input: number; output: number } | undefined;
  const text = await askClaude({ apiKey: key, model, system: o.system, messages: o.messages, http: o.http, onUsage: (u) => (usage = u) });
  return { text, ...(usage ?? {}) };
}

// Jev で決めきれないとき、聞き直す AI。fallback の種類を、その場面の AI にした設定を返す (キーが無い・none なら undefined)
export function fallbackAi(ai: AiSettings, scene: Scene, secret: (name: string) => string | null): AiSettings | undefined {
  const f = ai.jev.fallback;
  if (f === "none" || !secret(ai.keys[f])) return f === "openai" && ai.openaiBaseUrl.replace(/\/+$/, "") !== OPENAI_BASE ? { ...ai, scenes: { ...ai.scenes, [scene]: { ...ai.scenes[scene], provider: f } } } : undefined;
  return { ...ai, scenes: { ...ai.scenes, [scene]: { ...ai.scenes[scene], provider: f } } };
}

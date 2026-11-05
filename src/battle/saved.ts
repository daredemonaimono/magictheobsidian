import { RecordEntry } from "./play";

// 対戦の履歴 (Battles/ のノード 1 つ = 1 試合)。読みやすいログと、リプレイ用の記録 (入口の呼び出しの並び) を、1 つのノートにする。純粋な関数 (保存は、画面の外)
export interface SavedBattle {
  version: 1;
  self: string; // デッキ名
  opp: string;
  seed: number; // 乱数の種 (山札の切り直し・マリガン)
  mode: "cpu" | "claude" | "passive";
  model?: string; // mode=claude のときのモデル
  result: "win" | "lose" | "draw" | "unfinished";
  turns: number;
  tokens?: { input: number; output: number };
  date: string; // ISO
  entries: RecordEntry[];
  log: string[];
}

const RESULT_LABEL: Record<SavedBattle["result"], string> = { win: "勝ち", lose: "負け", draw: "引き分け", unfinished: "途中" };
const FENCE = "```";

export const battleNoteName = (b: SavedBattle): string => `${b.date.slice(0, 16).replace(/[-:]/g, "").replace("T", "-")} ${b.self} vs ${b.opp}.md`.replace(/[\\/:*?"<>|]/g, "_");

export function battleNote(b: SavedBattle): string {
  const fm = [
    "---",
    "mtg: battle",
    `self: ${JSON.stringify(b.self)}`,
    `opp: ${JSON.stringify(b.opp)}`,
    `date: ${b.date}`,
    `result: ${b.result}`,
    `turns: ${b.turns}`,
    `mode: ${b.mode}`,
    ...(b.model ? [`model: ${b.model}`] : []),
    ...(b.tokens ? [`tokens_in: ${b.tokens.input}`, `tokens_out: ${b.tokens.output}`] : []),
    `seed: ${b.seed}`,
    "---",
  ];
  const data = { version: b.version, seed: b.seed, mode: b.mode, self: b.self, opp: b.opp, entries: b.entries };
  return [
    ...fm,
    "",
    `# ${b.self} vs ${b.opp} (${RESULT_LABEL[b.result]}、${b.turns} ターン)`,
    "",
    "## ログ",
    "",
    ...b.log.map((l) => `- ${l}`),
    "",
    "## 記録 (リプレイ用。書き換えない)",
    "",
    `${FENCE}json`,
    JSON.stringify(data),
    FENCE,
    "",
  ].join("\n");
}

// ノートから、記録を読み戻す。読めなければ undefined
export function parseBattleNote(md: string): SavedBattle | undefined {
  const fm = md.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const get = (k: string) => fm.match(new RegExp(`^${k}: (.*)$`, "m"))?.[1]?.trim();
  const block = md.match(/```json\n([\s\S]*?)\n```/)?.[1];
  if (!block || get("mtg") !== "battle") return undefined;
  try {
    const d = JSON.parse(block);
    if (d.version !== 1 || !Array.isArray(d.entries)) return undefined;
    const result = get("result") as SavedBattle["result"];
    return {
      version: 1,
      self: d.self,
      opp: d.opp,
      seed: d.seed,
      mode: d.mode,
      ...(get("model") ? { model: get("model")! } : {}),
      result: result in RESULT_LABEL ? result : "unfinished",
      turns: Number(get("turns") ?? 0),
      ...(get("tokens_in") !== undefined ? { tokens: { input: Number(get("tokens_in")), output: Number(get("tokens_out") ?? 0) } } : {}),
      date: get("date") ?? "",
      entries: d.entries,
      log: [...md.matchAll(/^- (.*)$/gm)].map((m) => m[1]),
    };
  } catch {
    return undefined;
  }
}

// 共通ルールのノート (Rules/_agent.md): どの AI も読む、持ち主の指示。見出し (## 共通 / ## ノード作成 / ## 対戦 / ## メモの下書き) で、場面ごとに分ける。
// AI の指示には、「共通 + その場面の節」だけが添わる (見出しの前の説明や、知らない見出しの節は、渡さない)。デッキのメモ (対戦) は、そのあとに添わる (メモのほうが具体的)。
// ファイル名の先頭の「_」は、カードのルールとして読ませないための印 (Rules/ の決まり)。ここでは、名前を指定して読むので、「_」があっても効く
export const AGENT_NOTE = "_agent.md";
export type AgentScene = "nodes" | "battle" | "memo";
export interface AgentRules {
  common: string;
  nodes: string;
  battle: string;
  memo: string;
}

const HEADINGS: Record<string, keyof AgentRules> = { 共通: "common", common: "common", ノード作成: "nodes", nodes: "nodes", rules: "nodes", 対戦: "battle", battle: "battle", メモの下書き: "memo", memo: "memo" };

export function parseAgentRules(md: string): AgentRules {
  const out: AgentRules = { common: "", nodes: "", battle: "", memo: "" };
  const body = md.replace(/^---\n[\s\S]*?\n---\n?/, "");
  let cur: keyof AgentRules | undefined;
  const buf: Record<string, string[]> = { common: [], nodes: [], battle: [], memo: [] };
  for (const line of body.split("\n")) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      cur = HEADINGS[h[1].trim().toLowerCase()] ?? HEADINGS[h[1].trim()];
      continue;
    }
    if (/^#\s/.test(line)) cur = undefined; // 大見出し (説明) は、渡さない
    else if (cur) buf[cur].push(line);
  }
  for (const k of Object.keys(buf) as (keyof AgentRules)[]) out[k] = buf[k].join("\n").trim();
  return out;
}

// その場面に添える文章 (共通 + その場面の節)。無ければ空
export function sharedFor(rules: AgentRules | undefined, scene: AgentScene): string {
  return rules ? [rules.common, rules[scene]].filter(Boolean).join("\n\n") : "";
}

// AI の指示に、共通ルールを添える (無ければ、そのまま)
export const withShared = (system: string, shared?: string): string => (shared?.trim() ? `${system}\n\n## 持ち主の共通ルール (必ず従う。書いていないことは、自分で判断する)\n${shared.trim()}` : system);

// 初めて作るときの、ノートの中身 (コマンド「Rules: create the shared AI rules note」)
export const DEFAULT_AGENT_NOTE = `---
mtg: agent
---

# AI の共通ルール

どの AI (ルールを書かせる・ノードを選ぶ・対戦の相手・メモの下書き) も読む、あなたの指示です。見出しごとに、場面を分けています。
\`## 共通\` と、その場面の節だけが、AI に渡ります (この説明は、渡りません)。デッキのメモは、対戦のとき、これのあとに渡ります。

## 共通
- 日本語で答える。
- 書いていないことは、自分で判断する。

## ノード作成
- カード専用のノードは作らない。組み合わせで書ける汎用のノードを使う。
- 「A または B」の条件で起きる誘発は、同じ効果の誘発型能力を、条件ごとに 2 つ書く (例: Prized Amalgam は、\`when event=enters from=graveyard\` と、\`when event=enters castFrom=graveyard\` の 2 つ)。
- 書けない効果は、無理に近いノードで書かず、\`## 未対応\` に残す。

## 対戦
- ライフが 5 以下のときは、ライフを払う行動を選ばない。

## メモの下書き
- 短い箇条書きにする。
`;

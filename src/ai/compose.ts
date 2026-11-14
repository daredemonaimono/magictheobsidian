import { CardData, abilityBlock, extractNodeBlock, parseAbility } from "../node/card";
import { NodeData } from "../node/md";
import { validate } from "../node/validate";
import { Http, Msg, Provider, chatRequest, chatText, errorText } from "./providers";

const FENCE = "`".repeat(3); // コードブロックの囲い

// AI に、能力 1 つを組ませる。答えを読んで、検証し、問題があれば、問題を伝えて、書き直させる (最大 maxTries 回)。
export interface ComposeInput {
  http: Http;
  provider: Provider;
  model: string;
  key: string;
  guide: string; // docs/ai-guide.md (システム・プロンプト)
  card: CardData;
  ability: NodeData; // 組む能力 (source = 原文の行)
  tokenNames: string[]; // 登録済みのトークンのカード名
  hasCard: (name: string, filter?: string) => boolean;
  maxTries?: number;
}
export interface ComposeResult {
  node?: NodeData; // 検証を通った、組んだ能力 (name・source は、もとのまま)
  problems: string[]; // 通らなかったときの、最後の問題
  note: string; // AI の短い説明・「未対応: …」
  tries: number;
}

// AI の説明 (ブロックの外) から、「未対応: …」の理由を取る。無ければ undefined
export const unsupportedOf = (note: string): string | undefined => {
  const lines = note.split("\n").map((l) => /^\s*[-*・]?\s*(?:未対応|unsupported)\s*[:：]\s*(.+)$/i.exec(l)?.[1]?.trim()).filter((x): x is string => !!x);
  return lines.length ? lines.join(" / ").slice(0, 400) : undefined;
};

export const userPrompt = (i: Pick<ComposeInput, "card" | "ability" | "tokenNames">): string =>
  [
    `カード: ${i.card.name}${i.card.typeLine ? ` (${i.card.typeLine})` : ""}${i.card.loyalty ? `、初期の忠誠度 ${i.card.loyalty}` : ""}`,
    i.card.keywords?.length ? `キーワード: ${i.card.keywords.join(", ")}` : "",
    "",
    "カードの原文 (全体。文脈の参照用):",
    ...(i.card.text ?? "").split("\n").map((l) => `> ${l}`),
    "",
    `**組む行 (この行だけ)**: ${(i.ability.source ?? i.ability.name).split("\n").join(" / ")}`,
    "",
    i.tokenNames.length ? `登録済みのトークン (createToken の token には、この名前を使う): ${i.tokenNames.join(" / ")}` : "登録済みのトークン: なし (トークンを作る行は、「未対応: トークンが未登録」と書く)",
    "",
    "いまの状態 (まだ組んでいなければ、種類・タイミングは初期値):",
    abilityBlock(i.ability, true),
    "",
    `原文の行の、すべての文・コスト・条件を、組むか、「未対応: …」と書いてください (黙って、省かない)。\n`,
    `この行を、手引きに従って組んで、${FENCE}mtg-node ブロックを 1 つ答えてください。`,
  ].join("\n");

export async function composeAbility(i: ComposeInput): Promise<ComposeResult> {
  const messages: Msg[] = [{ role: "user", content: userPrompt(i) }];
  const getNode = (n: string) => i.card.abilities.find((a) => a.name === n);
  let problems: string[] = [];
  let note = "";
  const tries = i.maxTries ?? 3;
  for (let t = 1; t <= tries; t++) {
    const req = chatRequest(i.provider, i.model, i.key, i.guide, messages);
    const res = await i.http(req);
    if (res.status !== 200) throw new Error(`HTTP ${res.status} ${errorText(res.json)}`.trim());
    const text = chatText(i.provider, res.json);
    const block = extractNodeBlock(text);
    if (!block) {
      problems = [`${FENCE}mtg-node ブロックが無い`];
    } else {
      note = block.note;
      const parsed = parseAbility(block.body);
      // 名前・原文のもとは、もとの能力のまま。AI は、種類・タイミング・条件・対象・手順だけを決める
      const node: NodeData = { ...parsed, name: i.ability.name, ...(i.ability.source ? { source: i.ability.source } : {}) };
      problems = validate(node, getNode, i.hasCard);
      if (!problems.length) return { node, problems, note, tries: t };
    }
    messages.push({ role: "assistant", content: text }, { role: "user", content: `検証で、次の問題が出ました。直して、${FENCE}mtg-node ブロックを書き直してください。\n${problems.map((p) => `- ${p}`).join("\n")}` });
  }
  return { problems, note, tries };
}

import { CardRule } from "./node";
import { parseRule } from "./ruleMd";
import { RuleBook } from "./state";

// 組み込みのルール: トークンの定義 (Treasure・Food・Clue・Blood)。ノートの Rules/ に同じ名前のものがあれば、そちらが先 (書き換えられる)
const MD: Record<string, string> = {
  Treasure: "## 起動型能力\n\n- cost tap=true sacrifice=true\n- addMana amount=1 color=any\n",
  Food: "## 起動型能力\n\n- cost mana=2 tap=true sacrifice=true\n- gainLife player=you amount=3\n",
  Clue: "## 起動型能力\n\n- cost mana=2 sacrifice=true\n- draw player=you count=1\n",
  Blood: "## 起動型能力\n\n- cost mana=1 tap=true sacrifice=true\n- discard player=you count=1\n- draw player=you count=1\n",
};
const cache = new Map<string, CardRule>();
export function builtinRule(name: string): CardRule | undefined {
  if (!MD[name]) return undefined;
  if (!cache.has(name)) cache.set(name, parseRule(`---\nmtg: rule\ncard: "[[${name}]]"\n---\n\n${MD[name]}`));
  return cache.get(name);
}
export const withBuiltinRules = (book: RuleBook): RuleBook => ({ get: (c) => book.get(c) ?? builtinRule(c) });

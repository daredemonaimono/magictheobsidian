import { compactLog } from "./aiLog";
import { Action, abilityLabels, actionsFor, autoTargets, manaOnly, slotsOf, tryAction, withAllMana } from "./actions";
import { getNode } from "./registry";
import { characteristics } from "./continuous";
import { attackersAt, canAttackPerm, handAbilitiesOf } from "./engine";
import { Game, Perm, PlayerId, RuleBook } from "./state";

// Claude の AI の相手 (段階7)。この中は、API を呼ばない (純粋な関数)。盤面と選択肢を文章にして、返事を読み取るだけ。呼ぶのは画面 (BattleView)、実行はコントローラー (BattleController.ai*)
export interface AiReply {
  text: string;
  input?: number; // 使ったトークン数
  output?: number;
}
export type AskAi = (system: string, user: string) => Promise<AiReply>; // 画面が渡す、API の呼び出し (キーが無ければ、渡さない)
export interface AiOption {
  id: number;
  label: string;
  action?: Action; // 無ければ「何もしない (パス)」
  targets?: Record<string, string>;
}

const isCreature = (g: Game, x: Perm, rules: RuleBook) => /\bCreature\b/.test(characteristics(g, x, rules).typeLine);

// 何かの名前 (id → 表示名)。p から見た「自分」「相手」
function nameOf(g: Game, p: PlayerId, id: string): string {
  if (g.players.includes(id)) return id === p ? "自分(プレイヤー)" : "相手(プレイヤー)";
  return g.battlefield.find((x) => x.id === id)?.card.name ?? g.stack.find((s) => s.id === id)?.card.name ?? id;
}

const MAX_TARGET_OPTIONS = 8; // 1つの行動で、対象ごとに別の選択肢にする上限

// いまできる行動を、番号つきの選択肢にする。0 番は、いつも「何もしない」。対象を取る行動は、最初のスロットの対象ごとに分ける (残りのスロットは、仮の対象)
export function aiOptions(g: Game, rules: RuleBook, p: PlayerId): AiOption[] {
  const out: AiOption[] = [{ id: 0, label: "何もしない (パスして、次へ進む)" }];
  const sim = withAllMana(g, rules, p); // 土地・マナ能力を全部使えば唱えられるものも、選択肢にする (実行のときに、必要なぶんだけタップする)
  const add = (label: string, action: Action) => {
    const slots = slotsOf(sim, rules, p, action);
    const base = autoTargets(slots);
    const first = slots.find((s) => s.legal.length);
    if (out.some((o) => o.label === label)) return; // 同じ名前のカードが何枚あっても、選択肢は1つ
    if (!first) return void out.push({ id: out.length, label, action });
    for (const t of first.legal.slice(0, MAX_TARGET_OPTIONS)) out.push({ id: out.length, label: `${label} → 対象: ${nameOf(g, p, t)}`, action, targets: { ...base, [first.as]: t } });
  };
  const seen = new Set<string>();
  for (const a of [...actionsFor(sim, rules, p), ...actionsFor(g, rules, p)]) {
    const key = JSON.stringify(a);
    if (seen.has(key)) continue; // 本物の局面でできるもの (自分自身をタップする能力を含む) と、マナを全部出せばできるもの
    seen.add(key);
    if (a.kind === "activate") {
      const perm = g.battlefield.find((x) => x.id === a.perm);
      const ab = perm && rules.get(perm.card.name)?.abilities.filter((x) => x.kind === "activated")[a.index];
      if (!perm || !ab || manaOnly(ab.body)) continue; // マナを出すだけの能力は、選択肢にしない
      add(`能力を使う: ${perm.card.name} の ${abilityLabels(rules, perm.card.name)[a.index]}`, a);
    } else {
      const c = g.hands[p].find((x) => x.id === a.card);
      if (c) add(`${a.kind === "land" ? "土地を出す" : "唱える"}: ${c.name} (マナ総量 ${c.mv})`, a);
    }
  }
  // 手札から起動する能力 (サイクリングなど。actionsFor の一覧には入らない: 人の画面と AI だけが使う)
  for (const c of g.hands[p]) {
    handAbilitiesOf(rules, c.name).forEach((ab, index) => {
      const action: Action = { kind: "handAbility", card: c.id, index };
      if (tryAction(sim, rules, p, action) !== undefined) return;
      const what = ab.body.filter((x) => x.node !== "cost" && x.node !== "timing").map((x) => getNode(x.node)?.title ?? x.node).join(" → ");
      add(`手札から起動: ${c.name} (${what})`, action);
    });
  }
  return out;
}

// 選択肢が「何もしない」だけか (その場合は、API を呼ばず、機械的にパスする)
export const aiTrivial = (opts: AiOption[]): boolean => opts.length <= 1;

export const permLine = (g: Game, x: Perm, rules: RuleBook): string => {
  const c = characteristics(g, x, rules);
  const st = [x.tapped ? "タップ" : "", x.attacking ? "攻撃中" : "", x.blocking ? "ブロック中" : "", x.damage ? `ダメージ${x.damage}` : "", c.keywords.length ? c.keywords.join("/") : ""].filter(Boolean).join(",");
  return `${x.card.name}${isCreature(g, x, rules) ? ` ${c.power}/${c.toughness}` : ""}${st ? ` [${st}]` : ""} (id:${x.id})`;
};

// 盤面の説明 (p = AI の視点)
export function aiDescribe(g: Game, rules: RuleBook, p: PlayerId): string {
  const foe = g.players.find((x) => x !== p) ?? p;
  const mine = g.battlefield.filter((x) => x.controller === p);
  const theirs = g.battlefield.filter((x) => x.controller === foe);
  const lines = [
    `ターン ${g.turn} (${g.active === p ? "あなた(AI)" : "相手"}のターン)、ステップ: ${g.step}${g.combatPhase ? ` / 戦闘: ${g.combatPhase}` : ""}`,
    `ライフ: あなた ${g.life[p]} / 相手 ${g.life[foe]}`,
    `あなたの手札 (${g.hands[p].length}): ${g.hands[p].map((c) => `${c.name}(${c.typeLine}, MV${c.mv})`).join("、") || "なし"}`,
    `あなたの戦場: ${mine.map((x) => permLine(g, x, rules)).join("、") || "なし"}`,
    `相手の戦場: ${theirs.map((x) => permLine(g, x, rules)).join("、") || "なし"}`,
    `相手の手札: ${g.hands[foe].length} 枚 / 相手のライブラリー: ${g.libraries[foe].length} 枚 / あなたのライブラリー: ${g.libraries[p].length} 枚`,
    `あなたの墓地: ${g.graveyards[p].map((c) => c.name).join("、") || "なし"} / 相手の墓地: ${g.graveyards[foe].map((c) => c.name).join("、") || "なし"}`,
    `スタック (上から): ${[...g.stack].reverse().map((s) => `${s.card.name}${s.ability ? "(能力)" : ""} (${s.controller === p ? "あなた" : "相手"})`).join("、") || "空"}`,
    `使えるマナ: ${g.mana[p] ?? 0}`,
    `最近のログ:\n${compactLog(g.log, p !== g.players[0]).slice(-8).join("\n")}`, // 向きを AI に合わせ、記録用の行を除いて、短くしたもの (src/battle/aiLog.ts)
  ];
  return lines.join("\n");
}

export const AI_SYSTEM = `あなたは、マジック:ザ・ギャザリングの対戦相手 (プレイヤー) です。盤面の説明と、選べる行動を渡します。勝つために、最もよい行動を1つ選んでください。
返事は、JSON のオブジェクト1つだけにしてください (前後に文章を書かない)。"why" は、日本語で、1文の短い理由です。
- 行動を選ぶとき: {"choice": 番号, "why": "..."}
- 攻撃するクリーチャーを選ぶとき: {"attackers": ["id", ...], "why": "..."} (攻撃しないなら空の配列)
- ブロックを選ぶとき: {"blocks": [{"blocker": "id", "attacker": "id"}, ...], "why": "..."} (ブロックしないなら空の配列。1体は1体だけをブロックできる)
id は、盤面の説明の「(id:〜)」の、〜の部分だけを、そのまま書いてください (カード名ではありません)。「why」で「攻撃する」と書いたなら、その id を attackers に入れてください。`;

// デッキのメモ (持ち主が書いた、そのデッキの動かし方) を、指示に足す。無ければ、そのまま (AI の自己判断)
// decks = あなたのデッキと、対戦相手のデッキの名前: メモの「[[デッキ名]] が相手のときは〜」を、いまの対戦相手に合わせて読ませる
export const withMemo = (system: string, memo?: string, decks?: { mine: string; foe: string }): string =>
  memo?.trim()
    ? `${system}\n\nあなたが使うデッキについて、持ち主が書いたメモです。マリガンの基準・立ち回り・コンボなどが書いてあれば、参考にしてください (書いていないことは、自分で判断してください)。${decks ? `\nあなたのデッキ: [[${decks.mine}]]。いまの対戦相手のデッキ: [[${decks.foe}]]${decks.mine === decks.foe ? " (同じデッキ同士: ミラー)" : ""}。メモに「[[デッキ名]] が相手のときは〜」とあれば、対戦相手のデッキに合うものだけ、使ってください。` : ""}\n${memo.trim()}`
    : system;

export const aiActPrompt = (g: Game, rules: RuleBook, p: PlayerId, opts: AiOption[]): string => `${aiDescribe(g, rules, p)}\n\nあなたはいま優先権を持っています。選べる行動:\n${opts.map((o) => `${o.id}: ${o.label}`).join("\n")}\n\n番号を1つ選んでください。`;

export function aiAttackers(g: Game, rules: RuleBook, p: PlayerId): Perm[] {
  return g.battlefield.filter((x) => x.controller === p && canAttackPerm(g, x, rules));
}
export const aiAttackPrompt = (g: Game, rules: RuleBook, p: PlayerId): string =>
  `${aiDescribe(g, rules, p)}\n\n攻撃クリーチャーを指定する段階です。攻撃できるクリーチャー:\n${aiAttackers(g, rules, p).map((x) => permLine(g, x, rules)).join("\n")}\n\n攻撃するクリーチャーの id を選んでください (攻撃先は、相手のプレイヤー)。`;

export function aiBlockers(g: Game, rules: RuleBook, p: PlayerId): Perm[] {
  return g.battlefield.filter((x) => x.controller === p && !x.tapped && isCreature(g, x, rules));
}
export const aiBlockPrompt = (g: Game, rules: RuleBook, p: PlayerId): string =>
  `${aiDescribe(g, rules, p)}\n\nブロックを指定する段階です。攻撃されています:\n${attackersAt(g, p).map((x) => permLine(g, x, rules)).join("\n")}\nブロックできる、あなたのクリーチャー:\n${aiBlockers(g, rules, p).map((x) => permLine(g, x, rules)).join("\n")}\n\nブロックの組を選んでください。`;

// 返事の中の id (文字列) を、有効な id に直す。"id:Bear#3" のような接頭辞・大文字小文字の違い・カード名 (同じ名前が1つだけのとき) も受ける。直せなかったものは unknown
export function matchIds(raw: unknown[], valid: { id: string; name: string }[]): { ids: string[]; unknown: string[] } {
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const r of raw) {
    const s = String(typeof r === "object" && r !== null ? (r as { id?: unknown }).id ?? "" : r).trim();
    const t = s.replace(/^\(?\s*id\s*[:=]\s*/i, "").replace(/\)$/, "").trim();
    const byId = valid.find((v) => v.id === t) ?? valid.find((v) => v.id.toLowerCase() === t.toLowerCase());
    const byName = valid.filter((v) => v.name.toLowerCase() === t.toLowerCase());
    const hit = byId ?? (byName.length === 1 ? byName[0] : undefined);
    if (hit) ids.includes(hit.id) || ids.push(hit.id);
    else unknown.push(s);
  }
  return { ids, unknown };
}

// 返事から、最初の JSON のオブジェクトを読み取る (前後に文章や ``` があってもよい。波かっこの対応で、切り出す)。読めなければ undefined
export function aiParse(text: string): Record<string, unknown> | undefined {
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inStr = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (ch === "\\") i++;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          const v = JSON.parse(text.slice(start, i + 1));
          if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
        } catch {
          /* 次の { から */
        }
        break;
      }
    }
  }
  return undefined;
}

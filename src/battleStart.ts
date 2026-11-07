import { App, TFile, normalizePath } from "obsidian";
import { AskAi } from "./battle/ai";
import { MulliganResult, aiMulligan, applyMulligan } from "./battle/aiMulligan";
import { loadAgentRules } from "./agentNote";
import { sharedFor } from "./battle/agentRules";
import { cpuMulligan } from "./battle/cpu";
import { applyOpening } from "./battle/engine";
import { extractMemo } from "./battle/memo";
import { seeded } from "./battle/rng";
import { SavedBattle } from "./battle/saved";
import { BattleSession, CardData, DeckChoice, DeckData, MatchError, buildMatch } from "./battle/deckToGame";
import { parseRule } from "./battle/ruleMd";
import { CardRule } from "./battle/node";
import { RuleBook } from "./battle/state";
import { cardInfo, deckVerdicts } from "./cards";
import { DECK_DIR, parseDeck } from "./deck";

// 対戦を始めるための、vault (Decks/ Cards/ Rules/) の読み込み。読むだけで、書き換えない。組み立ては src/battle/deckToGame.ts (純粋な関数)
const RULES_DIR = "Rules";

const deckFiles = (app: App): TFile[] =>
  app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(`${DECK_DIR}/`) && app.metadataCache.getFileCache(f)?.frontmatter?.mtg === "deck");

// デッキの一覧と、フォーマットごとの判定
export async function listDecks(app: App): Promise<DeckChoice[]> {
  const out: DeckChoice[] = [];
  for (const file of deckFiles(app)) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    const deck = parseDeck(await app.vault.cachedRead(file));
    const keys = [...deck.commander.keys(), ...deck.main.keys(), ...deck.side.keys()];
    const commander = deck.commander.size > 0 || fm?.format === "commander";
    out.push({ name: file.basename, format: typeof fm?.format === "string" ? fm.format : "", commander, legal: deckVerdicts(app, keys, commander) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// デッキのメイン → 対戦に要るカードのデータ。Cards/ にノートが無いカードがあれば MatchError
export async function loadDeckData(app: App, name: string): Promise<DeckData> {
  const file = deckFiles(app).find((f) => f.basename === name);
  if (!file) throw new MatchError(`デッキが見つからない: ${name}`);
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  const deck = parseDeck(await app.vault.cachedRead(file));
  const main = [...deck.main].map(([key, e]) => {
    const info = cardInfo(app, key);
    if (!info) throw new MatchError(`カードのノートが無い: ${key} (デッキ ${name})`);
    const data: CardData = { name: key, typeLine: info.typeLine, cmc: info.cmc, manaCost: info.manaCost, power: info.power, toughness: info.toughness, keywords: info.keywords, colors: info.colors, loyalty: info.loyalty };
    return { key, n: e.n, data };
  });
  return { format: typeof fm?.format === "string" ? fm.format : "", main };
}

// Rules/<カード名>.md を読んで、ルールブックにする。無い・読めないものは、無いものとして扱う (対戦では、使うと「スキップします」)
export async function loadRules(app: App, names: string[]): Promise<RuleBook> {
  const map = new Map<string, CardRule>();
  for (const name of names) {
    const f = app.vault.getAbstractFileByPath(normalizePath(`${RULES_DIR}/${name}.md`));
    if (!(f instanceof TFile)) continue;
    try {
      map.set(name, parseRule(await app.vault.cachedRead(f)));
    } catch {
      /* 読めないルールは、無いものとして扱う */
    }
  }
  return { get: (card) => map.get(card) };
}

export async function loadMatchInputs(app: App, selfName: string, oppName: string): Promise<{ self: DeckData; opp: DeckData; rules: RuleBook }> {
  const self = await loadDeckData(app, selfName);
  const opp = await loadDeckData(app, oppName);
  const rules = await loadRules(app, [...new Set([...self.main, ...opp.main].map((e) => e.key))]);
  return { self, opp, rules };
}

type Inputs = { self: DeckData; opp: DeckData; rules: RuleBook };

// 同じ種から、いつも同じ初期状態を作る (対戦を始めるときと、履歴のリプレイで、共通)
// cpu = 相手 (雑魚 CPU) が、簡単な決まりで、先にマリガンする (何もしない相手は、しない)。aiMulligan = AI の相手のマリガンの記録 (リプレイで、同じ手札を作り直す)
export function buildSession(inputs: Inputs, selfName: string, oppName: string, seed: number, cpu: boolean, aiMulligan?: MulliganResult, deferOpening = false): BattleSession {
  const rng = seeded(seed); // 山札の切り直し・マリガンは、この種から決まる (履歴のリプレイで、同じ局面を作るため)
  const game = buildMatch(inputs.self, inputs.opp, inputs.rules, rng);
  game.mulligan = { count: 0 }; // 開始前に、マリガンを聞く
  game.rngState = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0; // ゲームの中の乱数 (ライブラリーを切る、など) の初期状態: 種から決める (リプレイで、同じ結果)
  if (aiMulligan) applyMulligan(game, "opp", rng, aiMulligan);
  else if (cpu) cpuMulligan(game, "opp", rng);
  if (!deferOpening) applyOpening(game, "opp", inputs.rules); // 相手の、開始時に戦場に出すカード (自分のは、キープしたあと)。AI の相手は、AI のマリガンが終わってから
  return { game, rules: inputs.rules, seed, rng, self: selfName, opp: oppName, ...(aiMulligan ? { aiMulligan } : {}) };
}

export const findDeckFile = (app: App, name: string): TFile | undefined => deckFiles(app).find((f) => f.basename === name);

// デッキのノートの、メモ (`## メモ`)。無ければ空
export async function loadDeckMemo(app: App, name: string): Promise<string> {
  const file = deckFiles(app).find((f) => f.basename === name);
  return file ? extractMemo(await app.vault.cachedRead(file)) : "";
}

// ask = AI の相手を呼ぶ関数。あれば (AI の相手のとき)、マリガンも AI が決める (メモに基準があれば、それに沿う。無ければ、自己判断)。失敗したら、雑魚 CPU の決まり
export async function startBattle(app: App, selfName: string, oppName: string, cpu = true, ask?: AskAi): Promise<BattleSession> {
  const inputs = await loadMatchInputs(app, selfName, oppName);
  const seed = Math.floor(Math.random() * 2 ** 31);
  const oppMemo = await loadDeckMemo(app, oppName);
  const shared = sharedFor(await loadAgentRules(app), "battle"); // 共通ルール (Rules/_agent.md)
  if (!ask) return { ...buildSession(inputs, selfName, oppName, seed, cpu), oppMemo, shared };
  // AI の相手のマリガンは、盤面を開いたあとに、裏で決める (API の待ちで、盤面が遅れないように)。終わるまで、自分のマリガンは聞かない (乱数の順番を、リプレイと同じにするため)
  const s: BattleSession = { ...buildSession(inputs, selfName, oppName, seed, false, undefined, true), oppMemo, shared };
  s.pendingAi = aiMulliganOf(s, ask, oppMemo, shared)
    .then((m) => {
      s.aiMulligan = m;
    })
    .catch(() => undefined) // aiMulligan は、失敗しても雑魚 CPU の決まりで済ませる。ここまで来る失敗は、何もしない
    .then(() => {
      applyOpening(s.game, "opp", s.rules); // 相手の、開始時に戦場に出すカード
      s.pendingAi = undefined;
    });
  return s;
}
async function aiMulliganOf(s: BattleSession, ask: AskAi, memo: string, shared: string): Promise<MulliganResult> {
  return aiMulligan(s.game, "opp", s.rng!, ask, memo, s.self && s.opp ? { mine: s.opp, foe: s.self } : undefined, shared);
}

// 履歴のリプレイ: 記録と同じデッキ・種から初期状態を作る関数を持った、対戦のセッション (いまのデッキ・ルールのノートを読む)
export async function startReplay(app: App, saved: SavedBattle): Promise<BattleSession> {
  const inputs = await loadMatchInputs(app, saved.self, saved.opp);
  const make = () => buildSession(inputs, saved.self, saved.opp, saved.seed, saved.mode !== "passive", saved.aiMulligan);
  return { ...make(), replay: saved, rebuild: make };
}

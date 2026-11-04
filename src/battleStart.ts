import { App, TFile, normalizePath } from "obsidian";
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

export async function startBattle(app: App, selfName: string, oppName: string): Promise<BattleSession> {
  const { self, opp, rules } = await loadMatchInputs(app, selfName, oppName);
  return { game: buildMatch(self, opp, rules), rules };
}

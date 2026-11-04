import { Game, GameCard, Perm, RuleBook, createGame } from "./state";

// 対戦の画面 (段階1) に出す、サンプルの局面。手書きの固定データではなく、createGame で作った本物の Game。
// カード名は、ユーザーの vault の Cards/ にあるもの (画像と効果テキストを、名前でノートから引くため)
export function sampleBattle(): { game: Game; rules: RuleBook } {
  const g = createGame(["you", "opp"]);
  const card = (name: string, typeLine: string, owner: string, extra: Partial<GameCard> = {}): GameCard => ({ id: `${owner}:${name}`, name, typeLine, mv: 1, owner, ...extra });
  const filler = (owner: string, n: number, label: string): GameCard[] => Array.from({ length: n }, (_, i) => card(`${label}-${i + 1}`, "Land", owner));
  const put = (c: GameCard, extra: Partial<Perm> = {}): Perm => {
    const p: Perm = { id: c.id, card: c, controller: c.owner, ...extra };
    g.battlefield.push(p);
    return p;
  };

  // 自分: 手札 6 枚、土地 4 枚 (1 枚タップ)、クリーチャー 4 体 (3 体が攻撃中)、アーティファクト、プレインズウォーカー
  for (const n of ["Aetherize", "Accumulate Wisdom", "Confusticate and Bebother", "Into the Roil", "Negate", "We Say Thee Nay!"]) g.hands["you"].push(card(n, "Instant", "you"));
  for (let i = 1; i <= 4; i++) put(card("Island", "Basic Land — Island", "you", { id: `you:Island${i}` }), i === 1 ? { tapped: true } : {});
  put(card("Brineborn Cutthroat", "Creature — Merfolk Rogue", "you", { power: 2, toughness: 1 }), { attacking: true, attackTarget: "opp", tapped: true });
  put(card("Geist of Saint Thalia", "Creature — Spirit", "you", { power: 3, toughness: 3, keywords: ["flying"] }), { attacking: true, attackTarget: "opp", tapped: true });
  put(card("Elementalist Adept", "Creature — Human Wizard", "you", { power: 2, toughness: 2 }), { attacking: true, attackTarget: "opp", tapped: true, counters: { "+1/+1": 1 } });
  put(card("Illusion", "Token Creature — Illusion", "you", { power: 1, toughness: 1, token: true }));
  put(card("Octopus Form", "Enchantment", "you"));
  put(card("The Theorist, Jace Beleren", "Legendary Planeswalker — Jace", "you", { loyalty: 4 }), { counters: { loyalty: 4 } });
  g.libraries["you"] = filler("you", 46, "library");
  g.graveyards["you"] = [card("Negate", "Instant", "you", { id: "you:g1" }), card("Aetherize", "Instant", "you", { id: "you:g2" })];

  // 相手: 手札 5 枚、土地 2 枚 (タップ)、クリーチャー 3 体 (1 体がブロック中、1 体にダメージ 1)
  for (let i = 1; i <= 5; i++) g.hands["opp"].push(card(`opp-hand-${i}`, "Instant", "opp"));
  for (let i = 1; i <= 2; i++) put(card("Mountain", "Basic Land — Mountain", "opp", { id: `opp:Mountain${i}` }), { tapped: true });
  put(card("Goblin Raider", "Creature — Goblin", "opp", { power: 2, toughness: 2 }), { blocking: "you:Brineborn Cutthroat" });
  put(card("Cinder Warrior", "Creature — Human Warrior", "opp", { power: 3, toughness: 2 }), { damage: 1 });
  put(card("Young Drake", "Creature — Dragon", "opp", { power: 2, toughness: 2 }));
  g.libraries["opp"] = filler("opp", 47, "library");
  g.graveyards["opp"] = [card("Shock", "Instant", "opp", { id: "opp:g1" }), card("Lava Axe", "Sorcery", "opp", { id: "opp:g2" })];

  g.step = "combat";
  g.combatPhase = "blockers";
  g.turn = 5;
  g.active = "you";
  g.priority = "you";
  g.life = { you: 20, opp: 15 };
  g.mana["you"] = 1;
  g.pool["you"] = { U: 1 };
  g.log.push("あなたが島をタップして {U} を出した", "あなたが Geist of Saint Thalia で攻撃した", "あなたが Brineborn Cutthroat で攻撃した", "あなたが Elementalist Adept で攻撃した", "相手が Goblin Raider でブロックした");
  return { game: g, rules: { get: () => undefined } };
}

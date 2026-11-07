import assert from "node:assert";
import { castSpell, passPriority } from "../src/battle/engine";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { RuleBook, createGame } from "../src/battle/state";
import { toGameCard } from "../src/battle/deckToGame";
import { pickTokenArt } from "../src/battle/tokenArt";

resetRegistry();
registerBuiltinNodes();

const list = [
  { name: "Zombie", typeLine: "Token Creature — Zombie", power: "2", toughness: "2", art: "zombie.png" },
  { name: "Food", typeLine: "Token Artifact — Food", art: "food.png" },
  { name: "Zombie Army", typeLine: "Token Creature — Zombie Army", power: "0", toughness: "0", art: "army.png" },
  { name: "Noart", typeLine: "Token Creature — Bird", power: "1", toughness: "1" },
];
assert.equal(pickTokenArt(list, "Food", "Token Artifact — Food"), "food.png", "名前が同じ");
assert.equal(pickTokenArt(list, "zombie", "Creature — Zombie", 2, 2), "zombie.png", "名前は大文字小文字を問わない");
assert.equal(pickTokenArt(list, "Rotting Walker", "Creature — Zombie", 0, 0), "army.png", "サブタイプが同じで、パワー・タフネスも合うもの");
assert.equal(pickTokenArt(list, "Rotting Walker", "Creature — Zombie", 2, 2), "zombie.png");
assert.equal(pickTokenArt(list, "Bird", "Creature — Bird", 1, 1), undefined, "絵の無いものは選ばない");
assert.equal(pickTokenArt(list, "Goblin", "Creature — Goblin"), undefined, "何も重ならない");
assert.equal(pickTokenArt(undefined, "Food", "Artifact — Food"), undefined);
// 作ったトークンは、作った人のデッキのトークンの絵になる
{
  const book: RuleBook = { get: (c) => (c === "Maker" ? { card: c, abilities: [{ kind: "spell", body: [{ node: "createToken", args: { name: "Zombie", types: "Creature — Zombie", power: 2, toughness: 2 } }] }] } : undefined) };
  const g = createGame(["A", "B"]);
  g.active = "A"; g.step = "main1"; g.priority = "A";
  g.tokenArt = { A: list, B: [] };
  g.hands["A"].push({ id: "Maker", name: "Maker", typeLine: "Sorcery", mv: 0, owner: "A" });
  castSpell(g, "A", "Maker", {}, book);
  for (let i = 0; g.stack.length && i < 20; i++) passPriority(g, g.priority!, book);
  assert.equal(g.battlefield.find((p) => p.card.token)?.card.art, "zombie.png");
}
// デッキで選んだ版の絵は、GameCard に載る
assert.equal(toGameCard({ name: "Bolt", typeLine: "Instant", cmc: 1, manaCost: "{R}", colors: ["R"], art: "bolt.png" }, "x", "A").art, "bolt.png");
// 絵違い・フォイルは、GameCard にそのまま載る (山札では、行ごとの絵・フォイルのカードが入る)
{
  const a = toGameCard({ name: "Island", typeLine: "Basic Land — Island", cmc: 0, manaCost: "", colors: [], art: "a.png", foil: true }, "i1", "A");
  assert.equal(a.art, "a.png");
  assert.equal(a.foil, true);
  assert.equal(toGameCard({ name: "Island", typeLine: "Basic Land — Island", cmc: 0, manaCost: "", colors: [] }, "i2", "A").foil, undefined);
}
console.log("battle-tokenart ok");

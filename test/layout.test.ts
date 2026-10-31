import assert from "node:assert";
import { groupOf, groupRank } from "../src/layout";

// 見出しの並び: Commander → Planeswalker → Creature → Sorcery → Instant → Artifact → Enchantment → Land
const types = ["Basic Land — Swamp", "Instant", "Legendary Creature — Human", "Artifact", "Sorcery", "Planeswalker — Jace", "Enchantment", "Artifact Land"];
const order = types.map((t) => groupOf(t)).sort((a, b) => groupRank(a) - groupRank(b));
assert.deepEqual(order, ["Planeswalker", "Creature", "Sorcery", "Instant", "Artifact", "Enchantment", "Land", "Land"]);
assert.equal(groupOf("Legendary Creature", true), "Commander");
assert.ok(groupRank("Commander") < groupRank("Planeswalker"));

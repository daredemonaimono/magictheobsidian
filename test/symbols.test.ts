import assert from "node:assert";
import { manaCodes, symbolUrl } from "../src/symbols";

// マナコスト → シンボルのコード (混成のスラッシュを除く)
assert.deepEqual(manaCodes("{2}{W/U}{G}"), ["2", "WU", "G"]);
assert.deepEqual(manaCodes("{X}{R}{R}"), ["X", "R", "R"]);
assert.deepEqual(manaCodes(""), [], "土地など、コストが無いカード");
assert.equal(symbolUrl("WU"), "https://svgs.scryfall.io/card-symbols/WU.svg");

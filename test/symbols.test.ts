import assert from "node:assert";
import { manaCodes, symbolSrc } from "../src/symbols";

// マナコスト → シンボルのコード (混成のスラッシュを除く)
assert.deepEqual(manaCodes("{2}{W/U}{G}"), ["2", "WU", "G"]);
assert.deepEqual(manaCodes("{X}{R}{R}"), ["X", "R", "R"]);
assert.deepEqual(manaCodes(""), [], "土地など、コストが無いカード");
assert.ok(symbolSrc("WU")?.startsWith("data:image/svg+xml"), "埋め込んだ SVG。通信しない");
assert.equal(symbolSrc("NOPE"), undefined, "無いシンボルは、画像にしない (文字で出す)");

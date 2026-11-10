import assert from "node:assert";
import { frameClass } from "../src/battle/frame";

assert.equal(frameClass({ typeLine: "Creature — Bat", manaCost: "{1}{B}" }), "f-B");
assert.equal(frameClass({ typeLine: "Instant", manaCost: "{R}{W}" }), "f-M", "多色は金");
assert.equal(frameClass({ typeLine: "Instant", manaCost: "{2}{R/W}" }), "f-M", "混成も、両方の色");
assert.equal(frameClass({ typeLine: "Creature — Rat", colors: ["B"] }), "f-B", "トークンなど、コストが無くても、色で決まる");
assert.equal(frameClass({ typeLine: "Artifact — Treasure" }), "f-art");
assert.equal(frameClass({ typeLine: "Artifact Creature — Golem", manaCost: "{3}" }), "f-art");
assert.equal(frameClass({ typeLine: "Creature — Eldrazi", manaCost: "{3}" }), "f-C");
assert.equal(frameClass({ typeLine: "Basic Land — Mountain" }), "f-land f-R");
assert.equal(frameClass({ typeLine: "Land — Mountain Plains" }), "f-land f-M");
assert.equal(frameClass({ typeLine: "Land — Town" }), "f-land");
assert.equal(frameClass({ typeLine: "Basic Land — Mountain", manaCost: "" }), "f-land f-R", "土地は、色の欄より、土地タイプ");
assert.equal(frameClass({ typeLine: "Basic Land — Island", frame: "1997" }), "f-land f-U f-old", "古い枠の土地");
assert.equal(frameClass({ typeLine: "Basic Land — Island", frame: "2015" }), "f-land f-U", "新しい枠の土地");
assert.equal(frameClass({ typeLine: "Creature — Bat", manaCost: "{1}{B}", frame: "1997" }), "f-B", "土地以外は、古い枠でも、ふつうの枠");
console.log("battle-frame ok");

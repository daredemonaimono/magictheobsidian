import assert from "node:assert";
import { fetchCollection, fetchPrintings, searchCards } from "../src/scryfall";

// Scryfall に実際に問い合わせる
const { data, failed } = await fetchCollection(["bba5ea18-4e58-42a8-b613-2178706476a6", "91fdb56b-54d5-4272-8319-505ff987fe9b"]);
assert.equal(failed, 0);
assert.equal(data.length, 2);
assert.equal(data.find((c) => c.name === "Sol Ring")?.legalities?.vintage, "restricted");
assert.ok(data[0].prices && "usd" in data[0].prices);

const jace = await searchCards("jace");
assert.ok(jace.length > 5 && jace.some((c) => c.name === "Jace Beleren"));
assert.deepEqual(await searchCards("zzzzqqqq"), [], "該当なしは空");

const prints = await fetchPrintings(data[1] , "en");
assert.ok(prints.length > 10 && prints.every((p) => p.id && p.set && p.lang));

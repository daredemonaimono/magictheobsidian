import assert from "node:assert";
import { EditSessions, freeName, parseVersion, sortNewestFirst, versionName } from "../src/battle/history";

// 履歴のファイル名: 日時 (ローカル時刻) と種類
assert.equal(versionName(new Date(2026, 10, 5, 15, 30, 12), "ai"), "2026-11-05-153012-ai.md");
assert.equal(versionName(new Date(2026, 0, 2, 3, 4, 5), "edit"), "2026-01-02-030405-edit.md");
assert.deepEqual(parseVersion("2026-11-05-153012-ai.md"), { stamp: "2026-11-05-153012", kind: "ai" });
assert.deepEqual(parseVersion("2026-11-05-153012-restore-2.md"), { stamp: "2026-11-05-153012", kind: "restore" }, "同じ秒の重複は -2 などが付く");
assert.equal(parseVersion("memo.md"), null);
assert.equal(parseVersion("2026-11-05-153012-unknown.md"), null, "知らない種類は履歴ではない");

// 同じ秒に2つできるとき: 空いている名前にする
const t = new Date(2026, 10, 5, 15, 30, 12);
assert.equal(freeName(t, "ai", new Set()), "2026-11-05-153012-ai.md");
assert.equal(freeName(t, "ai", new Set(["2026-11-05-153012-ai.md"])), "2026-11-05-153012-ai-2.md");
assert.equal(freeName(t, "ai", new Set(["2026-11-05-153012-ai.md", "2026-11-05-153012-ai-2.md"])), "2026-11-05-153012-ai-3.md");

// 新しい順。知らないファイルは入れない
assert.deepEqual(sortNewestFirst(["2026-11-05-100000-ai.md", "x.md", "2026-11-06-090000-edit.md", "2026-11-05-153012-restore.md"]), ["2026-11-06-090000-edit.md", "2026-11-05-153012-restore.md", "2026-11-05-100000-ai.md"]);

// 手で直したとき: 連続した編集 (5分以上あかない間) は、最初の1回だけ新しい版にする
const s = new EditSessions(5 * 60 * 1000);
const T = 1_000_000;
assert.equal(s.note("A", T), true, "最初の編集");
assert.equal(s.note("A", T + 60_000), false, "1分後は同じ編集の続き");
assert.equal(s.note("A", T + 60_000 + 4 * 60_000), false, "最後の編集から4分後は続き");
assert.equal(s.note("A", T + 60_000 + 4 * 60_000 + 5 * 60_000), true, "最後の編集から5分あいたら、新しい編集");
assert.equal(s.note("B", T + 61_000), true, "別のカードは別");

// AI の作り替えや版を戻した直後は、手の編集のまとめを切る (その直後の編集で、AI が作ったままの版が履歴に残るように)
const r = new EditSessions(5 * 60 * 1000);
assert.equal(r.note("A", T), true);
assert.equal(r.note("A", T + 60_000), false);
r.reset("A");
assert.equal(r.note("A", T + 120_000), true, "reset のあとは、新しい編集として扱う");
assert.equal(r.note("B", T + 120_000), true);

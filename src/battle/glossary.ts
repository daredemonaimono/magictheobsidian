// AI への用語集 (基本の定義)。AI が「パーマネントは何を指すか」「どの文が誘発型か」で迷わないように、指示文に載せる。
// カードのテキスト (オラクルテキスト) もノードの名前も英語なので、用語集も英語にする。ただし、能力の見出し (## 誘発型能力 など) は md の書式なので日本語のまま。
// vault の Rules/_glossary.md があれば、既定のかわりにその内容を載せる (コマンド「Battle: create glossary note」で、既定から作れる)
export const GLOSSARY_NOTE = "_glossary.md";
export const OLD_GLOSSARY_NOTE = "_用語.md"; // 以前の名前。_glossary.md が無いときだけ読む

export const DEFAULT_GLOSSARY = `### Permanents
- A permanent is a card (or token) on the battlefield. Its types are artifact, creature, enchantment, land, planeswalker and battle. "Permanent" refers to all of them (target kind=permanent); narrow it by type with type=creature. "Nonland permanent" is notType=land.
- Creature, artifact, enchantment, land, planeswalker and battle are each a subset of permanent.
- These are NOT permanents: cards that are not on the battlefield (hand, graveyard, library, exile), spells and abilities on the stack (a spell is kind=spell), counters (e.g. +1/+1 counters) and emblems.

### Telling abilities apart
- Triggered ability: a clause containing "When", "Whenever" or "At" (Japanese: 〜とき / 〜たび / 〜の時に), e.g. "When this creature enters", "Whenever you cast", "At the beginning of". Write it under \`## 誘発型能力\` with \`when\`.
- Activated ability: "cost: effect" (it has a colon). Keywords such as Equip {N} are also activated abilities. Write it under \`## 起動型能力\` with \`cost\`.
- Static ability: a sentence that states a fact or a state ("gets", "has", "can't", "costs {1} less") and is none of the above. Write it under \`## 常在型能力\`.
- Spell ability: the text of an instant or sorcery. An Aura's "Enchant …" is a targeted spell ability (target + attach); its effect goes in a static ability.
- "Enchanted …" / "Equipped …" means the permanent it is attached to (\`affect who=attached\`).

### Planeswalkers, tokens, emblems
- A planeswalker's loyalty ability ("+1: …", "−2: …", "−X: …") is an activated ability whose cost is loyalty counters: \`cost loyalty=1\`, \`cost loyalty=-2\`, \`cost loyaltyX=true\`. Loyalty is a kind of counter (it is not a permanent).
- Surveil N: look at the top N cards, put any number of them into the graveyard, and leave the rest on top (look → choose atMost=true → move to graveyard).
- A token is a permanent that ceases to exist when it leaves the battlefield. An emblem is not a permanent; it stays outside the battlefield for the rest of the game.

### Other
- "you" is the controller of the spell or ability (who=you / controller=you); "opponent" is opponents.
- "until end of turn" is duration=endOfTurn.`;

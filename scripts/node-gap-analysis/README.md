# 人気カードの効果と、ノードの対応状況 (分析スクリプト)

人気のカードの効果を、いまのノードで書けるか、分類して、足りない効果を人気順に並べる。結果は、`docs/node-gap-analysis.md`。

```
python3 scripts/node-gap-analysis/fetch.py    /tmp/cards.json            # Scryfall から人気順に集める (統率戦・モダン・スタンダード・レガシー)
python3 scripts/node-gap-analysis/classify.py /tmp/cards.json /tmp/out.json   # 効果を分類する (パターンの表は classify.py の T)
python3 scripts/node-gap-analysis/report.py   scripts/node-gap-analysis/classify.py /tmp/out.json docs/node-gap-analysis.md
```

- 「書ける・一部だけ・書けない」の判定は、`classify.py` の表 T に、手で書いてある。ノードを足したら、その行の状態 (`no` → `ok`) を直して、もう一度回す。
- 分類は、文字のパターン。おおまかな見積もり。

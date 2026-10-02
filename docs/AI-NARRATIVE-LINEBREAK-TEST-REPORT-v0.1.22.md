# レース展開文の改行指示 試験成績書 v0.1.22

実施日: 2026-10-02 JST

## 結果

| 試験 | 結果 | 証拠 |
|---|---|---|
| 基本プロンプトにまとまりごとの空行指示を追加 | 合格 | `ai-generation` mockでGeminiへのsystem instructionを確認 |
| 段落数・空行回数を固定しない | 合格 | `ai-p2-input`と`ai-contract`で固定制約がないことを確認 |
| 出力契約で空行なし・複数段落を許容 | 合格 | 既存出力契約試験で確認 |
| CSS `pre-line`で空行が表示される | 合格 | Playwright/Edgeで本文高さが3行分となることを確認 |
| 実Gemini生成で空行位置を確認 | 未実施 | 実API呼び出しなし |

実行結果: `ai-p2-input.test.mjs` と `ai-contract.test.mjs` は29/29合格。`ai-generation.test.mjs` の有効初回応答ケースで送信指示を確認。ブラウザはPlaywright/Edgeの既存UI smokeで合格。実Gemini APIの呼び出しは行っていない。

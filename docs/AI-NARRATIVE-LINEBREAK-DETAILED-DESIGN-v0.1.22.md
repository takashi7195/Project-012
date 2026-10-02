# レース展開文の改行指示 詳細設計書 v0.1.22

関連: [基本設計書](AI-NARRATIVE-LINEBREAK-BASIC-DESIGN-v0.1.22.md) / [試験成績書](AI-NARRATIVE-LINEBREAK-TEST-REPORT-v0.1.22.md)

## 変更箇所

| ファイル | 変更 |
|---|---|
| `race-prediction/ai-prompt.mjs` | `BASE_PROMPT_TEXT`へ「読みやすいまとまりごとに、空行を1行入れてください。」を1文追加 |
| `race-prediction/ai-config.mjs` | `promptVersion`を`ai-bundle-prompt-4`に更新 |
| `race-prediction/ai-p2-input.test.mjs`、`ai-contract.test.mjs` | 改行指示の存在と段落数・文字数制約を追加していないことを確認 |

## 生成・再利用への影響

`hashAiConfig`は設定と基本プロンプト本文のhashを含める。本文の変更とpromptVersion更新で生成設定hashが変わり、同一レース・同一データでも旧指示で保存した結果を新指示の生成結果として再利用しない。

出力検証はJSON構造、買い目、空でない展開文を確認する。空行の有無・回数・段落数・展開文文字数は検証しない。既存の500文字前後は目安のまま。`maxOutputTokens`と総生成時間設定は変更しない。

## 合格条件

基本プロンプトに改行指示が含まれ、段落数や改行位置を固定する指示がない。既存の出力契約が改行の有無で失敗しない。

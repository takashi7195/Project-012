# 本文可読性の統一 試験成績書 v0.1.22

実施日: 2026-10-02 JST

## 結果

| 項目 | 結果 | 証拠 |
|---|---|---|
| レース展開本文が16px・500・1.6・`#172235`・上下余白0 | 合格 | Playwright/Edge計算済みスタイル検証 |
| ユーザーコメント本文が16px・500・1.6・`#172235`・上下余白0 | 合格 | Playwright/Edge計算済みスタイル検証 |
| AIタカシ返信本文が16px・500・1.6・`#172235`・上下余白0 | 合格 | Playwright/Edge計算済みスタイル検証 |
| 既存フォント候補順を維持 | 合格 | 3要素の計算済みフォントスタック検証 |
| 改行・空白・長文折り返し | 合格 | レース/返信`pre-line`、コメント`pre-wrap`、3要素`overflow-wrap:anywhere`を計算済みスタイルで確認 |
| ローカルWebブラウザ表示 | 合格 | 既存UI smokeで表示・画面幅・生成状態を確認 |

実行: Windows Node.jsのPlaywright/Edgeを使用して `tools/local-integration/ai-ui-browser-smoke.cjs` を実行。計算済みスタイルは3要素すべてで16px・500・25.6px行高、文字色`rgb(23, 34, 53)`、上下margin 0、`overflow-wrap:anywhere`。フォント候補も共通スタックを継承し、改行指定はレース展開/AI返信が`pre-line`、ユーザーコメントが`pre-wrap`であることを確認。UI smokeは320/375/390/430/768/1280px幅で合格。Supabase/Gemini等の外部通信はモックまたは遮断。

## 対象外

公開URL、iOS Safari実機、Android実機の確認はこのローカル確認に含めない。

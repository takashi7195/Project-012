# 本文可読性の統一 詳細設計書 v0.1.22

関連: [基本設計書](READABLE-TEXT-BASIC-DESIGN-v0.1.22.md) / [試験成績書](READABLE-TEXT-TEST-REPORT-v0.1.22.md)

## CSS設計

対象ファイルは `ui-reference.css`。`.reference-ui` の既存フォントスタックを維持し、本文要素は継承する。

| CSS対象 | font-size | font-weight | line-height | color | margin |
|---|---:|---:|---:|---|---:|
| `.race-development p` | 16px | 500 | 1.6 | `#172235` | `0` |
| `.comment-text` | 16px | 500 | 1.6 | `#172235` | `0` |
| `.reply-text` | 16px | 500 | 1.6 | `#172235` | `0` |

レース展開とAIタカシ返信は `pre-line`、ユーザーコメントは `pre-wrap` とする。3種類すべてに `overflow-wrap:anywhere` を設定し、長いURL等が横にはみ出すのを防ぐ。`pre-line`では明示した改行を残しながら連続空白を詰め、`pre-wrap`では改行・連続空白を保つ。

HTML/CSSのキャッシュ識別子を `v0.1.22-readable-text1` に更新し、ブラウザが新しいCSSを取得できるようにする。表示領域の幅と改行指定は保つ。

## 合格条件

ローカルブラウザの計算済みスタイルで3対象すべてに同じフォントファミリー、16px、500、1.6が適用され、本文が表示されること。既存UI smokeが通ること。外部サービスへの接続は不要。

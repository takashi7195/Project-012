# 本文可読性の統一 詳細設計書 v0.1.22

関連: [基本設計書](READABLE-TEXT-BASIC-DESIGN-v0.1.22.md) / [試験成績書](READABLE-TEXT-TEST-REPORT-v0.1.22.md)

## CSS設計

対象ファイルは `ui-reference.css`。`.reference-ui` の既存フォントスタックを維持し、本文要素は継承する。

| CSS対象 | font-size | font-weight | line-height |
|---|---:|---:|---:|
| `.race-development p` | 16px | 500 | 1.6 |
| `.comment-text` | 16px | 500 | 1.6 |
| `.reply-text` | 16px | 500 | 1.6 |

HTML/CSSのキャッシュ識別子を `v0.1.22-readable-text1` に更新し、ローカルブラウザが新しいCSSを取得できるようにする。表示領域の幅、折り返し、既存のwhite-space指定、色、余白は保つ。

## 合格条件

ローカルブラウザの計算済みスタイルで3対象すべてに同じフォントファミリー、16px、500、1.6が適用され、本文が表示されること。既存UI smokeが通ること。外部サービスへの接続は不要。

# スマートフォン本文の太字調整 詳細設計書 v0.1.23

## 対象ファイル

- `ui-reference.css`
- `index.html`（CSSキャッシュ更新用クエリ）

## 実装

- 既存の`@media (max-width: 430px)`内で`.race-development p`、`.comment-text`、`.reply-text`に`font-weight: 600`を指定する。
- 対象本文は純黒`#000000`を継続する。
- デスクトップとその他のフォント設定は維持する。

## 制約

レイアウト、フォントサイズ、行間、改行、背景、機能を変更しない。

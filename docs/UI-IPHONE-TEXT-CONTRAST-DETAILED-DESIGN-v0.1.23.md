# スマートフォン本文コントラスト調整 詳細設計書 v0.1.23

## 対象ファイル

- `ui-reference.css`
- `index.html`（CSSキャッシュ更新用クエリ）

## 実装

- `@media (max-width: 430px)`内で`.reference-ui .race-development p`、`.reference-ui .comment-text`、`.reference-ui .reply-text`を`color: #000000`にする。
- 既存のデスクトップ色`#111111`と他のCSS宣言は維持する。
- CSSキャッシュクエリを更新する。

## 制約

レイアウト、機能、背景、投稿者情報、見出し、操作部品は変更しない。

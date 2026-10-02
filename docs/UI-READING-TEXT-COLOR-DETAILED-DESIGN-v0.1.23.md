# 展開文・コメント本文の文字色調整 詳細設計書 v0.1.23

## 対象ファイル

- `ui-reference.css`
- `index.html`（CSSキャッシュ更新用クエリ）

## 実装内容

- `.reference-ui .race-development p`、`.reference-ui .comment-text`、`.reference-ui .reply-text`の`color`を`#111111`に変更する。
- 3つの本文は同じ文字色を共有する。
- 他のプロパティ、セレクター、HTML構造は変更しない。

## 制約

文字色以外の表示仕様、API、DB、コメント機能、公開設定は変更しない。

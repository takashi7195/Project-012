# UI白枠の透過率調整 詳細設計書 v0.1.23

## 対象ファイル

- `style.css`
- `ui-reference.css`
- `index.html`（CSSキャッシュ更新用クエリのみ）

## 実装

- 共通フレーム `.container` を白色85%不透明にする。
- 実画面で優先適用される`.game-panel`、`.selectors`、`.prediction-row`、`.race-development`、`.comments-section`、`.comment-heading`の背景を不透明度85%にする。グラデーションは各色のアルファ値をそろえる。
- 青みを含む現行の各色相は維持する。
- 枠線や影は変更しない。
- ボタン、セレクト入力、コメント入力、艇番、ラベル、返信シートの背景は対象外とする。

## 制約

CSS以外のHTML、JavaScript、DB、API、公開設定を変更しない。寸法・レイアウト・文字色は変更しない。

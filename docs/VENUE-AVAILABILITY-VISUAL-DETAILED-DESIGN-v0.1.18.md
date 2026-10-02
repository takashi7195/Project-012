# v0.1.18 会場開催状態の視認性 詳細設計書

作成日: 2026-09-25 JST
状態: 実装前設計
関連基本設計: [会場開催状態の視認性 基本設計書](VENUE-AVAILABILITY-VISUAL-BASIC-DESIGN-v0.1.18.md)

## 1. 現行構成

- `script.js`が当日の開催データから会場optionの`disabled`と`data-available`を設定している。
- 会場名は既存optionのデータ属性から取得し、全optionで会場名だけを表示する。
- `ui-reference.css`には選択不可option用の文字色・背景色指定がある。
- 今回は選択肢の視覚差だけを扱い、開催情報取得や状態判定は変更しない。

## 2. 表示ルール

| 状態 | 表示 | 選択可否 |
|---|---|---|
| 開催中 | 現行の太さを維持し、通常の濃い文字色で会場名だけを表示 | 現行どおり選択可能 |
| 選択不可 | 現行の太さと背景色を維持し、文字色だけをグレーにする | 現行どおり`disabled` |

選択不可optionには状態語を追加しない。状態の見分けを色だけに依存させず、disabledの意味を支援技術・ブラウザへ伝える既存のHTML状態も維持する。

## 3. 実装方針

`ui-reference.css`の会場optionに対する既存セレクタで開催中と選択不可の文字色を区別する。全optionの表示文字列は会場名だけとする。font-weight、背景色、その他の装飾は変更しない。ルールは会場optionに限定する。

ネイティブ`select`/`option`はOS・ブラウザが描画するため、option背景色等が反映されない環境があり得る。カスタムプルダウンや追加ライブラリは導入せず、対象ブラウザで実際に開いた一覧を確認する。現在の`disabled`属性と`data-available`を表示条件の唯一の根拠とし、新しいJavaScript状態・API・データ属性は追加しない。

### 変更禁止

- `.selectors`および`select`の幅、最小幅、最大幅、flex配分
- padding、height、gap、margin、border、radius、font-size、font-weight、背景色
- 会場optionの文言、順序、選択状態
- `applyStadiumAvailability()`、開催情報更新、締切判定
- レースoption、ルーレット、他の予想表示

## 4. テストと画面確認

1. 開催中optionが現在どおり有効で会場名だけを表示する。
2. 選択不可optionが`disabled`のままで、文字色だけが状態別に変わり、背景色は実装前と同じである。
3. 開催中と選択不可の表示ルールが同一optionへ重複適用されない。
4. 北から南の会場順、選択可否、会場名が既存テストで維持される。
5. ブラウザで会場プルダウンを開き、開催中とグレーアウト状態を視覚的に区別できる。
6. 同じ画面幅で実装前後を比較し、選択欄寸法、行間、周囲の色、レース欄に差がない。

## 5. 受け入れ条件

- 対象UIテストと全Node回帰テストが成功する。
- `git diff --check`が成功する。
- 実ブラウザのnative selectで識別性を確認する。
- 差分が会場optionの状態別視認性と必要なテストだけに限定されている。

## 6. 追補：開催中ラベルの取り下げ

2026-10-02追補。開催中optionは会場名だけに戻す。選択不可optionも会場名だけを表示し、既存の`disabled`属性を維持する。`value`、`data-stadium-name`、optionの順番、開催判定は変更しない。`aria-label`はoptionの会場名と一致させる。

受入れ確認: すべてのoptionが会場名だけを表示する。会場のvalue/codeと選択可否は既存と同じ。`race-prediction/stadium-selection.test.mjs`を実行し、iPhone Safariの実表示は公開後に端末で確認する。

## 7. 追補：開催中会場の太字表示試験

- `option[data-available="true"]`に`font-weight: 700`を指定する。
- 選択不可optionの色・背景・disabled状態は変更しない。
- 会場optionの文言、開催判定、会場選択後の表示は変更しない。
- CSSのバージョン付きURLを更新し、端末が新しいスタイルを取得できるようにする。
- CSS契約テストと会場選択テストを実行する。iPhone 13 mini SafariおよびXperia Ace 3でプルダウンを開き、開催中会場の太さが通常会場と見分けやすくなったか確認する。
- 改善がなければこの試験用CSS指定だけを取り消す。試験変更を独立コミットとして公開する。

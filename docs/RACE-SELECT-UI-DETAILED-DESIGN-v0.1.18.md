# v0.1.18 レース選択UI 詳細設計書

作成日: 2026-09-25 JST
状態: 実装済み・幅調整反映
関連基本設計: [レース選択UI基本設計書](RACE-SELECT-UI-BASIC-DESIGN-v0.1.18.md)

## 1. 現行構成と確認事項

- `index.html`の`#race-select`は1R〜12Rの固定optionを持つネイティブ`select`。
- `script.js`の`applyRaceAvailability()`が、選択会場の取得済みレース情報と`closedAt`から締切前後を判定し、optionのdisabled状態と表示文言を更新する。
- 締切時刻は`formatJstTime()`で`Asia/Tokyo`表示にしている。
- 現行ラベルは締切前が`${raceLabel} | ${time} 締切予定`、締切済みが`${raceLabel} | 締切`。
- `ui-reference.css`の`.selectors`は幅64%、最小220px、最大280pxで、2つのselectを概ね等分している。時刻付きラベルは閉じた欄で切れる場合があるため、ラベルから`|`を除き全角スペースを使う。選択欄幅は従来値を維持する。

## 2. 変更対象と責務

| ファイル | 責務 | 設計変更 |
|---|---|---|
| `script.js` | レースoptionの表示文字列 | `|`を除き、レース番号と締切表示の間に全角スペース1文字を入れる。`aria-label`は読み上げやすい文言にする。 |
| `ui-reference.css` | 会場・レース選択欄の幅と文字サイズ | 幅64%・最小220px・最大280pxと均等配分を維持する。 |
| `index.html` | セレクタの構造と公開版 | ネイティブselectと既存IDを維持する。公開versionをv0.1.18へ上げ、JS/CSSのcache-busterを更新する。 |

DB、API、Edge Function、締切の判定ロジックは変更しない。`index.html`では選択UIのDOM構造を変えず、公開versionとJS/CSSのcache-busterのみを更新する。

## 3. option表示生成

`applyRaceAvailability(stadiumCode, now)`の既存処理を維持し、ラベル組み立てだけ変更する。

```text
raceLabel = `${raceNumber}R`
separator = `　`  // U+3000 IDEOGRAPHIC SPACE 1文字

open:
  visible label = `${raceLabel}${separator}${formatJstTime(deadline)} 締切予定`
closed / unavailable:
  visible label = `${raceLabel}${separator}締切`
```

例:

- `3R　10:00 締切予定`
- `11R　20:08 締切予定`
- `1R　締切`

`|`や追加状態語（「締切前」「受付中」等）は表示しない。optionの`value`（`1R`〜`12R`）、生成順、disabled状態、`data-available`、選択済み締切時の選択解除、予想表示クリアは現行どおり。

`aria-label`は、視覚用ラベルの空白を不自然に読み上げないよう、選択肢状態を保った自然な文字列を使う。締切前は例として`11R、20:08 締切予定`、締切済みは`1R、締切`とする。時刻を取得できない場合は締切済み扱いの現在挙動を維持する。

## 4. レイアウト

`.selectors`は元の`width: 64%; min-width: 220px; max-width: 280px`を維持する。会場とレースのselectは従来どおり均等幅とし、欄の幅や配分を変更しない。

selectの文字サイズ20px、従来のpaddingを維持する。選択肢ラベル内の全角スペースでレース番号と締切情報を区切る。

ネイティブselectのoptionはOS・ブラウザごとに描画差があるため、option内に複数列を作ったり、CSS Grid/Flexのoption装飾へ依存したりしない。全角スペースを区切りとして使い、視覚的な間隔を確保する。select閉状態では選択ラベルがellipsisで状態や時刻を隠さないよう、欄幅・文字サイズを調整する。

## 5. アクセシビリティ

- `aria-label="レース"`を維持する。
- 各optionのaccessible nameにはレース番号と締切状態・時刻を含める。
- 選択可能性は既存のdisabled属性で表現し、見た目だけで選択禁止にしない。
- キーボード操作とネイティブselectの選択操作を維持する。

## 6. テスト設計

### 自動テスト

既存の`race-prediction/stadium-selection.test.mjs`を更新する。

- 締切前ラベルが`11R　20:08 締切予定`相当であり、`|`を含まない。
- 締切済みラベルが`1R　締切`相当であり、`|`を含まない。
- U+3000区切りが1個使われる。
- `aria-label`は時刻と状態を含み、読める自然な区切りを使う。
- 1R〜12R順、締切前後のdisabled、締切日時のJST表示、締切済み選択解除の既存テストを維持する。
- レースoptionのvalueとイベント契約が変わらない。

### 画面確認

GitHub Pages相当のローカル表示で、幅320px、375px、390pxおよびデスクトップで確認する。

- 選択欄に`11R`と`20:08 締切予定`の両方が表示され、区切り記号がない。
- 締切済みの`1R　締切`も見切れない。
- 会場名が切れず、会場・レース選択欄が重ならず、横スクロールが発生しない。
- プルダウンを開いたoption表示でも番号・締切情報が読める。

## 7. 受け入れ条件

基本設計書の完了条件に加え、少なくとも自動テスト全件成功、`git diff --check`成功、狭幅画面での表示確認を満たす。締切前選択肢の値・選択後のSTART判定・予想API payloadは変更されない。

## 8. 変更しない契約

- JST日付と`closedAt`の解釈
- 締切境界（現在時刻が締切時刻以上なら締切済み）
- レース選択肢の1R→12R順と、締切済み選択肢を残す仕様
- API取得、60秒締切再判定、5分開催情報再取得
- 選択初期値、選択変更時の予想結果クリア
- START有効条件および予想生成
- 本命・対抗・穴の算出・表示

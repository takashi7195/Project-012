# トップページ表示調整 詳細設計書 v0.1.20

作成日: 2026-10-01 JST
状態: レース欄の番号のみ表示（A案）を実装済み。公開反映済み。

関連: [基本設計](TOP-PAGE-FIX-BASIC-DESIGN-v0.1.20.md)、[試験仕様](TOP-PAGE-FIX-TEST-SPEC-v0.1.20.md)

## 1. 現行実装の確認結果

- index.html: #site-titleにタイトル文字列だけがある。ai-takashi-avatar.pngは既存画像として存在する。
- ui-reference.css: タイトルはwhite-space: nowrap。会場・レース欄の親は幅64%、最小220px、最大280pxで、selectは等分される。
- script.js: applyRaceAvailability()でoption.textContentへ番号・全角空白1文字・時刻・締切予定を設定する。aria-labelにも締切情報がある。
- index.html: #race-development-textに指摘された例文が直書きされている。
- script.js: clearPredictionDisplay()が本文を消去し、生成成功時にtextContentへ展開文を代入している。

## 2. タイトルの変更設計

index.htmlのh1内を既存画像とタイトル文字列用spanに分ける。画像はalt=""、明示的なwidth/height付きとし、画像読み込み前も領域を確保する。

ui-reference.cssでタイトルをflex配置、中央寄せ、画像と文字の間隔12pxにする。画像はflex-shrink: 0、64px角、768px以上80px角。既存画像全体をobject-fit: containで表示する。文字のnowrapを解除し、min-width: 0と折り返しを許可する。文字サイズは20〜28pxを目安にし、320px幅でも横スクロールと画像・文字の重なりがないことを試験する。

## 3. 標準selectを使った番号のみ表示

race-selectを等分幅のrace-select-shellで囲む。既存selectは全面で操作可能にし、隣接するrace-selected-label（aria-hidden、pointer-events:none）を閉じた表示として重ねる。JavaScriptで表示同期後にrace-compactクラスを付け、select本体の文字色のみtransparentにする。optionは通常色と締切色を明示し、開いた一覧には従来の全文を表示する。JavaScript無効時は重ねるラベルを非表示にして元のselectを表示する。

updateRaceSelectedLabel()は選択値から番号または「レース」を表示する。applyRaceAvailability()の選択解除後、change/input、および初期化時に同期する。締切後・会場変更・日付更新も同関数経由で同期する。フォーカス表示・disabled・ネイティブの開閉・Escapeキャンセルはselect本体が担う。重ねるラベルにはフォーカスを与えない。

optionの表示とaria-labelは従来どおり、締切前は「9R　18:52 締切予定」、締切後は「9R　締切」。親幅64%・最小220px・最大280px、均等配分・フォント・padding・矢印を維持する。高コントラスト表示ではラベルにCanvasText/GrayTextを使用する。

## 4. 展開本文

初期HTMLを `<p id="race-development-text"></p>` とする。見出し・ID・生成本文のtextContent代入は維持する。空欄を埋める代替例文は追加しない。生成処理とAI指示は変更しない。

## 5. 対象と配布

実装対象はindex.html、ui-reference.css、script.js、および対応する表示試験。CSS/JSのキャッシュ識別子を更新する。DB・Supabase Functions・AIモデルは対象外。

## 6. コメント枠とルーレット枠の幅

現行はbox-sizing: border-box。site-stack直下のgame-heroはpadding-inline: 7px、内部のgame-panelはwidth: 100%。同じsite-stack直下のcomments-sectionはwidth: 100%であり、game-panelより14px広くなる。

ui-reference.cssの.reference-uiに共通の余白値 `--panel-inline-inset: 7px` を設ける。game-heroのpadding-inlineにこの値を使用し、comments-sectionは `width: calc(100% - var(--panel-inline-inset) - var(--panel-inline-inset))` と `margin-inline: var(--panel-inline-inset)` を指定する。白い背景・枠線自体の左右端を合わせるため、comments-section内のpaddingだけを増やす方法は採らない。

ルーレット枠の外幅は現行と同じ。コメント側の内側レイアウトは狭くなった幅の中で折り返す。本文、投稿ボタン、空状態、エラー表示がはみ出さないことを試験する。共通余白値を狭幅用CSSで片側だけ上書きしない。

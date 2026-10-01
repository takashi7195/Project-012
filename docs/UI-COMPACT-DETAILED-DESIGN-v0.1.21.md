# UIコンパクト化 詳細設計書 v0.1.21

作成: 2026-10-01 JST。状態: 実装済み。ローカル試験済み。

関連: [基本設計](UI-COMPACT-BASIC-DESIGN-v0.1.21.md) / [試験仕様](UI-COMPACT-TEST-SPEC-v0.1.21.md)

## 1. 実装対象

| ファイル | 変更内容 |
|---|---|
| index.html | game-panel内のdiv.versionを削除。CSS/JSのキャッシュ識別子を更新し、透過アイコンを指定 |
| ui-reference.css | 縦余白・START・本命ラベル・状態欄・タイトル画像配置を変更。不要なversion規則を削除 |
| ai-takashi-cutout.png | 利用者提供の透過キャラクター画像をタイトル装飾として追加 |
| script.js | 解析開始・終了に応じたボタン表示と状態通知の表示先を制御 |

style.css、プレビューHTML、AI、API、DBは対象外。旧プレビュー用の.version定義は残す。

## 2. CSS変更値

既存規則を直接変更する。見本作成用の!importantは製品CSSへ追加しない。

| セレクター／属性 | 現在 | 設計値 |
|---|---|---|
| .reference-ui / padding-top | max(26px, 7.8svh) | max(13px, env(safe-area-inset-top)) |
| .game-hero / min-height | calc(65svh - max(26px, 7.8svh)) | 0 |
| .game-hero / padding-bottom | 44px | 10px |
| #site-title / margin-bottom | 18px | 10px |
| .selectors / margin-bottom | 14px | 8px |
| .game-panel / padding-top | 22px | 16px |
| .game-panel / padding-bottom | 16px | 4px |
| .favorite-label / min-height | 31px | 28px |
| .favorite-label / margin-bottom | 12px | 8px |
| #results / margin-bottom | 17px | 9px |
| #start-btn / width | 64% | min(180px, 58%) |
| #start-btn / min-height | 44px | 36px |
| #start-btn / padding | 8px 16px | 5px 12px |
| #start-btn / font-size | 22px | 18px |
| #start-btn / border-radius | 13px | 11px |
| .prediction-status / min-height | 1.5em | 0 |
| .prediction-status / margin | 2px 0 0 | 0 |

.reference-uiのpadding shorthandでは上だけを置換し、左右と下のsafe-area対応を維持する。.game-panelはpadding-top/bottomのみ変更し、左右18px、幅350px以下では左右12pxという既存規則を維持する。

.favorite-labelのmargin-top:-2px、padding:4px 11px、文字16pxは維持する。min-height:28pxでも内容とborderのため実測高さは約29.19pxとなる。STARTはline-height:1.2とborderを維持し、実測高さ36pxとなる。

## 3. サイズを維持する要素

.slotの--slot-size:clamp(72px,22.5vw,108px)、--item-height、width/height、フォント、色、角丸、#resultsのgapを変更しない。回転・停止位置の計算とCSSアニメーションも維持する。

白枠のwidth、site-stackの最大幅、--panel-inline-inset:7px、選択欄の幅64%・最小220px・最大280px、タイトル画像64/80pxを維持する。対抗・穴・展開欄・コメント欄自体のサイズや余白は変更しない。.game-heroは展開欄までを含むため、padding-bottomの削減は展開欄とコメント欄の間を縮める。

## 4. HTMLとキャッシュ

index.htmlの `<div class="version">v0.1.20</div>` のみ削除する。画面上にv0.1.21を追加しない。状態表示のp#prediction-statusはrole=statusとaria-live=politeを含めて維持する。

コンパクト化時のCSSクエリーは `?ui=v0.1.21-compact1`。タイトル配置の追加変更ではCSSクエリーを `?ui=v0.1.21-title-centered1` へ更新し、script.jsは変更せず既存の `?ui=v0.1.21-compact1` を保つ。画面のバージョン文字がなくてもリリース管理はGit・設計書・CSS識別子で行う。

## 5. 状態別レイアウトと表示制御

| 状態 | ボタン文言 | ボタン下の可視メッセージ | 高さ |
|---|---|---|---|
| 初期・選択済み・成功 | START | なし | 通知欄0px |
| 解析開始〜結果表示完了 | 解析中… | なし | 通知欄はレイアウト外 |
| 生成失敗（再試行案内あり） | START | 予想を生成できませんでした。もう一度お試しください。 | 文に合わせ自然拡張 |
| 生成失敗（再試行案内なし） | START | 予想を生成できませんでした。 | 同上 |
| 締切 | START | このレースは締切です | 同上 |

1. activePredictionによる既存の処理中判定からボタン文言を同期する。開始直後に「解析中…」とし、通信待ち・ポーリング・回転停止演出中も維持する。会場情報の取得だけでは解析中にしない。
2. 解析通知の呼び出しは、開始時とlegacyのonGeneratingの両方を対応する。setPredictionStatusに通知種別（例: progress/message）を渡し、文字列の一致だけで判定しない。通常の空文字・失敗・締切の呼び出しはmessage扱いとする。
3. progressではp#prediction-statusのrole=status/aria-live=politeと解析通知テキストを保ち、専用クラスで視覚上のみ隠す。position:absolute、width/height:1px、overflow:hidden、clip-path:inset(50%)、white-space:nowrapなどを組み合わせ、文書の高さを取らないようにする。display:noneやhidden属性は使わず、読み上げ通知を残す。
4. 空文字・失敗・締切へ変わると上記クラスを解除する。空のpはmin-height:0、margin:0で高さ0px。失敗・締切の文字が入ると従来のフォント・行高で中央表示し、自然に折り返す。固定heightやoverflowによるメッセージ切り捨てはしない。
5. 再試行時は前の可視メッセージを解析通知へ置き換え、白枠を縮める。成功・失敗・タイムアウト・中断では「START」へ復帰する。runIdによる既存の古い処理の判定を維持し、前の処理のfinallyが新しい処理の表示を戻さないようにする。
6. disabled・選択制御・買い目と展開文の消去・再試行条件・締切判定は既存の状態管理へ従う。ボタン文言の変更で押下可能性を決めない。

通常・解析中・成功時の白枠高さは375px幅で約186.56px（旧案212.56pxから予約欄24pxとmargin2pxを除いた実測値）。START下端から白枠下端は約5px（下padding4px + border1px）。失敗・締切時はメッセージの実際の行数分だけ高くなる。

## 6. 実測方法と制限

既存HTML/CSS/JSをローカルHTTPで読み込み、Edge headless・DPR1で計測。現在UIと採用案を同じDOM・同じ生成結果で比較し、getBoundingClientRectとgetComputedStyleを保存した。Supabase/Gemini/コメント通信はモックし、外部通信を遮断した。

初回の旧案計測はブラウザー内の追加CSSのみ。最新案の状態別画像はCSSとDOMの一時変更で作成した配置見本。最新案の数値は実装後に計測した。375×667pxでの要素座標はimplemented-375x667.jsonに保存。versionは計測時display:none、実装ではHTML削除とする。safe-area値は今回0。Safari実機・ピンチズーム・OS文字サイズ変更・エラー時の実際の状態遷移は未確認であり、公開URL・WebKit実機・スクリーンリーダーの確認は試験成績書に残す。

[寸法JSON](design-evidence/v0.1.21-ui-compact/measurements.json)にはブラウザー版、UTC計測日時、CSS、各要素の座標・寸法を収録。

旧案のmeasurements.jsonとproposal画像は初回測定の証拠として残し、最新仕様の合格証拠として転用しない。最新の状態別画像には合成の買い目・展開文が残るが、実装の失敗時表示は既存のクリア処理に従う。

実装はこの設計書の値に一致。単体試験33件とローカルブラウザー画面試験に合格。

## 7. 追加詳細：タイトル画像を左上装飾として配置

この追加仕様は、旧「サイズを維持する要素」のタイトル画像64/80pxという記述を置き換える。買い目・白枠・選択欄の既存幅には影響させない。

| セレクター／要素 | 設計値・挙動 |
|---|---|
| `#site-title` | `position:relative`。横幅は既存コンテンツ内。見出し領域高 `clamp(84px, 22vw, 112px)`。タイトル文字は `left:50%; top:50%; transform:translate(-50%,-50%)` で中央配置 |
| `.title-avatar` | 透過PNG `ai-takashi-cutout.png`。absolute配置、`object-fit:contain`、`border-radius:0`、クリック対象外。幅・高さ `clamp(86px, 27.2vw, 112px)`、left:-31px、top:-13px |
| 375px幅付近 | 画像左端を見出しの左側へ寄せ、見出しの外へ少しはみ出す。文字は画面中央。選択欄が画像の下に来る高さを確保 |
| 350px以下 | 画像を76×76px、left:-34px、top:-10pxへ変更。タイトル文字を18pxにし、画像と文字の領域を重ねない |
| 768px以上 | 画像は最大112px。見出し文字の中央はviewport中央。site-stackが480pxに制限されても画像はその左上に配置 |

実測に基づき、画像・文字・会場／レース選択欄が交差しないよう数値を設定済み。CSSは `.reference-ui` の中だけに限定し、他ページの`.title-avatar`規則に影響させない。見出し文字は読み上げ順でh1内に残し、画像は `alt=""` として装飾扱いにする。相対URLでリポジトリ内の `ai-takashi-cutout.png` を読み込む。

試験結果: 320/375/390/430/768/1280pxの各幅でタイトル中心がviewport中心から1px以内、画像とタイトル文字・選択欄が視覚上重ならず、`document.documentElement.scrollWidth <= viewport width + 1` をEdgeとChromeで確認。実スクリーンショットを試験成績書へ記録。Firefox自動試験とiOS Safari実機は未確認。

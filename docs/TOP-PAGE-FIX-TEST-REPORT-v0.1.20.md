# トップページ表示調整 試験成績書 v0.1.20

更新日: 2026-10-01 JST
対象: レース欄A案（閉じた欄は番号だけ、標準選択肢には締切時刻）。GitHub Pages反映済み（3c1f1e8）。

関連: [試験仕様書](TOP-PAGE-FIX-TEST-SPEC-v0.1.20.md)

| ID | 結果 | 備考 |
|---|---|---|
| UI01 | 合格 | Edgeで画像の読込、64px/80pxを再確認 |
| UI02 | 合格 | 320/375/390/430/768/1280pxで横はみ出しなし |
| UI03 | 合格 | 閉じた表示は12R、optionは時刻付き。両欄の均等幅と12Rの収まりを実測。親幅64%/220px/280pxは既存のまま |
| UI04 | 合格 | 日付・締切試験で選択解除時の番号表示も「レース」へ同期。JST日付更新と再取得を確認 |
| UI05 | 合格 | 初期展開本文は空。JavaScript無効時は重ねたラベルが非表示で、標準selectの文字が表示される |
| UI06 | 合格 | START/poll/成功、対抗・穴、4種の失敗時消去、締切越え動作を再確認 |
| UI07 | 合格（自動操作） | 標準selectのマウス開閉、Escape取消、キーボード選択と番号同期。optionのaria-labelに締切情報を保持。実機タッチと読み上げ音声は未確認 |
| UI08 | 合格 | GitHub Pages build=built（commit 3c1f1e8）。公開HTML/CSS/JSがローカルとバイト単位で一致 |
| UI09 | 合格 | 6画面幅の白枠の左右端一致を再確認。コメント2件入りの詳細確認は前回結果を引き継ぐ |

| UI10 | 合格（WebKit自動試験） | 375×812 CSS px、DPR3で選択中・START・結果までdocumentWidth=375、scale=1、offsetLeft=0、幅・中央位置を維持。修正前のWebKit計測は387px。実機Safariは未確認 |

実行: stadium-selection.test.mjs（12件合格）、ai-ui-browser-smoke.cjs、ai-ui-date-refresh-smoke.cjs、ai-ui-webkit-viewport-smoke.cjs。
ブラウザーはWindows Edge。外部サービスへの通信はモックし、Gemini・本番DBへの試験リクエストなし。

10項目合格。WebKit自動試験合格。iPhone実機での最終確認は未完了。実機スマートフォンでのタッチ操作は未確認。

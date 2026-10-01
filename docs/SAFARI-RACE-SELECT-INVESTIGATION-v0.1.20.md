# iPhone Safari レース選択後の横ずれ調査

調査日: 2026-10-01 JST
利用者環境: iPhone 13 mini / iOS 26.6.2。会場選択では発生せず、レース選択で一時的な左寄り、STARTで左寄りと約5%の縮小。Android Chrome、PC Chrome/Firefoxでは正常との報告。

## 方法

公開対象 f422c05 と変更前683ddcaのコミット内資材をローカルへ配信し比較。Windows Playwright WebKit 26.5 / Edge、375×812 CSS px、DPR3、モバイル・タッチ設定。APIはすべてモック。iPhone実機やiOS Safari UIの再現環境ではない。レース選択はfocus/selectOption、STARTはtapで操作。

## 測定結果

- WebKit: 初期・会場選択はdocumentElement.scrollWidth=375。レースを選択しフォーカスがある間は387。変更前でも同じ387。
- Edge: 変更前・現在とも375のまま。
- WebKit: 現在版race-select-shellのclientWidthは100、選択フォーカス時scrollWidthは199。上位要素へ横はみ出しが伝播。blur後はページ幅375。
- 試験画面内に `#race-select { overflow: hidden; }` を追加すると、フォーカス・選択・START・回転・結果表示までページ幅375。欄の実幅99.5pxと中央配置は変化しない。
- 短いoptionへ一時的に変更する比較でもSTART時は375だが、結果後に既存コードが長いラベルを再生成するため387となるケースがある。
- 実機で報告されたvisualViewport.scaleの低下・左寄りそのものは再現していない。全計測でscale=1、offsetLeft=0、site-stack.left=15。フレーム測定はWebKitの実行頻度が低く、瞬間的変化をすべて捕捉した保証はない。

## 判断

レース欄内部の長い選択文字の横はみ出しを確認できた。Safariの縮小・左寄りの原因として有力だが、iOS 26.6.2実機との因果関係は未確定。回転がなくても幅の拡大は発生する。文字の色をtransparentにしても幅計算は消えない。

修正としてselect自身にoverflow-x:hiddenを指定。WebKitモバイル試験で、選択中・START・回転・結果表示を通じて375px幅、scale=1、offsetLeft=0を維持。欄幅・時刻付きoption・選択値は同じ。iPhone実機で症状解消を確認する作業は残る。

WebKitには表示領域外の要素による縮小の報告があるが、別環境の報告であり本件の確定根拠ではない: https://bugs.webkit.org/show_bug.cgi?id=271819

## 証跡

- test-evidence/v0.1.20/20261001-race-safari-investigation.json
- test-evidence/v0.1.20/20261001-race-safari-isolation.json
- test-evidence/v0.1.20/20261001-race-safari-candidate.json

初回調査の記録。対策の実装状況と追加試験は試験成績書を参照。

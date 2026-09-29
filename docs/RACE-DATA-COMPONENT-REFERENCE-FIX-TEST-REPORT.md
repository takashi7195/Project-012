# レースデータ component 参照修正 試験成績書

作成日: 2026-09-29 JST

| 試験 | 結果 | 証跡 |
|---|---|---|
| 旧処理の誤参照再現、新parser batchのkind別component/projection、6艇program/preview entryを隔離DBで確認 | 合格 | [証跡](test-evidence/v0.1.19/20260929-component-reference-fix.json) |
| 同一hash再処理時に新parser batchを作成し、以前のbatchを保持 | 合格 | [証跡](test-evidence/v0.1.19/20260929-component-reference-fix.json) |
| 同一batch再処理で全component参照を修復し、closed_at wrapperを維持 | 合格 | [証跡](test-evidence/v0.1.19/20260929-component-reference-fix.json) |
| 対象日の全race component/projection対応を本番確認 | 合格（144/144） | [証跡](test-evidence/v0.1.19/20260929-component-reference-fix.json) |
| AI input RPCがprogram/preview rawを返し、resultを除外 | 合格 | [証跡](test-evidence/v0.1.19/20260929-component-reference-fix.json) |
| Parser/record/worker関連Node試験 | 合格（22/22） | [証跡](test-evidence/v0.1.19/20260929-component-reference-fix.json) |
| race-ingestion全Node試験 | 49合格・1失敗 | timeout分類の受入harness試験。今回の変更対象ファイル外、未解決として記録 |
| Provider/Gemini要求が発生しない | 合格 | provider呼出しなし |
| 本番migration・対象日再取り込み・全144件確認 | 合格 | [証跡](test-evidence/v0.1.19/20260929-component-reference-fix.json) |

実装前の読み取り診断では、2026-09-29の144 raceすべてでsnapshotのprogram componentおよびprogram projectionの参照先kindが`result`だった。これは原因特定の証跡であり、修正試験の合格ではない。


## 本番修正結果

2026-09-29にmigration `20260929000000` を本番適用し、`race-ingest` Edge Functionへ修正版parserをデプロイした。9月29日の公式API snapshot（144 race）を36分割で同じsnapshot/batchへ再取込し、最後の分割でday headを公開した。再取込後の読み取り検証では、current batchのrace 144/144でprogram/preview/resultのcomponent kindとprojectionリンクが一致し、program/previewとも144/144 raceで6艇分のentryを確認した。旧parser batchは同日分として114件残存している。AI input RPCもsample raceで取得でき、programを返しresultフィールドを除外した。Gemini providerへのリクエストは行っていない。

再取込時点から10分以内の取得データに合わせるため、9月29日09:32:27 UTCに取得した最新snapshotでもう一度公開した（144 race、結果118 race）。最終current hashは取得snapshotのhashと一致することを確認した。最新の本番結果は同じ証跡JSONに記録している。

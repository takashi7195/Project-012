# レースデータ component 参照修正 詳細設計

作成日: 2026-09-29 JST

## 1. 変更対象

1. 新migration `20260929000000_race_data_component_reference_fix.sql`で、既存の`race_data.ingest_snapshot_legacy_v0_1_14`を置き換える。
2. 正規化定数`PARSER_VERSION`を`v0.1.11-normalizer-2`へ更新し、`race-ingest`配下と`race-ingestion`配下を一致させる。
3. 旧migrationのbodyを基にした関数内で、`v_component_id`にINSERT戻り値を格納し、`kind`ごとの変数へ代入する。各レース冒頭でphase変数をNULLへ初期化する。
4. `snapshot_races`の競合更新ではprogram/preview/result component・projection、presence、quality flags全項目を更新する。
5. 既存の20260924 wrapperは維持し、`closed_at`補正を引き続き適用する。

## 2. データ更新方法

対象日の公式API snapshotを取得・正規化し、parser version 2で現行ingest RPCを呼ぶ。snapshot hashが同じでも新しいnormalization batchができ、成功後にday headが新batchを指すことを確認する。従来batchは削除・更新しない。API取得または正規化が失敗した場合はpublishしない。

## 3. 検証

隔離PostgreSQLで複数componentが異なるkind/IDを持つfixtureを取り込み、snapshot参照とprojection参照が各kindに一致すること、同一snapshot/hashの再処理で新parser batchへ正しく更新すること、欠損previewを前レコードの値で埋めないことを確認する。productionでは対象日batchの全件kind一致、6艇program entry数、専用AI input RPCのraw field一致を読み取り確認する。providerは呼び出さない。

## 4. 権限・保全

過去batch/component/table rowを削除しない。migration実行と対象日再取り込みだけを行う。race-data ingest RPCの既存service_role限定を維持する。予想Functionはlegacy modeのまま維持し、Geminiを呼ばない。

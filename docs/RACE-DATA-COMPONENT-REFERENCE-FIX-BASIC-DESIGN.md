# レースデータ component 参照修正 基本設計

作成日: 2026-09-29 JST

## 1. 目的

公開後に確認された、採用snapshotのプログラム・展示・結果component/projectionがすべて結果を参照する不整合を修正する。正しい出走表raw dataをAI input RPCから読める状態に戻す。

## 2. 根拠と原因

本番当日144レースで、`snapshot_races.program_component_id`と`program_projection_id`が`kind=result`を指すことを読み取り確認した。取り込み関数は各component INSERTの戻り値を`v_program_component`へ格納し、kind別変数への代入も同じ変数を参照していた。さらに既存batch競合時のsnapshot参照更新は`result_projection_id`だけだった。

## 3. 方針

- `program`、`preview`、`result`のcomponent IDを個別に捕捉する。
- 1レースごとにcomponent/projection変数を初期化し、欠損phaseで前のレースの値を使わない。
- 競合時も3種類すべてのcomponent ID、projection ID、presence、quality flagsを更新する。
- 適用済みmigrationは変更せず、後続migrationで既存の内部取り込み関数を修正する。
- 正規化parser versionを更新し、既存の誤ったbatchを上書きせず、新しいbatchとして作成・採用する。
- 対象日の公式APIデータを同じ正規化・取り込み経路へ通して採用する。古いbatchやcomponent rowは削除しない。

## 4. 対象範囲

対象はcomponent ID/projection IDの対応と、同修正を識別するparser version、および対象日データの再取り込みに限る。予想仕様、provider、画面、コメント、過去batchの削除・改変、過去日の一括再取り込みは対象外。

## 5. 完了条件

対象日の採用batchで全raceのprogram/preview/result参照先kindとpresenceが一致し、出走表・展示のraw JSONが意図したcomponentから取得できる。AI input RPCが正常入力を返し、結果データをAI入力から除外する。新規取り込み後もこの対応が維持される。

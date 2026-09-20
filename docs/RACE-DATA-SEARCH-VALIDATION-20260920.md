# 汎用検索RPC検証記録（2026-09-20 JST）

対象: Project-012 の `race_data_search_current_races`（service_role限定）

## 実施した検索

- 日付未指定・最大5件: 現行day headだけを返し、`data`に出走表・展示・結果・払戻しを含むことを確認。
- レース番号1・艇番1の組み合わせ: 5件上限と絞り込みを確認。
- 選手名「菊池」: 空白を除いた名前検索のフォールバックで3件を確認。
- 拡張検索: 級別`A1`、選手名「田中」、3連単かつ払戻し10,000円以上を各3件上限で確認。
- 日付の前後が逆: `invalid_date_range`を返すことを確認。
- 集計: 通常払戻し最大額、同額行、最年少と同年齢行、結果確定レース数を確認。

## 実DBで得られた観測値（取得時点）

| 項目 | 値 |
|---|---:|
| matched_races | 3,516 |
| returned_races（limit=5） | 5 |
| max_normal_payout_yen | 376,690 |
| min_entry_age | 17 |
| races_with_completed_result | 3,503 |

値は定期取得の進行で変化するため、機能の固定期待値には使わない。検索は現行batchのみを対象とし、旧projectionの重複を集計しない。

## 残る制限

- browser向け公開API、Gemini Function Calling、任意SQL実行は未実装。
- 追加の絞り込みは管理用の `race_data_search_current_races_filtered` に実装済み。browser向け公開API、Gemini Function Calling、任意SQL実行は未実装。

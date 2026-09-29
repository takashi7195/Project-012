# v0.1.19 公開前の必須試験と後続試験

現在の公開状態（2026-09-29）: 画面v0.1.19・対応Function・2 migrationを反映済み。公開後STARTがHTTP 404となり、当日144レースのprogram component/projectionがresult componentを参照する既存DB不整合を確認。AI生成は開始されていない。PREDICTION_MODEはlegacyへ復帰済みで、AI方式への切替は未完了。詳細は[公開証跡](test-evidence/v0.1.19/20260929-publication.json)。以下の公開前一覧は確認時点の履歴として残す。

作成日: 2026-09-29 JST。利用者は「公開URLへの反映を目指し、必要な試験は必ず行い、後でできる試験は後に回す」と指示。製品仕様と70受入項目の期待結果は変更しない。未完了を合格へ読み替えず、以下の公開条件と全70項目の成績を別に管理する。

## 1. 公開前に満たす条件

| 条件 | 元のID | 必要な確認 | 現在の不足 |
|---|---|---|---|
| RLS01 実生成 | M01/M02/M08 | 現在の利用枠を確認済み（表示1/5 RPM、478/250K TPM、2/20 RPD）。models.listはHTTP 200で、設定モデルがgenerateContentをサポートすることも確認済み。実生成はHTTP 503。公式説明では503は一時的な過負荷または停止の可能性があるが、今回の要求の詳細原因・回復時刻は分からない。正常JSONを一度確認後、通常入力と展示欠損入力の2種類で買い目/文章の矛盾・架空の具体値を確認し、時間・要求数・結果を記録 | 実生成成功なし。利用枠表示後の要求も503。API keyとモデル名の基本確認は済んだが、provider側の回復が確認できないため追加生成要求を保留 [M01 evidence](test-evidence/v0.1.19/20260929-m01-gemini-503-with-quota.json)、[Gemini公式503説明](https://ai.google.dev/gemini-api/docs/generate-content/api-errors) |
| RLS02 一連の動作 | M02/U04/U06 | 同じ公開予定コードを使うブラウザー→実Edge→DB→実Gemini→一括保存→GET→表示・再利用。失敗/締切時の安全な案内は実Edge＋模擬providerで確認可能 | 各部品の確認済み証跡あり。実モデルを含む一連の確認なし |
| RLS03 切断後の継続 | D07/M05 | 実Edgeで開始者が離脱してもjobが完了し、後続GETで同じ結果を取得。試験補助timerや通知自体の停止と製品worker停止を区別 | M05の90秒完了実績あり。D07実runtime未確認。原因を絞る新条件を準備 |
| RLS04 切り戻し | M04/M07 | 旧ソース・実効設定・現行本番の復元基準を保全。隔離環境で新規停止→進行job完了/失効→旧backend/frontend復帰、データ保持を確認 | ユーザー判断で追加切り戻し確認を終了。既存のDB/旧handler互換とlegacy境界の部分確認を受容する。実runtime切替と画面復元は未確認で、M04/M07の正式成績は部分確認のまま |
| RLS05 配信互換 | U11 | 新旧画面と実Edge契約混在で安全な拒否、再読込後の正常動作、版表示を確認 | mock成功。実Edgeとの組合せが残る |
| RLS06 既存機能・基本表示 | U09/U10/M06(O01) | コメント一覧/投稿/返信と予想欄の共存を確認。コメント旧予想との不一致への当面方針を決定。PCと狭幅で操作可能 | UI/DB/handlerは各部分成功。旧予想連携・当面方針の確定が残る |
| RLS07 反映対象・運用 | M06 | 対象差分を確定し、認証情報やfixtureを含めず、復元基準・migration順・公開先・モデル枠を確認 | 公開候補13ファイルを選別。ローカルDBで2件のmigration、4テーブル、7 RPCを確認し、anon実行不可/service_role実行可を確認。GitHub Pagesはmainのルートから公開。本番の読み取りmigration一覧では既存24件が一致し、`20260926000000`と`20260927000000`が未適用と判明。SQLにはDROP/TRUNCATE/DELETEや既存race_data/publicへの更新はないが、CREATE TABLEはIF NOT EXISTSでないため、本番カタログを読み取り照会し、4テーブル・7関数はいずれも未作成でmigration履歴外の部分適用がないことを確認。限定的なキー形式検査は一致なし。本番migration適用、Function candidateとの同一性確認、切替Secret設定、Pages配信内容との最終照合が残る |
| RLS08 公開直後の確認 | PUB01〜PUB05 | 配信版、実際の当日締切前レースでSTART/保存/再利用、コメント・収集、ログ、PC基本表示を確認 | 反映後に実施。対象レースなしの場合は未完了として残し、公開完了とは報告しない |

当初はRLS01〜07を満たしてから公開URLへ反映する方針だった。2026-09-29、利用者が試験フェーズを終了して公開URLの更新へ進むことを明示したため、未完了項目を未完了のまま保持して公開作業へ進む。Gemini実生成503、実runtime切断後継続などの未解決事項は公開後確認へ移す。RLS08は反映直後の確認であり、重大な不具合時は確認済み手順で切り戻す。公開前の問題を本番の利用者に試してもらう扱いにはしない。

## 2. 公開後へ回す範囲

| 元のID | 後続の範囲 | 公開前に残す範囲 |
|---|---|---|
| M02 | 固定6レース全体の文章傾向・表現の違いの詳しい比較 | 少なくとも通常/欠損の実生成と明白な矛盾確認、一連の正常生成 |
| M03 | 低価格モデルとの比較・切替最適化 | 現採用モデルの正常動作 |
| U10 | 実スマートフォンの複数機種/ブラウザー組合せ、追加の見た目調整 | PC・狭幅で選択/START/全文/失敗案内が利用可能 |
| M08 | 大規模な実トラフィックでの長期費用・可用性観測 | 現在の利用枠確認、最大2試行と429の制御、公開規模での枠の制約の明示 |
| 運用補助 | ログ収集経路の追加整備、診断表示の利便性改善 | 失敗原因を追える現行ログと秘密非露出 |

後続部分を持つIDは全受入条件が満たされるまで部分確認とする。D07、保存失敗、権限、実生成成功、切り戻しは後回しにしない。公開前に新たな重大障害が見つかれば公開を止める。

## 3. 実行順と反映順

1. 今回のM07実Edge補助結果を記録。既存57合格は変更や証跡不足がある場合だけ再試験する。
2. Windows/Docker接続を確かめ、D07の実効runtime設定と最小再現を調べる。同一失敗を根拠なく反復しない。
3. 並行して公開先・Git差分・本番の復元情報を読み取り確認し、M01の実モデル枠とO01方針を確定する。
4. 隔離したローカル/検証環境でRLS01〜06を実行。検証用Hosted環境が必要なら接続先を識別してから作業する。本番DBに合成レースや試験コメントを投入しない。
5. RLS07で最終の変更ファイル・接続先・migration・復元手順を提示し公開判断。mainへのpushはPages公開を伴うため、途中の試験目的でpushしない。
6. 追加DB構造→対応backend→対応frontend→新方式切替を整合させて反映し、RLS08を実施する。通常切戻しは詳細設計12.3に従う。

## 4. 現時点の公開候補ファイル

2026-09-29 JSTにHEAD/origin/main（`5cc946f937cff7ba34a498659436b4cecd3aa831`）と作業ツリーを比較。`git status --untracked-files=all`は244 path（追跡済み変更92、削除1、未追跡151）。追跡ファイルを`git diff --ignore-space-at-eol`で比較すると、実質変更は7ファイル、`AGENTS.md`削除1ファイルで、追跡済み変更の残り85件は改行形式だけだった。

v0.1.19の公開実行時候補は13ファイル。GitHub Pagesの画面3ファイルとSupabase backend/DBの10ファイルに分ける。`supabase/config.toml`の`[edge_runtime].policy = "per_worker"`はローカルEdge Runtime用の設定であり、ホスト先の関数設定として数えない。リポジトリ内のローカル試験用設定としては残るが、公開実行時ファイルには含めない。

### GitHub Pages画面（3）

- `index.html`
- `script.js`
- `race-prediction/client.mjs`

### Supabase backend/DB（10）

- `supabase/functions/predictions/index.ts`
- `race-prediction/ai-config.mjs`
- `race-prediction/ai-diagnostics.mjs`
- `race-prediction/ai-generation.mjs`
- `race-prediction/ai-input.mjs`
- `race-prediction/ai-output.mjs`
- `race-prediction/ai-prompt.mjs`
- `race-prediction/providers/gemini.mjs`
- `supabase/migrations/20260926000000_ai_prediction_bundle_v0_1_19.sql`
- `supabase/migrations/20260927000000_ai_prediction_result_filter_v0_1_19.sql`

2件の追跡済み変更（`race-prediction/prediction-static.test.mjs`、`race-prediction/release-regression.test.mjs`）と未追跡の試験コード・設計書・証跡は実行時配信物ではない。残りの改行差分、`AGENTS.md`削除、コメント/レース収集関連の既存変更、SQL調査用ファイルも上の13件には含めない。プロジェクトを読み取り専用でマウントした一時コンテナ内でDeno bundleを実行し、Edge Functionと12個のimport依存が単一bundleに解決されることを確認した（bundle用コンパイラ取得の通信のみ実施）。ローカルDBのmigration履歴には対象2件が存在し、公開候補13ファイルに既知のAPIキー形式の一致はなかった（限定的なパターン検査）。これらの証跡は[release Deno bundle](test-evidence/v0.1.19/20260929-release-deno-bundle.json)と[read-only local audit](test-evidence/v0.1.19/20260929-release-local-audit.json)。Supabase CLI固有のdeploy packaging、本番Function一覧はpredictions ACTIVE v34、comments v65、race-ingest v23。読み取り専用Secret名一覧ではGEMINI_API_KEYあり、PREDICTION_MODEなし（値は証跡に保存しない）。公開candidateとのFunction同一性は未確認。migrationの本番適用、公開切替Secret設定、GitHub Pages root配信と公開ファイル内容の最終照合は未完了。作業ツリー全体を公開対象として扱わない。

2026-09-29作業ツリー確認: ローカルHEADはorigin/mainと同じ5cc946f937cff7ba34a498659436b4cecd3aa831だが、追跡ファイル93件に変更、未追跡148件以上がある。これらはAI刷新以外の既存差分も含み、作業ツリー全体をそのまま公開対象にできない。公開対象を設計/試験証跡と照合し、選別したリリース差分として確定する必要がある。

2026-09-29読み取り確認: GitHub Pages https://takashi7195.github.io/Project-012/ は main:/ から公開、status=built。GETはHTTP 200でページ本文にv0.1.18の表示1箇所、v0.1.19表示0箇所。公開HTML SHA-256は b54765e6d6f5d5962e5e78d49fd18c9746cf6dc835a232ddd0d1b541c333f537。詳細は[PUB00証跡](test-evidence/v0.1.19/20260929-pub00-current-site.json)。ローカルv0.1.18は e6c263456a5999b10181fda4eae32e9f6bdfa578。公開HTMLは現在の本番Function/Secrets/migrationとの一致を示すものではない。

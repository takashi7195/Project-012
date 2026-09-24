# v0.1.11 競艇データ基盤 詳細設計書

作成日: 2026-09-20 JST  
状態: 段階7の実装版。`race_data`スキーマ、service_role限定RPC、Edge Function、Cron、直近1か月の取り込み、再解析コマンド、管理用の汎用読み取りRPCを実装済み。公開検索API、Gemini Function Calling、完全な障害試験は未完了。実DBのバックフィルキューも直近30日に制限済み。
対応計画: [実装計画書](RACE-DATA-INGESTION-PLAN-v0.1.11.md)

## 1. 設計原則

1. コメント回答、予想、分析などの利用側から独立した競艇の事実データを保存する。
2. 検索・集計する属性は型付き列へ、未対応の属性は元JSONへ保存する。全属性をキー/値方式だけで保存する構成にはしない。
3. 出走表・展示・結果の時点を区別し、変更前の情報を失わない。
4. 欠損、未提供、未確定、明示的な中止、取得失敗を区別する。未知は未知のまま保存する。
5. 同じデータの繰り返し取得・並行処理・途中失敗に耐える。
6. 将来AIへ渡す際は、必要な行・列だけを検索する。AIへ日次JSON全体を送る構成にはしない。
7. 当段階ではGemini・ルーレット・commentsを変更しない。

## 2. 構成と配置

```text
Supabase Cron（開発専用プロジェクト）
  → 日付キュー / 実行予定
  → 認証された取り込みEdge Function
  → 日付指定の非公式API
  → 構造検証・意味の保持・差分判定
  → 元情報の履歴 + 型付き検索テーブル
  → 検証後に日付単位の現行版を切替

将来: 共通読み取り処理 → コメントAI / 予想 / 分析など
```

Supabase PostgreSQLの専用スキーマ `race_data` と収集専用Functionを使用する。ユーザー承認によりProject-012を使用するが、`race_data`はブラウザー向けに公開しない。収集RPCはservice_role限定のpublicラッパー経由で呼び出す。

Cron/pg_netからFunctionを呼び出し、認証情報はVaultとFunction Secretへ保存する。Project-012ではVault拡張が利用できなかったため、現段階はブラウザー権限を剥奪した`race_data.scheduler_secrets`へCron専用トークンを保存し、Function Secretと同じ値を参照する。Vaultが利用可能になった時点で移行する。HTTP呼び出しの受付成功だけで収集成功とせず、DB上のrun状態まで確認する。[Supabaseの定期実行方式](https://supabase.com/docs/guides/functions/schedule-functions)

workerは小さな処理単位に分割する。初期設定は外部取得30秒、1呼び出しの処理予算60秒、展開後本文上限16MiB、外部リクエスト直列。CPU・メモリ・DB時間を測定し、余裕がなければ一度保存した解析待ちデータを後続workerが処理する。クラウドの実行制約を確認し、1呼び出しで数か月分を処理しない。[Edge Functionの制約](https://supabase.com/docs/guides/functions/limits)

## 3. データ契約と識別

- 取得先: `https://boatraceopenapi.github.io/api/v1/YYYY/YYYYMMDD.json`。
- 日付: `race_date date` はAsia/Tokyo基準。DBの観測時刻は `timestamptz`。
- レース: `(source_id, race_date, stadium_code, race_number)` を一意キーとする。
- 選手: APIの登録番号を識別に使う。同姓・同名を名前だけで結合しない。
- 枠: `entry_number`（1〜6）。機材のボート番号は `hull_number`。進入は展示と本番を別列にする。
- 開催名: レースにtitle/subtitle/day_numberを保持。titleだけから開催節の一意IDを作らない。別途確実な節識別子が得られた場合に開催テーブルを追加する。
- 異なる提供元の同じレースは自動上書きせず、sourceを分けて照合できる。
- 元のキーと内側の日付・場・Rが異なる場合は、対象を誤結合せず構造エラーとする。

参照資料は[API調査メモ](research/RACE-API-FINDINGS-20260920.md)。以下は資料だけの推測ではなく、5日分の実レスポンスに基づく。ただし観測していない形式は追加fixtureと実装時調査で補う。

## 4. 元情報の保存と重複排除

毎回の日次JSON全文を重複保存すると容量が増えすぎるため、意味を失わずに構成要素を分けてDBへ保存する。

- `source_snapshots` に日次JSONのハッシュと外枠（envelope）を保存。
- `race_components` にレースごとの出走表/展示/結果の元JSONを、それぞれ変更時だけ追加する。
- `snapshot_races` が「この取得時点の日次JSONは、どのレースのどの構成要素でできていたか」を記録する。
- envelopeにはrace以外のroot/programs/stadiumの属性を全て残す。race本体はprogram要素とpreview/resultに分割し、未知の属性も落とさない。
- preview/resultの「不存在・null・空オブジェクト・実値」をmanifestのpresenceで区別する。日付から見えなくなった場/Rも、その観測の一覧を保持する。
- 復元したJSONと取得JSONを意味的に比較する試験を必須にする。キー順・空白などバイト列そのものの再現は保証しない。
- JSONBで表現できない数値や不正Unicode、重複キーなどは黙って変換せず検知して隔離する。

重複排除は正規化したJSONのSHA-256（`hash_version`付き）を使う。数値と文字列、nullと空、配列の順序は区別する。原HTTP本文のハッシュも観測記録に別保存する。

同じ本文が再出現した場合は元JSON部品を再利用し、取得したという観測は新規runとして残す。A→B→Aの変化はfirst_seenだけでは分からないため、runとsnapshotの時系列を保持する。

## 5. テーブル構成

以下のテーブルはすべて開発専用DBの `race_data` 配下。IDはUUIDを基本とし、場/R/枠等はsmallint、金額はbigint、率・タイムはnumericを用いる。

### 5.1 収集と原本

| テーブル | 主要列・キー | 役割 |
|---|---|---|
| sources | id、code UNIQUE、base_url、enabled、settings jsonb | 提供元と取得間隔・上限等 |
| sync_tasks | source_id/date UNIQUE、reason、priority、state、next_attempt_at、attempt_count、lease_until、lease_token | 日付キューと再開点 |
| ingestion_runs | id、task_id、request_started_at、fetched_at、http_status、elapsed_ms、bytes、etag、last_modified、body_hash、snapshot_id、status、error_code | 取得・処理の観測ログ |
| source_snapshots | id、source_id/date/semantic_hash UNIQUE、hash_version、envelope jsonb、created_at | 復元可能な日次原本のmanifest |
| snapshot_observations | id、source_id/date、snapshot_id、batch_id、fetched_at、published_at、http_last_modified、request_body_hash、outcome | 採用/版切替の長期証跡。詳細runログの削除後も時点を再現 |
| races | id、source_id/date/stadium_code/race_number UNIQUE | 不変のレース識別子 |
| race_components | id、race_id、kind、raw_hash、raw_json jsonb、first_observed_at、UNIQUE(race_id,kind,raw_hash) | program/preview/resultごとの変更履歴 |
| normalization_batches | id、snapshot_id、parser_version、rules_version、parent_batch_id、state、created_at、published_at | 変換と検証の版。同じ原本の再解析に対応 |
| snapshot_races | batch_id/race_id PRIMARY KEY、各phaseのobserved/accepted projection ID、presence、quality_flags | 原本の構成と、利用可能な良好版を識別 |
| day_heads | source_id/date PRIMARY KEY、current_batch_id、current_run_id、generation、latest_attempt_at、last_success_at | 読み取り側に公開する1日の版 |
| coverage | batch_id/scope/stadium UNIQUE、各phaseの件数、unknown_count、basis、issues jsonb | 完全性・利用可能範囲 |
| quarantines | run_id、json_path、code、bounded_payload、review_state | 不正構造、回帰、未知の型等の調査 |

runの詳細ログ保持期限とは独立に、snapshotの初回観測・batch・snapshot_observationsを保持する。day_heads.current_run_idや監査用run参照はログ削除時にNULLを許容し、版の参照にはcurrent_batch_idを使う。監査に必要な採用・版切替イベントは詳細runログを唯一の根拠にしない。

### 5.2 型付き検索テーブル

`component_projections`（id、component_id、parser_version、rules_version、quality_state、UNIQUE(component_id,parser_version,rules_version)）を変換結果の親とする。以下の版付き行はprojection_idに紐付く。再解析は別projectionを作り、旧解析結果を書き換えない。

| テーブル | キー | 型付き項目 |
|---|---|---|
| race_programs | projection_id | closed_at、closed_at_source、title、subtitle、grade_code、grade_source、distance_m、day_number |
| race_entries | projection_id/entry_number | racer_registration_number、name、name_search、rank_code、rank_source、branch_code、birthplace_code、age_at_race、weight_kg、F/L回数、平均ST、全国/当地勝率・2/3連対率、motor_number・2/3連対率、hull_number・2/3連対率 |
| race_previews | projection_id | 展示時の天候コード、風向コード、風速、波高、気温、水温 |
| preview_entries | projection_id/entry_number | exhibition_course、exhibition_st、weight_kg、weight_adjustment_kg、exhibition_time_s、tilt、propeller jsonb、parts jsonb |
| race_results | projection_id | 決まり手コード/原文、備考、結果時の天候・風向・風速・波高・気温・水温、result_state |
| result_entries | projection_id/entry_number | 選手登録番号・名前、actual_course、actual_st、place_code、place_source、finish_position nullable |
| payouts | projection_id/bet_type/item_index | combination_source nullable、combination_entries smallint[] nullable、amount_yen、label nullable、payout_kind |
| refunds | projection_id/item_index | entry_number nullable、raw_item jsonb |

全phaseの原文・未知属性はrace_components.raw_jsonで保持する。partsの個々の属性での頻繁な集計が必要になった時は、原本から専用子テーブルへ追加展開する。全JSONへ無条件にGIN索引を作らず、必要な検索に応じて追加する。

選手の名前検索は空白等を正規化した補助列を使用し、原表記も保存する。独立した最新選手マスターを参照して過去年齢・級別・成績を置き換えない。motor/hull番号も全場共通の機材IDとは扱わない。

### 5.3 索引と参照整合性

- races: 一意キーに加え `(race_date, stadium_code, race_number)`。
- race_entries/result_entries: `(racer_registration_number, projection_id)`、必要に応じてname_search。
- payouts: `(bet_type, amount_yen DESC, projection_id)`。検索では必ず現行batch内のprojectionへ結合し、旧版を重複集計しない。
- race_components: 一意ハッシュ、race_id/kind。normalized側はprojection_idを索引化。
- tasks: state/next_attempt_at/priority。runs: task/timeとerror/time。
- snapshot_racesの参照先projectionが同一race・正しいkindに属することを複合FKまたは公開RPC内の制約で検証する。
- 親レース、projection、子の枠・払戻しを外部キーで結合する。非公開schemaを無制限なcascade削除の対象にしない。

## 6. 値の意味と品質

| 項目 | 取り扱い |
|---|---|
| `closed_at` | JST締切日時。発走予定時刻と呼ばない |
| `entry_number` | 枠番。`boat_number`（機材番号）と分離 |
| `preview.course_number/start_timing` | 展示進入・展示ST。本番とは分離 |
| `result.course_number/start_timing` | 本番進入・本番ST |
| `place_number` | 提供元の状態コード。1〜6のみfinish_positionへ変換し、その他は原文とコードを保存 |
| `payouts` | 配列の全行を保存。bet_typeだけを一意キーにしない |
| 特払/不成立 | labelを保存。normal/special/refund_or_void/unknownを区別し、通常の的中配当ランキングと分ける |
| refund | 対象枠の情報を保存。配当額を推定しない |
| null/欠落 | 0へ変換しない。元JSONとpresenceで欠落理由の判別余地を残す |
| 性別/オッズ | 現APIでは未確認。値を作らない。将来別sourceの明示的データから追加可能 |
| 率/勝率 | 勝率と1着率を同一視しない。率は0〜100が通常範囲、型や範囲外は警告・隔離 |
| ST/チルト | 負値が正常に存在する。単純な非負制約を付けない |

結果状態は `unknown / awaiting / partial / available / cancelled_explicit / conflict` などで管理する。`available`はAPIから結果情報が利用可能という意味で、公式確定の保証ではない。時間経過・空配列だけから開催中止を推定しない。

期待レース数を毎場12と固定せず、観測した出走表集合を基準にする。1艇の欠場を6艇未満だから即不正としない。通常着順の矛盾・同じ枠の重複等は検査し、同着は許容する。

HTTP成功、構造妥当、出走表あり、結果あり、全国全開催を網羅していることは、それぞれ別の指標。

## 7. 取得・保存アルゴリズム

1. 有効化状態と容量を確認。DBでtaskをclaimし、期限付きリースと単調増加するtokenを取得。
2. source/dayを固定してURLを生成。任意URLの入力を受け付けず、許可ホスト・パスのみ取得する。
3. ETag/Last-Modifiedがある場合は条件付きGETを利用。304なら参照可能な前回snapshotを検証し観測時刻だけ更新する。前回データがなければ無条件GET。
4. 200の本文上限・JSON構造・識別キーを検査。4xx/5xx/通信失敗は分類してrunに記録。
5. 全体とphaseごとの意味ハッシュを計算。変更のない元JSONとprojectionを再利用する。
6. 新しい部品と型付き行をstagingとして保存。レース単位の短いtransactionで親子を揃える。部分失敗時はcurrentの切替を行わない。
7. 全件数、参照整合、元JSONの復元、品質ルールを検証しbatchをreadyにする。
8. 短いtransactionでlease_tokenとday_heads.generationを再確認し、batch公開、snapshot_observationsへの記録、head更新を原子的に行う。lease切れworkerの更新は拒否する。
9. runを成功/警告付き成功で終了し、taskの次回予定・再確認状態を保存する。

取り込み中のHTTP通信をDB transaction内で待たない。Function間でセッション維持される前提のロックを使わず、DB内リース・一意制約・公開時のfencingを使う。

未完了stagingは再実行で再利用し、参照されていないものだけ後で整理する。DB書き込み失敗時、ローカルログにもrun_id・段階・原因を残す。次回のリース期限回収で永久runningを解消する。

### 回帰・訂正

- 良好な結果が後続JSONでnullになった場合、その観測は保持するが、利用用accepted参照は直前の良好版を維持する。保持した版の時刻とregressionフラグを返せるようにする。
- 金額・選手等の妥当な訂正は新しい版で採用し、旧版も残す。
- 欠落と意図した削除を区別できない変更はconflict扱いとし、勝手に削除しない。明示的な中止等の契約が確認できた場合のみ状態変更を採用する。
- phase単位で採用する。別の観測の個々の数値を無表示で寄せ集めて、存在しなかった完全なレース情報を作らない。
- 原本のobserved参照と利用用accepted参照を分けることで、原本復元と良好値保持を両立する。

## 8. 時点と将来の予想検証

保存する時点:

- `race_date`: レース開催日。
- `closed_at`: 提供元が出した締切日時。
- `fetched_at`: 自分がその本文を取得した時刻。
- `source_updated_at`: 提供元が情報の更新日時を明示した場合のみ。現在は原則null。
- HTTP Last-Modified: 元ファイルの時刻として別列。個々の情報の公開時刻として使わない。
- `published_at`: DBの検索側で使えるようにした時刻。

将来の予想は使用batch/projectionと入力データを固定して記録する。予想特徴量にはprogram/previewだけを明示選択し、result/payoutsを除外する。

締切前情報として厳密に使用できるのは、原則その締切より前に観測できた版。初回バックフィルの過去JSONは、当時の公開時点を再現できないため `historical_availability=unknown` とする。原本を保存しただけで、結果漏洩のない的中率検証ができたと主張しない。

## 9. 汎用的な参照の準備

この段階では管理用の読み取りRPCと検証SQLを用意する。公開検索APIやGemini Function Callingは次期対象。

実装済みの `race_data.search_current_races`（publicラッパーは
`race_data_search_current_races`）は、公開されたday headの現行batchだけを対象に、日付範囲・場・R・艇番・選手名を組み合わせて最大100件まで検索する。各行に出走表、展示、結果、払戻しを含め、集計として対象レース数、通常払戻しの最大額・同額行、最年少、結果確定数を返す。追加条件は `race_data_search_current_races_filtered` で登録番号、級別、年齢範囲、賭式、払戻し範囲を組み合わせられる。`ready` は現在の取り込みwriterが原子的に公開した状態であり、将来の明示的な `published` 状態とともに検索対象とする。

- 現行ビューはday_heads→公開batch→accepted projectionを結合する。
- 履歴ビューは対象の観測run/batchを指定する。初回観測時刻だけで版を決めない。
- 自由条件の組み合わせは日付範囲、場、R、枠、登録番号、級別、年齢、賭式、金額など。
- 集計はmax/min/count/sum/group/order、同額首位は全件取得できる。
- 複数日をまたぐ集計は同じDB snapshot内で読み、回答に使用したbatch一覧を追跡できるようにする。
- 件数・日付範囲・列の上限を将来の検索層で制御する。AIから任意SQLや書き込みを実行させる契約にはしない。

確認する代表的な検索:

| 問い/用途 | 検索・集計 | 留意点 |
|---|---|---|
| 2026-05-01の最高払戻し | 現行payoutsを日付・通常払戻しで絞りMAX、同額首位を全件返す | 全賭式か3連単かを明示、coverage付き |
| 特定選手の昨日の出走数 | 登録番号・日付で対象レースを数える | 出走表掲載と実出走を分け、欠場を実出走に数えない |
| このレースの最年少 | race_entries.age_at_raceのMIN、同年齢を全員返す | 年齢nullなら不明件数も返す |
| 3連単予想の入力 | 特定raceのprogram/previewを同じbatchから取得 | 結果除外、取得時刻・展示不足も付与 |
| ある選手の過去の当地成績 | 過去race_entriesの開催時点値、またはresultから対象期間で算出 | API掲載値と自分の集計値を区別 |
| 女子選手の検索 | 現APIに項目がないため取得不能を返せる | 名前・体重から推定しない |

後続検索応答の概念形:

```json
{
  "data": [],
  "scope": {"from": "2026-05-01", "to": "2026-05-01", "bet_type": "trifecta"},
  "provenance": {"source": "boatraceopenapi-v1", "batch_ids": []},
  "coverage": {"basis": "observed_programs", "national_verified": false},
  "warnings": ["result_missing"]
}
```

0件の理由は `no_match / source_unavailable / field_unsupported / incomplete` 等を分ける。「データがない」を「事実が存在しない」と解釈させない。

## 10. 定期実行と障害分類

初期スケジュールは計画書のとおり。1つの日次URLに複数種類が入るため、当初は出走表・展示・結果を1回で取得する。種類ごとの更新設定はadapter設定として拡張可能にするが、同じ日次URLへ種類別に3回アクセスはしない。

リトライは即時連打せずtaskを再予定する。timeout/5xxはジッター付きで5分、15分、60分を初期案とし、5回で要確認へ。429はRetry-Afterを優先する。上限/解析エラーは自動連打せず隔離。次の定期取得でも連続失敗数を維持する。

主な診断コード: `fetch_404`、`fetch_429`、`fetch_5xx`、`fetch_timeout`、`fetch_network`、`payload_too_large`、`invalid_json`、`identity_mismatch`、`unsupported_shape`、`normalization_invalid`、`data_regression`、`db_write_failed`、`lease_lost`、`publish_conflict`、`capacity_paused`。

ログにはrun_id、日付、source、処理段階、HTTP状態、取得サイズ、件数、所要時間を記録し、秘密情報を出さない。遅延・データ変化なし・DB未更新を別指標とする。404と非開催の断定を分離する。

## 11. 権限と運用

- 専用schemaをブラウザー向けData APIへ公開しない。anon/authenticatedへの権限は付与しない。
- サーバーから固定SQL/RPCで書き込み。RPCは最小権限で、SECURITY DEFINER採用時は固定search_pathと明示的な権限剥奪を行う。
- Cron呼び出しには収集専用の秘密トークンを必須とする。公開publishable keyだけでは実行できない。ゲートウェイ認証とアプリ側認証の組み合わせを統合試験する。
- 開発用接続先を明示必須とし、本番project refを拒否するガードを管理コマンドに入れる。
- `sources.enabled=false`で新規claimを停止。実行中workerは公開直前にも状態を確認し、停止後に勝手に採用しない。
- 停止・バックアップ・復元・再開を試験する。Git保存をDBバックアップの代わりにしない。

## 12. 容量と段階的な確定

履歴は変更があったphaseだけ追加し、全文の毎回重複を避ける。ただしmanifest、索引、正規化履歴にも容量を使うため、無料枠での無期限保存は未保証。

まず7日分の取り込みと当日の連続観測で、以下を測る。保存対象は当日を含む直近30日（当日から29日前まで）とする:

- pg_total_relation_sizeによるテーブル・索引込み容量。
- 1日・1レース・1変更あたりの増加量。
- 直近30日分の見込み。
- 取り込みCPU/メモリ/DB時間、検索時間、クラウドリクエスト数。

予測が容量を超える場合は、先に保存容量拡張または圧縮アーカイブ/履歴の保管先を検討する。無断で取得項目・履歴を捨てない。運用ログ30日、原本とレース事実は保存対象の直近30日について自動削除なしを初期案とし、変更は利用目的と費用を提示して決める。

## 13. 切り戻しと今回の到達点

mainとv0.1.10タグを保全する。停止は収集専用Cron/Functionを対象にし、本番commentsを削除・変更しない。現在はProject-012の`race_data`だけを対象に、Cron停止・Function削除・スキーマ切り戻しを行える。開発データ削除が必要な場合も、対象schemaとバックアップを検証して限定的に行う。

将来本番へ接続する際は、接続設定・Function・DB migration・Cron・Secretsの一覧と復元手順を別途作る。本書作成時点で「DBを含む全環境の復元試験が完了した」とはしない。

この段階の完了は、データが正しく保存・更新・検索検証されること。Gemini回答やルーレットへの採用は別段階とする。

## v0.1.16 運用補足（2026-09-24）

- JST当日の外部APIが一時的に404を返す場合は、当日中に限り5分後へ再予定し、少数回の失敗だけでquarantineしない。日付が変わった後の過去日にはこの特例を適用しない。
- `fetch_404` 以外のquarantine（解析失敗、整合性失敗、DB書き込み失敗など）は自動再キューしない。当日APIの公開待ちと恒久的な欠損を混同しない。
- `enqueue_date_tasks` が再キューできるのは、JST当日・`quarantined`・`last_error_code=fetch_404`の組合せに限定する。Schedulerの5分間隔は維持し、他のエラーの再試行方針は変更しない。
- ブラウザーは60秒ごとの締切再判定に加え、5分ごとに当日開催情報を再取得する。再取得が一時失敗した場合は既存の有効な選択肢を保持し、初回取得失敗時は安全側に選択不可とする。

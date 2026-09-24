# v0.1.13 DBに基づく3連単予想 — 詳細設計書

作成日：2026-09-21 JST。レビュー版・未実装。[基本設計](PREDICTION-BASIC-DESIGN-v0.1.13.md)と[未決事項・評価](PREDICTION-DESIGN-REVIEW-v0.1.13.md)を併読する。

表記：**確定**はユーザー合意、**設計案**は今回具体化した技術方針、**未決Dxx**は実装前の判断が必要。未決を既定値として黙って実装しない。

## v0.1.14実装範囲（100点最終設計との区別）

本書の100点配点は最終設計として保持する。v0.1.14では、仕様が確定している次の8項目だけを採点し、基本最大配点を66点とする：コース18、能力6、モーター14、平均ST9.6、展示タイム6.6、展示ST4.8、級別5、ボート2。各艇は欠損を0点にせず、利用できる項目の`effectiveMaximum`で`finalScore = earned / effectiveMaximum × 100`を計算する。

コース別成績16、直近10走3、今節成績4、会場・風・波7、体重・整備1、F/L信頼性2.4、チルト0.6の合計34点は次版送りとする。特にコース別成績・直近10走・今節成績は、基礎データが存在しても、集計期間、最低サンプル数、欠場・失格・F/L・異常着順の扱い、今節の節ID、正式得点率が未確定であるため、推測で採点しない。

## 1. 調査根拠と現行との差

以下をローカルで読んだ。SQLは適用状態の証明ではなく、ソース上の設計・実装証拠。

- `race-ingestion/normalize.mjs`、`records.mjs`。
- `supabase/migrations/20260920000000_race_data_ingestion.sql`と後続の検索・履歴・取得メタデータmigration。
- `supabase/functions/comments/ai-reply.mjs`：モデルgemini-3.1-flash-lite、15秒、512出力tokens、検索無効。新しい展開文処理はこのコメント設定を勝手に変えない。
- `script.js`：STARTはローカル重みと抽選。現在の結果はDB由来ではない。
- `docs/research/RACE-API-FINDINGS-20260920.md`、保存実レスポンス`C:/codex/project-012/research/v0.1.11-api-20260920/20260919.json`（156R）。
- [提供元README](https://github.com/boatraceopenapi/api)を今回参照。日付JSONのWebツール再取得は失敗したため、フィールド実確認には保存実レスポンスを使用。

修正点：`preview.racers.*.parts`にはキャブ・リング等の実値が存在する。「APIで取得不可」という旧説明は誤り。取得できても採点規則は未確定のため得点化は保留する。レース単位の上流更新時刻は未確認。`result.actual_course`を現在レースの予想に使わない。

現行INSERTは`race_entries.flying_count/late_count`やmotor/hull連対率の型付き列を埋めていない。`race_programs.closed_at`もINSERT対象外で`closed_at_source`に元文字列を保存している。存在する列をそのまま読むだけでは誤欠損・全レース選択不能となる。新規読み取りアダプターで型付き値と同一projectionのraw_jsonを検証して利用する。型付き列充填の収集migrationは必須とせず、収集基盤の改造を広げない。

## 2. モジュール分割（設計案）

| 追加予定 | 責務 |
|---|---|
| predictions/data-reader | 採用済みprojection固定、raw補完、履歴取得、カバレッジ |
| predictions/eligibility | JST当日、締切、中止、データ鮮度 |
| predictions/features | 時点付き過去集計、取得方式、欠損理由 |
| predictions/scoring | 純粋関数、基準表・内訳・有効満点 |
| predictions/ranking-picks | 内部値比較・タイブレーク・3点 |
| predictions/snapshot-store | 入力正規化、ハッシュ、排他、永続化 |
| predictions/narrative | Gemini入力・検証・文章試行履歴 |
| supabase/functions/predictions | HTTP境界・認証/負荷制限・診断 |
| frontend prediction client | 既存ルーレット・選択欄との接続 |

共通ロジックをローカル試験とEdgeで二重実装しない。Node/Deno双方で動く純粋JSを中心にし、暗号・DB・時刻・fetchは注入する。具体的配置は実装計画時に確定する。

## 3. API→DB対応表

`R = programs.stadiums[stadium].races[race]`、`E=R.racers[entry]`、`P=R.preview.racers[entry]`。履歴は同じ論理レースの複数snapshotを重複カウントしない。

| 評価項目 / APIフィールド | 取得方式 | DB経路 | 欠損・注意 |
|---|---|---|---|
| 枠番 E.entry_number | 直接 | race_entries.entry_number | 1〜6、機材boat_numberと混同禁止 |
| 展示進入 P.course_number | 直接 | preview_entries.exhibition_course | 不明なら枠番。resultの本番進入で代替禁止 |
| 級別 E.rank_number_source | 直接 | race_entries.rank_code / raw_json | A1/A2/B1/B2を検証。数値コードを推測しない |
| F/L E.flying_count / late_count | 直接 | 型付き列又は同一raw_json | 0とnullを区別。期間未確認ならD05 |
| 平均ST E.average_start_timing | 直接 | race_entries.average_st | 秒。異常値は除外 |
| 全国/当地 E.national_win_rate / local_win_rate | 直接 | 対応numeric列 | 率%でなく勝率値として段階表 |
| モーター E.motor_top_2_percent / motor_top_3_percent | 直接 | raw_json又は対応列 | 6艇両方必要、0〜100% |
| ボート E.boat_top_2_percent / boat_top_3_percent | 直接 | raw_json又はhull_top2/3_percent | 機材番号と枠を分離 |
| 展示 P.exhibition_time / start_timing | 直接 | exhibition_time_s / exhibition_st | source文字列も保存。F表記は通常の最速として扱わない |
| チルト P.tilt_adjustment | 直接 | preview_entries.tilt | 保存、補正表確定まで採点除外 |
| 体重 P.weight / weight_adjustment | 直接 | weight_kg / weight_adjustment_kg | 調整量を実体重と同一視しない。採点除外 |
| 部品 P.parts / propeller | 直接（形式差あり） | preview_entries.parts/propeller | 存在・空・null・値を区別。採点除外 |
| 風・波 R.preview.wind_direction_number / wind_speed / wave_height | 直接 | race_previews | result側の後日天候で埋めない。採点除外 |
| 選手コース別1/2/3着率 | 過去から算出 | result_entries.actual_course/finish_position、登録番号 | 対象コースの母数不足時は除外。D03/D04 |
| 直近10走 | 過去から算出 | result_entriesとraces、観測版 | 現レース・未来結果を除外。期間内不足はD03 |
| 今節平均着順 | 過去から算出 | race_programs.day_number/title＋過去結果 | 節を確定できなければ除外 |
| 今節正式得点率 | 現状取得不可として保留 | 配点・減点根拠がない | 着順から正式得点率を捏造しない。平均着順へ代替 |
| 会場コースの全国平均との差 | 過去から算出可能 | 過去actual_course/finish_position | 基準期間・母数・補正表未確定、採点除外 |
| 現在の気配 | 算出・説明概念 | 展示等の既存項目 | 独立した加点欄を作らない |
| 締切 R.closed_at | 直接 | closed_at_sourceをJST変換 | 不明なら生成禁止。発走時刻と呼ばない |
| レース単位の上流更新時刻 | 取得不可/未確認 | source_updated_at=null | HTTP Last-Modifiedとは別 |

読み取り優先：同一projectionで検証済み型付き値→同じ版のraw値→欠損。両方存在して不一致なら`source_conflict`で除外/停止し、別版から都合のよい値を拾わない。全特徴量にvalue、unit、source_mode、projection_id、observed_at、missing_reasonを付ける。

## 4. 読み取り・履歴集計・未来情報遮断

1. DBトランザクション内で対象日day_headsと関連する採用版を固定する。既存DBはreadyをheadに載せるため、単純なstate='published'限定にしない。
2. current_batch_id→snapshot_races→program/previewのprojectionを取得する。resultは中止・完了を検出する用途だけに限定。現行INSERTは結果行配列があるだけでavailableとなるため、result_stateやオブジェクト存在だけで締切/完了を判定しない。実際の着順・明示中止情報と締切を検証する。未確定6行がある正常な締切前レースを誤ってclosedにしない。
3. 過去集計は選手登録番号で結合し、同じrace_id/entryの重複版を1件にする。候補結果の観測・採用時刻が予想as_of以前であることを必須とする。
4. 後から取得した過去結果を過去時点のバックテストへ混ぜない。日付が古いだけでは当時既知の証拠にならない。
5. 節IDはタイトル単独で作らない。場・day_numberからの開始日候補と連続開催データを検証し、中断等で確定できないときは今節項目を欠損扱い。
6. 集計に使ったrace_id/projection_id、着順、コース、観測時刻、除外明細と母数をsnapshotへ埋める。元データの後日訂正でも再現可能にする。

未決D03：直近10走の観測不足、コース別の集計期間・最低母数、F/L/欠場/失格の分母と平均着順の扱い。初期設計案は保有DBの予想時点前の直近30日を上限、直近10走が確認できなければ直近項目を欠損、コース別は最低5走を仮条件とする。これは未承認であり設定値を確定してから実装する。正常着順だけ選別すると好成績へ偏るため、異常着順を黙って除いて「直近10走」と称しない。

## 5. 正規化・採点の共通手順

1. 必須識別・締切・6艇の重複/不足を検証。
2. 使う評価版と入力を固定。確率・%・秒・kgの単位を統一。
3. 項目ごとに欠損・不正・補正表未確定を判定し、availability maskを作る。
4. 6艇相対項目は6艇共通maskを使う。欠損を0点に変換しない。
5. 指標の段階評価または合成生値→相対評価を実行。
6. 許可された項目内再配分だけを実行し、有効得点pと有効満点mを加算。
7. S=100×Σp/Σm。m=0なら生成停止。小数内部値を丸めず順位付け。

**項目内再換算と全体の除外は別物**。D05確定により、選手F/Lの対象期間・意味が確認できるまでは、値があってもF/L枠2.4点全体を分母から除外する。「FだけあればF100%」という従来の規則は、期間・意味を検証して採点を有効化した後に限る。会場7点や展示小項目の除外分も他項目へ直接配らず、全体式で換算する。

全艇欠損の影響が対称とは限らない。有効満点をそのまま確信度・的中確率にしない。品質表示と内部診断に使用する。

### 5.1 段階表（確定値の境界を明文化）

比較前丸めはしない。原データ精度で区間を判断し、隙間のある「2.01〜」等を実装しない。

| 評価 | 入力区間 → 0〜100点 |
|---|---|
| コース | 1:100、2:70、3:65、4:50、5:35、6:20 |
| 級別 | A1:100、A2:75、B1:45、B2:20 |
| 平均ST | ≤.12:100、(.12,.14]:80、(.14,.16]:60、(.16,.18]:40、>.18:20 |
| F/L回数（採点保留） | 0:100、1:70、2:40、≥3:20。非負整数。対象期間・意味の確認後にのみ使用 |
| 勝率 | ≥7:100、[6.5,7):85、[6,6.5):70、[5.5,6):55、[5,5.5):40、<5:25 |
| 直近3連対率% | ≥60:100、[50,60):85、[40,50):70、[30,40):55、[20,30):40、<20:25 |
| 直近平均着順 | ≤2:100、(2,2.5]:85、(2.5,3]:70、(3,3.5]:55、(3.5,4]:40、>4:25 |

コース別合成値の段階表（D04、今回ユーザーが仮の初期値として承認）：[40,50]→100、[30,40)→80、[20,30)→60、[10,20)→40、[0,10)→20。合成値は0〜50の範囲（各着順率%が排他的な場合）。勝率の段階表を流用しない。最適性は未検証であり設定変更可能にする。

### 5.2 各項目の計算

| ID | 手順 | 欠損時の分母 |
|---|---|---|
| C01 18 | courseScore×.18。展示進入の信頼できる組合せがなければ枠番 | 両方なしは18除外 |
| C02 16 | p1,p2,p3を排他的着順率として.5p1+.3p2+.2p3→D04段階表→×.16 | 当該艇16除外。母数と対象コースを保存 |
| C03 14 | .7×motorTop2+.3×(motorTop3−motorTop2)を6艇で順位化→×.14 | 1艇でも片率欠損なら全艇14除外 |
| C04 12 | 当面はST基準点×.096のみ。F/Lの2.4点は期間・意味確認まで採点除外 | 平均STなしはさらに9.6除外。F/L値の有無にかかわらず当面2.4除外 |
| C05 12 | 展示タイム相対点×.066＋展示ST相対点×.048。チルト.6点保留 | D02確定：小項目ごとに6艇要件。D05確定：展示F/Lが1艇でもあれば展示STを全艇除外。残った側へ配分しない |
| C06 9 | 全国/当地6点、直近10走3点（D01確認済み） | 下記5.3 |
| C07 7 | 補正表確定まで採点しない | 全艇7除外、0点扱いしない |
| C08 5 | 級別点×.05 | 当該艇5除外 |
| C09 4 | 6艇に同じ指標を使い、正式得点率降順or平均着順昇順で相対点×.04 | 6艇で得点率が揃わなければ全艇平均着順を試す。それも欠ければ全艇4除外 |
| C10 2 | .7×hullTop2+.3×(hullTop3−hullTop2)の6艇順位→×.02 | 1艇欠損なら全艇2除外 |
| C11 1 | 補正表確定まで採点しない | 全艇1除外 |

モーター/ボートは**先に率を合成し、次に順位化**する。率ごとに順位化してから合成する方式とは結果が違うため併用しない。

率の不整合：極小の丸め差だけ許容幅を設定して0補正する。大きくtop3<top2となる場合は不正入力。1〜3着率を合計100%へ再正規化して4〜6着を消さない。原値・補正・理由を保存する。

### 5.3 実力・近況9点（D01）

全国・当地の合成比率60:40、直近3連対率・平均着順60:40は確定。従来「9点を直近だけ」と「全国・当地を加点」が矛盾していたため内訳確認を実施し、今回ユーザーは実力6点・直近3点を選択した。旧9点を直近だけとする記録は、この確認で更新する。

確定：実力6点＋直近3点。実力点=.06×(.6×全国基準点+.4×当地基準点)、直近点=.03×(.6×直近3連対基準点+.4×直近平均着順基準点)。片方欠損は各枠内で取得側100%へ再換算する設計案。両方欠損ならその6点又は3点を除外。全国・当地が直近項目へ混ざらない。

### 5.4 相対評価と同値（設計案）

順位点は100/80/60/40/20/0。同値グループには占有順位の平均点を付与する（1・2位同値なら90点、全艇同値なら50点）。同じ計測値なのに枠番で評価点を変えない。最終総合順位だけで既定のタイブレークを使用する。

D05確定：展示STのF又はL表記が1艇でもあれば、レース全体で展示ST4.8点を採点除外する。F.03/-0.03を最速として高評価しない。start_timing_sourceと数値を併読し、表記が消えた負数も通常STとしない。読めない表記は欠損扱いとし、D02の6艇要件を適用する。元表記、値、除外理由（exhibition_st_fl又はinvalid_exhibition_st）を保存する。

展示タイムが全艇揃えば、展示STを除外しても6.6点は採用する。逆の場合は4.8点だけ採用し、両方不成立なら11.4点を除外する。どの場合も12点へ再配分しない。

### 5.5 精度・同点（設計案）

小数文字列を有理数として保持して比較し、JS浮動小数誤差や表示丸めで順位を変えない。中間値は分子/分母も保存し、DB表示用numericは別にする。同点は内部値の交差積で判定。最終点→展示タイム昇順→有効展示ST昇順→平均ST昇順→C03点降順→枠番昇順。比較指標が片方でも欠損なら、その指標を飛ばす。推移律を壊さないため、総合点同値グループ全体に揃う指標だけ使用する。

## 6. 本命・対抗・穴

総合順位の艇番号列rを作り、本命=[r1,r2,r3]、対抗=[r2,r1,r4]。

穴の候補はr4,r5,r6。元の6艇比較で計算した展示タイム点T、展示ST点E、モーター点M、平均ST段階点Aを使い、U=.30T+.30E+.25M+.15Aとする。候補3艇だけで順位点を再計算しない。各指標を0〜100に揃え、14点満点のモーター寄与をそのまま足さない。

設計案：候補3艇共通で使える指標だけに重みを再配分。分母が0なら穴を生成せずpartial。U同点は総合順位上位、それも同一なら枠番順。穴=[候補,残る総合上位1,残る総合上位2]。存在・1〜6・重複なしを検証する。穴判定スコアは上振れの確率ではない。

今回ユーザー確認済み：6艇不足/欠場時は3点とも生成停止、穴材料全欠損なら穴だけ生成しない。順位を0や架空艇で埋めない。D02/D05で採点除外した展示STは、穴のEにも同点比較にも復活させない。穴の欠損時の重み再換算は本節の設計案であり、総合点の展示配点を残った側へ移す処理ではない。

## 7. 締切・鮮度

closed_at_sourceの例は`2026-09-19 10:47:00`。この形式はAsia/Tokyoとして解析しUTC timestamptzへ変換する。文字列比較・端末のローカルTZ任せは禁止。不明は`api_error/deadline_unknown`。

fresh判定の時間源はサーバー時刻。展示タイム又は展示STが少なくとも1つ有効なら展示後扱い（初期設計案）。体重やチルトだけの掲載を展示終了とはみなさない。今の版を含む成功観測のchecked_atとの差が、展示後600秒以内、展示前1800秒以内なら取得鮮度として有効。失敗取得はchecked_atを進めない。304は対象ETag/版との対応と採用履歴が確認できた時だけ再確認として有効。

source_updated_atは実値がなければnull。file_last_modified、first_seen_at、checked_atを別保存。更新が止まった提供元が200/304を返す事象はこの方式だけでは検出できない。この限界を運用資料へ残す。

START受付、計算を確定保存する直前、既存予想再利用の直前で締切と鮮度を検査。締切をまたいだリクエストは新規予想として公開しない。Gemini待ちで締切を過ぎても締切前に確定保存済みの計算結果は履歴として残し、新規の有効予想を作ったように扱わない。

## 8. 入力ハッシュと再利用

canonicalInputにはレースキー、6艇の特徴値・欠損mask・courseSource、履歴集計の母数/観測版、特徴抽出版を含める。キーはソート、艇は枠番順、単位・数値表現を固定しSHA-256を作る。

request_id、予想実行時刻、単なる再取得時刻、無関係な他レース、API秘密情報はハッシュに含めない。未来情報フィルター後の実際の入力だけを含める。履歴入力や設定が変われば同じ当日JSONでも新しい計算となる。

計算再利用キー：(race_id,input_data_hash,score_config_version,logic_version)。特徴抽出版の変更はlogic_version又はhash契約版を更新する。設定はversionだけでなく全文/hashも保存する。

競合対策：DBの一意制約と短期lease付き生成予約を用意し、同一入力への同時STARTで重複生成しない。外部Gemini呼び出し中にDB transaction/lockを維持しない。lease失効と再試行を許容し、挿入競合は先に保存された同じsnapshotを返す。

## 9. 保存スキーマ（追加のみ・設計案）

専用`race_prediction`スキーマ。以下は設計でありmigrationは作成・実行しない。

### predictions（計算成功時の不変本体）

| 列 | 型・制約 |
|---|---|
| prediction_id | uuid PK |
| race_id / race_date / stadium_code / race_number | 元レース参照＋検索用識別。削除連鎖なし |
| generated_at / as_of / api_fetched_at | timestamptz NOT NULL |
| source_updated_at | timestamptz NULL可 |
| input_data_hash / hash_version | text NOT NULL |
| score_config_version / logic_version | text NOT NULL |
| calculation_status | success / partial |
| rankings / scores | jsonb、6艇の識別・内部値・表示用値 |
| main_pick / counter_pick / upset_pick | smallint[3]、各1〜6・配列内重複なし。欠損予想はNULL |
| inputs / calculations / exclusions / config_snapshot / source_refs | jsonb NOT NULL |

計算成功を先に保存するためgeneration_statusを本体必須列にすると整合しない。本体にcalculation_statusを置き、generation_statusは次の試行と結合するread modelで導出し、request完了記録にも保存する。旧「1テーブルで全状態」の案はこの分離で実現する。

### narrative_attempts（不変・追加のみ）

attempt_id UUID PK、prediction_id FK、attempt_sequence、model、prompt_version、prompt_hash、narrative_input_hash、started_at、finished_at、status(success/error)、text、validated_facts、error_code、sanitized_error、error_at、token_usage、duration_ms。予想本体の文章を上書きしない。成功文章と再試行の失敗が共存したとき、同一モデル/版では直近成功を表示する。

### prediction_requests（診断）とgeneration_jobs（運用可変）

requests：request_id、race key、prediction_id nullable、outcome、reason_code、timestamp、reused、data_versions、duration。stale/closed/取得不能の失敗はここに記録し、架空の計算snapshotを作らない。認証情報やGeminiキーは保存しない。

jobs：一意生成キー、lease_token、lease_until、state、prediction_id nullable。運用予約だけ更新可。計算本体・文章試行の不変性と混同しない。

索引：predictions(race_id,generated_at DESC)、再利用キーUNIQUE、attempts(prediction_id,attempt_sequence)、requests(request_id)。保存JSONは日次1.5MB全体でなく6艇と採用した履歴証拠に限定する。予想と詳細JSONは自動削除・圧縮しない。容量を件数/日・平均/最大JSON・索引込みDBサイズで実測し、満杯では保存失敗を隠して成功を返さない。

## 10. Gemini展開文

専用処理。計算確定後に1レースの構造化事実のみ送る。race(日付/場/R/生成時刻)、picks、boats(フルネーム、総合点、順位、展示進入とsource、展示順位/ST、平均ST、motorRank)、keyFactors、weakFactors、excludedItems、coverageを含める。名称不明は号艇だけ。

key/weakFactorsはバックエンドが利用指標に結び付けて作る。例：motorRank=1→「モーター連対率の比較で上位」。これを「モーター気配が良い」「差しが得意」と変換しない。予測文は想定と明示し、事実と結果保証を分ける。全国/当地の比較は合意済みの評価に基づく場合だけ記述。

初期技術案：既存同モデル、検索・Function Callingなし、15秒・最大512出力tokensを設定化。新しいAPI契約の対応は実装時に一次資料と疎通で再確認。コメントのキャラ指示や定型文を自動流用しない。文体・長さ・実行予算はD07で確認する。

出力設計案：`{text:string, citedFactorIds:string[]}`。JSON形、空文、長さ、引用factor ID存在、別レース/別選手/未提示数値/URLを検査。出力数字はUIの予想データ源にしない。検証で意味的整合性を完全保証できないため複数パターンの文章レビューが必要。MAX_TOKENS、HTTP429、権限、timeout、JSON不正、不正根拠を個別コードで記録する。

文章だけ再試行するとき計算snapshotを再読込し、スコア関数を呼ばない。モデル・プロンプト版を変えても予想数字は変えず新しい文章試行を追加する。自動無限再試行は禁止。

## 11. HTTPと画面（設計案）

| 操作 | 契約 |
|---|---|
| GET /predictions?action=races | JST当日の会場・R・締切・選択可否、serverNow。DB内部JSONは返さない |
| POST /predictions | raceDate,stadiumCode,raceNumber,requestId。点数・配点・Gemini指示はクライアントから受けない |
| GET /predictions?id=... | 公開してよい結果/文章/状態。詳細計算の管理用証拠は非公開 |
| POST /predictions?action=narrative-retry | predictionIdとrequestId。対応snapshotの文章だけ再試行、負荷制限 |

成功200、生成中202（reservation idとretryAfter）、入力不正400、締切409、stale/データ不足422、DB障害503、負荷制限429。本文statusは基本設計の状態表に従う。gemini_errorは数字有効なので200。診断コードはdb_read_failed/db_write_failed/insufficient_entries等を持たせる。

画面はSTART時に選択値とrequest tokenを固定。回転開始、対抗・穴は仮表示、結果が到着してから本命を停止し下段を同じprediction_idで更新する。連打防止、会場変更後の古いHTTP応答破棄、エラー時の回転停止・ボタン復旧を設計する。旧重みへの自動フォールバックはしない。

現在レースの最新success/partial/gemini_errorを候補にするが、現データ・現設定で有効かを検査してから利用する。以前の有効予想をstale時の「新しい予想」として表示しない。選択肢のグレー化はブラウザーで補助し、最終締切判断は必ずサーバー側。

## 12. 権限と運用

race_data、race_predictionへのanon/authenticated直接アクセスを禁止し、読み取り/書き込みRPCはservice_role限定。public wrapperを使う場合はEXECUTE権限を明示し、SECURITY DEFINERのsearch_pathを固定。ブラウザー入力からSQL・任意filter・system promptを作らない。

許可originだけのCORSは認証の代わりにはならない。既存公開匿名UIに合わせ、サーバー側の入力範囲・レート制限・同一入力重複排除・Gemini呼出上限を設定する。具体的上限はD07で確定。APIキーは既存Secretをサーバーだけで読む。

障害切り分けはrequest_id→prediction_id→narrative attempt→source batch/runの関連で行う。ログはコード・段階・時刻UTC・経過ms・モデル・HTTP status・finishReason・採点有効満点を記録。画面の日本時間とUTCの差を運用記録に示す。

## 13. 実装・試験のゲート

順序：未決確定→純粋採点→DB読取り→保存/排他→Gemini→UI→ステージング相当検証→公開承認。各段階で少なくとも5パターン、前段の失敗を残したまま次へ進まない。今回以下は**試験仕様**であり実行済みではない。

| 段階 | 最低試験セット（各5件以上） |
|---|---|
| 入力 | raw補完、型付き値矛盾、枠と機材番号、JST変換、欠場/重複、parts実例 |
| 履歴 | 未来結果排除、後日訂正排除、同一race重複、10走未満、節不明、F/L/失格 |
| 採点 | 率差分と合成順、相対1艇欠損、同値平均順位、段階境界、項目内再換算、分母0、補正表除外 |
| 順位/3点 | 小数差、完全同点、欠損タイブレーク、対抗4位採用、穴共通mask、穴全欠損、全3点異なる |
| 鮮度 | 展示前1800秒境界、展示後600秒境界、締切同時刻、304再確認、失敗で時刻更新しない、Gemini中締切 |
| 保存 | 不変性、同時START、設定版変更、入力内容同一再取得、保存失敗、lease失効、再試行で予想不変 |
| Gemini | 成功、429、timeout、MAX_TOKENS、JSON不正、架空選手/戦法、partial＋文章失敗 |
| UI | 320/360/390/430px、別レース遅延応答、連打、締切、stale、文章失敗数字維持、コメント既存機能 |
| 復元 | v0.1.12画面復元、新Function停止、comments維持、ingest維持、snapshot保持、旧タグ不変 |

## v0.1.14 追記 — 確定実装契約

### generation leaseの状態遷移

`acquire_prediction_generation(reuse_key, 45)`は、最初の要求に`acquired`とlease tokenを返す。期限内に同じキーを受けた要求は`busy`を返し、Edge FunctionはHTTP 202・`generating`・`retryAfter`を返す。snapshotが既に存在する場合は`existing`を返し、保存済み予想と直近成功文章を再利用する。leaseの失敗解除は明示DELETEではなく45秒の自然失効と次回取得による回収で行う。

snapshot作成には`reuse_key`のunique indexを使い、lease競合を通過した同時INSERTも既存IDへ収束させる。文章試行は同じ`prediction_id`へ追加保存し、採番時にtransaction advisory lockを取得する。

### migration適用順

`20260922000000_prediction_snapshots_v0_1_14.sql`でスキーマ、snapshot、lease、snapshot作成RPC、lease取得RPCを作成する。その後`20260922000001_narrative_attempts_v0_1_14.sql`で文章試行、snapshot読取RPC、文章保存RPCを作成する。後続migrationでsnapshot読取RPCを再定義し、直近成功文章を含める。各migrationは`if not exists`または`create or replace`を用い、クリーンDBへファイル順に適用できる。

### 権限契約

`race_prediction`スキーマと2つの予想テーブルはブラウザロールへ権限を付与しない。内部関数も`service_role`だけにEXECUTEを付与する。`public.race_data_*`という既存命名のwrapperは互換名であり、EXECUTEはservice_roleだけである。Edge Function以外のクライアントからの直接操作は許可しない。

### Gemini設定と文章試行

初期値は`RACE_NARRATIVE_MODEL=gemini-3.1-flash-lite`、`RACE_NARRATIVE_TIMEOUT_MS=15000`、`RACE_NARRATIVE_MAX_OUTPUT_TOKENS=1024`、`RACE_NARRATIVE_MAX_CHARS=650`、`RACE_NARRATIVE_PROMPT_VERSION=v0.1.16-narrative-3`。文章は450〜650文字・原則3段落とし、選手名は入力された号艇とフルネームを使用する。APIキーは`GEMINI_API_KEY`から読み、コメントAIの設定値を共有しない。D07確定後も環境設定と版を記録し、文章入力ハッシュ・プロンプトハッシュ・引用根拠IDを試行履歴へ保存する。

### 統合試験と切り戻し

合格には、レース取得からWeb表示までの実DB E2Eを1件、同一入力の同時2要求でsnapshotが1件だけになる試験を1件含める。失敗時も予想本体が残り、文章試行だけがerrorになることを確認する。切り戻し時はフロントとEdge Functionをv0.1.13へ戻して予想機能を停止し、`race_prediction`データは保持する。migrationのdownやテーブル削除は初期手順に含めない。

数値オラクル例：有効得点66.75/有効満点89.0→75。motor top2=40%,top3=60%→生合成34（率の順位化前）。総合順位[3,1,5,2,6,4]→本命[3,1,5]、対抗[1,3,2]、穴候補6選出なら[6,3,1]。相対1・2位同値は90/90、全艇同値50。例は配点の正しさや的中率を検証したものではない。

D02/D05追加試験仕様（未実行）：他項目が全て有効なら上限89.0点、展示タイム1艇欠損で82.4点、展示ST1艇欠損又はF/Lで84.2点、両方不成立で77.6点。F/L回数が全艇0でも期間未確認なら2.4点除外を維持する。F.01、L表記、数値−0.01、未解釈文字列を試し、穴・同点比較へ除外値が混入しないことを確認する。

バックテストは当時のsnapshot、別期間の検証集合、母数、欠損率、既存方式との比較を報告する。締切後に集めた展示を使った的中率を本番改善実績と呼ばない。

## 14. 復元点と非対象

ローカルcommit確認：v0.1.10=`ddf3e476d65f8625602e10669322434c2a7f475d`、v0.1.11=`543e2e9db77fee6eea4781a21614470244677241`、v0.1.12=`bd199a784a94708bc5ccb36be45ed2ae387a3e79`。タグオブジェクトIDとcommit IDは区別する。

新機能は追加表/Functionとフロント差分に限定。復元時の表DROPや既存データ削除を必須にしない。DB・Cron・Secretsの完全復元は別途稼働状態とバックアップの検証が必要。Gitタグ存在だけで全環境復元試験済みとはしない。


### v0.1.14 score-3 公開前修正

負の展示STは全艇の展示ST採点・穴評価・文章根拠から除外する。展示タイム同点比較はtimeを参照する。configVersionはv0.1.14-score-3。

components.included[].earnedは、その項目を採点可能な艇だけの平均寄与点（欠損艇を0点で含めない）。included[].maximumは項目の配点。components.earnedとmaximumはそれぞれincludedの合計であり、各艇のeffectiveMaximumの平均ではない。艇別得点・順位計算にはこの診断集計値を使用しない。

入力ハッシュはレース識別情報と、艇番・氏名・進入コース・級別・平均ST・全国/当地勝率・モーター/ボート2連対率と3連対率・展示タイム・展示STの明示的許可リストを固定順に構成し、configVersionとlogicVersionを含める。採点除外値はnullにし、数値文字列は数値へ正規化する。氏名は数値採点ではなく保存予想と文章の人物同一性のため保持する。取得時刻・batch_id・result・その他管理情報は含めない。締切と鮮度は再利用前に毎回確認する。

画面の生成待ちはretryAfterに従い最大5要求・60秒。200の有効予想のみ描画し、失敗・タイムアウトは操作可能状態へ戻す。締切欠損・不正はdeadline_unavailableで生成停止。旧snapshotは保持する。

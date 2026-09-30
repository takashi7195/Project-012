# v0.1.19 受入70項目の試験対応表

> 2026-09-29 利用者指示により、公開前必須と公開後の追加確認を[公開判定計画](AI-PREDICTION-REFRESH-RELEASE-GATES.md)で区分する。従来の70項目の期待結果・合否は維持し、初回69項目すべての完了を公開の一律条件とする記述は同計画に置き換える。

作成日: 2026-09-27 JST。対応: [試験計画書](AI-PREDICTION-REFRESH-TEST-PLAN.md)、[試験仕様兼試験成績書](AI-PREDICTION-REFRESH-TEST-REPORT.md)。

この表は実施方法・既存資産・不足証跡の対応であり、合否表ではない。期待結果は試験仕様を参照する。既存資産欄はコードを読んで選んだ補助証跡の候補で、当該IDの全条件を既に検証済みとは意味しない。P1のログ補強後、ソース識別と過去の実測を照合して採用する。70件中、M03だけが初回公開の対象外。

## 既存資産の凡例

| 記号 | ファイル/証跡 | 限界 |
|---|---|---|
| A | `race-prediction/ai-contract.test.mjs` | module/モック |
| B | `race-prediction/ai-generation.test.mjs` | store/fetch/時刻のモック |
| C | `race-prediction/ai-client.test.mjs` | polling/中止のモック |
| D | `race-prediction/ai-edge-handler.test.mjs` | handlerのモック結合 |
| E | `race-prediction/ai-migration-static.test.mjs` | 定義の静的照合 |
| F | `tools/local-integration/ai-bundle-db-smoke.sh`、既存のDB成功ログ | 実DBの一部条件 |
| G | `tools/local-integration/ai-edge-local-smoke.mjs` | HTTP境界。正常生成なし |
| H | `tools/local-integration/ai-edge-postgrest-smoke.mjs` | 実input/read RPC。fixture生成なし |
| I | `tools/local-integration/ai-gemini-live-smoke.mjs`、前回503 | 合成入力1種類、DB保存なし |
| J | `prediction-static.test.mjs`、`release-regression.test.mjs`等 | 静的/モック中心。実画面の代用にしない |
| — | 対応する十分な実行証跡をまだ特定できていない | 新規/拡張試験を準備 |

全IDの実行・証跡整理はCodexが担当する。U群の見た目・実機、M02の文章内容は利用者と共同確認。M06の運用/公開判断は利用者。環境が未整備の間はblockedを記録して依存しない項目へ進む。

## 個別対応

| ID | 段階 | 条件（試験仕様から） | 既存資産候補 | 残る確認・準備 |
|---|---|---|---|---|
| I01 | P3 | F01を専用RPCから組立 | A/F | passed。公開sample 156レースのnormalize/records/AI input確認と、実sampleの1レースを一時fixture経由で専用RPCへ通した全事前項目照合を完了 [I01実RPC証跡](test-evidence/v0.1.19/20260929-i01-source-postgrest.json) |
| I02 | P2/P3 | F07を入力化 | A/E/F | 結果・払戻等の全除外パターンを深い階層まで確認 |
| I03 | P2/P3 | F03、null/欠落/空配列/原文を含める | A | null/欠落/空配列/原文を実入力でも区別 |
| I04 | P3 | 入力RPCから選手/モーターのAPI内集計値を取得 | A/F | 既存PostgREST fixtureで値を比較。R05に従い過去日・選手履歴の追加検索なし。過去レース結果は投入・送信しない |
| I05 | P3 | F02/F03を生成入口へ送る | A/D | 展示欠損の各形で実EdgeからAI送信へ進む |
| I06 | P2/P3 | F05の6艇の識別ができない/矛盾する各パターンを送る | A/D | 6艇識別の不正パターンを網羅し、送信0回を確認 |
| I07 | P2/P3 | F06を各パターンで送る | D/F | 過去日・締切不明・不正日時・締切後を入口から確認 |
| I08 | P3 | F04を各パターンで送る | — | 11分/31分/時刻不明等の古い当日データで生成開始 |
| I09 | P3 | 読取中にday_headsを更新 | — | 読取途中にday_heads更新を入れ、採用batch一致を確認 |
| I10 | P2/P3 | タイトル等に指示風文字列、未知の事前項目を追加 | A | 指示風文字列と未知項目の保持・結果境界を確認 |
| I11 | P2/P3 | 艇番1〜6のエントリーがあり、氏名/登録番号の一部のみ欠損 | A | 氏名と登録番号の欠損パターンを実入口で確認 |
| G01 | P2 | 初期requestを採取 | A | 現在の全requestを採取し合意外の誘導がないか照合 |
| G02 | P2/P3 | F10の正常JSONを返す | A/B/D | 同一応答の4項目が一組として保存されることを確認 |
| G03 | P2 | 各買い目内重複・範囲外・長さ不正・文字列艇番 | A/E | 買い目各型・長さ・範囲の組合せを補完 |
| G04 | P2/P3 | main=counter等、完全一致を返す | A/F | 3組間の全重複と一部共通の許容を網羅 |
| G05 | P2/P3 | 買い目欠落/null、文章空白のみ、壊れたJSON | A/B | 欠落/null/空文/JSON不正で部分保存・表示なし |
| G06 | P2/P5 | 短文/500字超/1000字超、1段落/複数段落 | A | 短文/長文/段落の全条件と画面の非切断を確認 |
| G07 | P3 | 初回重複→2回目正常 | B | 一度目重複からの修正要求と二度目だけの一括保存 |
| G08 | P3 | 初回不正→2回目不正 | B | 実jobで送信上限・非保存・旧方式への逃避なしを確認 |
| G09 | P2/P3 | F08を比較 | A | F08全条件で実reuseKeyと保存結果IDを照合 |
| G10 | P2/P3 | F09を各項目で比較 | A | F09の事前情報各項目でキー変更を確認 |
| G11 | P2/P3 | モデル/指示文/口調/推論設定/Schema版を変更 | A | 全設定項目の変更と旧キャッシュ不採用を確認 |
| G12 | P2 | 対応Geminiモデル設定を交換、未対応provider/パラメーターも指定 | A | UI契約を維持した設定切替と送信前の拒否を確認。新provider実装を要求しない |
| G13 | P3 | 初回生成中に入力/モデル/指示文設定を変更し、修正再生成 | B/D | 生成中の入力/設定変更を入れ、既存jobと新jobを比較 |
| T01 | P2/P3 | 初回20秒で一時通信失敗→2回目成功 | B | 初回20秒失敗を実結合で再現し保存を含む時間を計測 |
| T02 | P2/P3 | 両要求を遅延させる | B/C | 仮想時刻に加え必要な実時間で90秒の終了を確認 |
| T03 | P2/P3 | 通信例外/408/5xx→成功 | B | 各一時障害の記録・バックオフ・最大2回を確認 |
| T04 | P2/P3 | 短期429、日次枠超過、長いRetry-After | B | 短期/日次429、Retry-Afterの長さと残時間を網羅 |
| T05 | P2/P3 | 401/403/未対応モデル等を返す | B/D | 即時終了と公開応答へのprovider詳細非露出 |
| T06 | P2/P3 | MAX_TOKENS等の未完了応答 | B | 打切り理由と有効長文を区別し一組の再生成を確認 |
| T07 | P2/P3 | 202が5回を超えて続き60秒で成功 | A/C | 5回を超えるGETと60秒成功を結合確認 |
| T08 | P2/P3 | PC時計差、remainingMs延長応答、状態GET一時失敗 | C | PC時計差・期限延長応答・GET障害の各条件を確認 |
| T09 | P3 | 初回AIが50秒/70秒で正常完了 | B | 50秒/70秒の実時間で1回の生成→保存→表示を計測 |
| T10 | P2/P3 | 初回が生成用残時間を使い切り、2回目の時間がない | B | 初回で時間を使い切る実jobで2回目なしを確認 |
| T11 | P3/P5 | claimのロック待機、残2秒の状態GET、retryable=falseを個別確認 | C/D | DBロック待ち・残2秒GET・再試行不可表示を個別確認 |
| D01 | P3 | 正常生成を保存 | F | 実Edge→DBでbundle/attempt/job/keyの同一確定を確認 |
| D02 | P3 | F12の保存前エラー | B/F | 保存前の実DB障害、非成功表示、AI再送なし |
| D03 | P3 | 保存commit後の応答消失 | B | commit後に応答を落とし読取/冪等保存で同じIDを確認 |
| D04 | P3 | 同じreuseKeyへ同時20要求 | F | 20同時claim証跡に実Edgeと模擬AIの送信回数を追加 |
| D05 | P3 | 0秒START、30秒後に参加、60秒で保存 | — | 0秒/30秒開始・60秒成功を計測し先行期限を確認 |
| D06 | P3 | 2番目START前にF09へ更新 | — | 入力更新後の別job/bundleと先行入力固定を確認 |
| D07 | P3/P6 | 先行ブラウザー切断、後続が継続 | D | Handler/PostgRESTは部分確認済み。実Edgeの同条件反復は新しい根拠が得られるまで停止。原因を絞る独立条件が見つかった場合に後続GETを確認 |
| D08 | P3 | worker終了、期限切れ→締切前の手動START | F | 実worker停止、GETのみ非再起動、手動START復帰 |
| D09 | P3 | 旧ownerが新job開始後に遅延保存 | F | 旧owner拒否の既存DB証跡を照合し実worker遅延を追加 |
| D10 | P3 | 締切前開始→締切後に初回不正→再生成成功 | — | 締切を跨いだ修正再生成と保存/GETを一連で確認 |
| D11 | P3 | 締切後に新規POST、開始済みjobのGETを比較 | F | キャッシュ有無の締切後POSTと開始済みjob GETを比較 |
| D12 | P3 | DB制約へ不正配列・null要素・多次元配列・空文・duplicate key・別キーのbundle参照を投入 | E/F | 全配列/null/キー/FK制約を実DBで網羅 |
| D13 | P3 | anon/authenticated/service_role権限を確認 | D/E/F/G | 実ロール別権限、HTTP公開結果、秘密非露出を確認 |
| D14 | P3 | 時刻だけ更新して成功結果を再取得 | — | 時刻だけ更新し、初回送信payload/取得時刻の保持を確認 |
| D15 | P3 | begin_ai_attemptの重複呼出/応答消失、初回不成功記録を確認 | B/F | 重複beginに加え応答消失・失敗記録と送信回数を確認 |
| D16 | P3 | 成功保存と期限切れGETを同時実行 | E | 成功保存と期限切れGETの実競合で状態を確認 |
| U01 | P5 | 初期表示→会場/レース選択 | D/J | passed。Edge/Playwrightで待機1-2-3、会場のみSTART無効、レース選択後有効、選択だけのPOST 0回を確認 [UI evidence](test-evidence/v0.1.19/20260929-ui-animation-timings.json) |
| U02 | P5 | START→速い結果/遅い結果 | J | passed。fast/slow responseで最小待機と停止完了後の6秒/9秒をPlaywright/Edge計測 [timing evidence](test-evidence/v0.1.19/20260929-ui-animation-timings.json) |
| U03 | P5 | 全停止前後を観測 | J | passed。全停止後にcounter/hole/narrativeを一括表示し、約500msを計測 [timing evidence](test-evidence/v0.1.19/20260929-ui-animation-timings.json) |
| U04 | P5 | 待機中の定期更新・日付切替・締切到来 | J | 待機中の更新・日付・締切を制御して操作状態を確認 |
| U05 | P5 | 通信/検証/保存の各失敗 | D/J | passed。browser mockでHTTP503/通信切断/無効bundle/保存失敗応答すべての案内・結果消去・1-2-3復帰を確認。保存前の実PostgREST失敗はD02で確認 [UI evidence](test-evidence/v0.1.19/20260929-ui-failure-paths.json) |
| U06 | P5 | 失敗時に締切前/締切後を比較 | C/J | 締切とretryableの組合せで案内/STARTを確認 |
| U07 | P5 | 長文・改行・HTML風文字を表示 | J | passed。Edgeで1000字超全文・改行表示・HTML文字無害化・metadata非表示を確認 [UI narrative evidence](test-evidence/v0.1.19/20260929-ui-narrative-display.json) |
| U08 | P5 | 画面離脱/次run後に旧応答が到着 | C/J | passed。画面遷移後と同一画面のtimeout→新run後に遅延旧応答を返しても、結果/買い目/操作状態は維持 [U08 evidence](test-evidence/v0.1.19/20260929-ui-stale-response.json) |
| U09 | P5 | コメント投稿/一覧/旧予想関連の回帰 | J | 部分確認。Deno stub 9件、実ローカルPostgRESTでのmock返信POST/一覧/cleanup、browser mockでの既存コメント表示・投稿・AI返信・予想選択共存を確認。旧予想連携は未確認 [handler/DB evidence](test-evidence/v0.1.19/20260929-u09-deno-handler-integration.json) [browser evidence](test-evidence/v0.1.19/20260929-u09-comments-ui-smoke.json) |
| U10 | P5 | 320/390/430pxとデスクトップ、再利用・長文・失敗を表示 | — | 320/390/430px/PCの自動画像と実スマートフォン確認 |
| U11 | P5 | 新旧script/client/APIの配信版・通信契約を混在させる | A/D/J | 新旧配信ファイル/APIを組み合わせ実通信を確認 |
| M01 | P4 | 採用モデル3.5 Flash Liteを実キーで生成し、実装経路・保存を確認 | I | passed。通常preview/preview欠損の合成fixtureをproduction handler→実PostgREST→実Gemini→保存/GETまで2条件完了。両方形式検証成功、cleanup後残存0 [M01 evidence](test-evidence/v0.1.19/20260929-m01-handler-postgrest-live.json) |
| M02 | P4 | 6レース程度の固定入力で比較 | I | 部分確認。10レース4モデルの成功率/平均時間/出力整合性を比較済み（第142節）。6条件セットでの根拠・多様性・使用量の系統評価は未完了 |
| M03 | 後続 | 3.5/3.1 Flash Lite等を同一入力で比較 | — | 10レースの補助比較を実施。結果は成績書第142節。正式M03の全条件確認は未完了、初回公開の分母69から除外 |
| M04 | P6 | 追加migration後、v0.1.18タグのpredictions/依存ソース・フロントと旧実効設定へ切り戻す | — | 部分確認。旧v0.1.18 handlerを現行migration後のローカルPostgREST/DBで実行しsnapshot/narrative保存とcleanupを確認。EdgeRuntime再配信・画面切替・旧実効設定は未確認 [M04 evidence](test-evidence/v0.1.19/20260929-m04-v018-handler-postgrest.json) |
| M05 | P3/P6 | 背景処理を実行環境で90秒近く継続/中断 | D | passed: 実EdgeRuntimeで90,001ms worker完了を観測。D07切断後継続とは別条件で再試験しない |
| M06 | P6 | 公開前のO01〜O04・成績・対象差分・詳細設計12.1〜12.3を確認 | — | 69件の成績、O01〜O04、復元基準、公開判断をそろえる |
| M07 | P6 | ai_bundle生成中にlegacyへ切替、完了後に旧backendへ戻す | — | 部分確認。handler mode切替＋実PostgREST。実EdgeRuntime再デプロイとv0.1.18復帰は未確認 [M07 evidence](test-evidence/v0.1.19/20260929-m07-handler-mode-switch.json) |
| M08 | P2/P4 | 設定したRPMを超える異なるレース要求をモックし、実モデル試験は枠内で実施 | B | 部分確認。6異job、3模擬429、最大2回/job・6件成功。採用モデルの実要求は逐次2件に加えて、合成入力の同時2件も両方形式検証成功。枠超過時の実運用とDB別jobの同時処理は未確認 [AI module regression](test-evidence/v0.1.19/20260928-ai-module-regression.json) [M01 evidence](test-evidence/v0.1.19/20260929-m01-handler-postgrest-live.json) [concurrent evidence](test-evidence/v0.1.19/20260929-m08-gemini-concurrent-within-quota.json) |

※ Hの経路到達はI群/D群の前提確認として再利用するが、未存在レースの404を正常入力や保存の合格へ読み替えない。

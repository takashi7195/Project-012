# v0.1.19 AI予想刷新 試験仕様兼試験成績書

- 作成日: 2026-09-26 JST
- 文書版: 1.95（公開URL現行版の基準・公開試験ゲートを追加）
- 製品版: v0.1.19。切り戻し先: v0.1.18（`e6c263456a5999b10181fda4eae32e9f6bdfa578`）。
- 対象: [基本設計書](AI-PREDICTION-REFRESH-BASIC-DESIGN.md)、[詳細設計書](AI-PREDICTION-REFRESH-DETAILED-DESIGN.md)
- 実行計画: [試験計画書](AI-PREDICTION-REFRESH-TEST-PLAN.md)、[70項目対応表](AI-PREDICTION-REFRESH-TEST-MATRIX.md)、[環境確認結果](AI-PREDICTION-REFRESH-TEST-ENVIRONMENT.md)
- 目的: 実装後に実行する試験の条件・期待結果を先に定義し、実測結果を同じ文書へ記録する。
- 注意: 本書作成は試験実施・合格・本番公開を意味しない。既存版の過去のpassed件数を本刷新の成績に転記しない。

## 1. 成績概要

| 項目 | 現在値 |
|---|---|
| 計画ケース数 | 70（初回公開対象69・後続比較1） |
| passed | 57 |
| failed | 1（M01: Gemini HTTP 503） |
| 未完了（未実施/一部確認/blocked/後続） | 12 |
| 実装commit／差分識別 | ローカル作業ツリー差分（未commit）。既存の無関係な差分がありcommit識別なし |
| 試験環境・DB識別 | WSL Ubuntu、Node.js v24.21.0。既存の単体/mock150件、Deno型検査、隔離DB・Edge HTTP/PostgREST smokeの成功実績あり。ローカルmigration 20260926000000は適用済み。2026-09-27の環境点検ではDB読取・Deno起動・ブラウザー操作・モデル一覧認証も成功。詳細は第36節と環境確認結果 |
| 試験担当・実施日時 | Node/mock回帰150件: Codex作業環境。Supabase PostgreSQL/Edge/PostgREST smoke: ユーザーのWSL上のCodex CLIが実行、2026-09-27に結果受領。70受入ケースの全体実施は未完了 |
| 実モデル使用量・費用 | 実生成スモーク計3要求はHTTP 503。使用量・費用は不明。Geminiのmodels.list認証とモデル一覧確認は成功 |
| 総合判定 | 判定不可。既存の部分合格実績あり。実モデルの成功、保存までの実統合、製品画面、背景処理、切り戻し等は未確認。ブラウザー起動確認は製品画面合格に含めない |

本設計の70受入ケースは全体完了していない。passed 57件、failed 1件、残る12件は未実施・一部確認・blocked・後続である。`race-prediction/*.test.mjs`のmodule回帰数は70受入ケースと別集計である。個々のテストが要件の一部を確認しただけでは、受入ケース全体をpassedにしない。設計文書のリンク・ケース番号・件数確認も予想機能の試験実績に数えない。

## 2. 試験環境と実施手順

1. 対象実装のcommitまたは差分ハッシュ、モデル、指示文版、設定ハッシュ、runtime/SDK版を記録する。
2. ローカルのモックで入力、出力検証、期限・最大回数、フロント状態を確認する。
3. 隔離したPostgreSQL/Supabase環境に新規migrationと試験用fixtureを適用し、権限・原子性・競合を確認する。本番DBをfixture置場にしない。
4. Edgeのbackground taskを維持できる試験環境で、切断・中断・期限切れを確認する。
5. モバイル相当のブラウザーで既存表示・演出との接続を確認する。
6. 実モデル確認はAPIキーを出力せず、利用者の承認範囲・無料枠を確認した上で行う。本番への投稿・DB変更・deployは別途明示指示が必要。
7. 各ケースの実測、証跡、passed/failedを記録する。失敗時は期待結果を都合よく変更せず、原因と修正後の再試験を追記する。

対象外のコードが変わった場合は設計を更新してから試験範囲を拡張する。全体回帰を無意味に繰り返さず、変更と失敗に対応した試験を行う。

## 3. 共通fixture

| ID | 条件 |
|---|---|
| F01 | 当日・締切前・6艇の選手名/登録番号あり・出走表/展示の全項目あり |
| F02 | F01と同じ出走表、展示はmissing/null/emptyの各状態 |
| F03 | F01の展示・モーター等が一部欠損、F.03等の原文、整備・部品情報あり |
| F04 | 展示あり取得11分前、展示なし31分前、さらに古い当日データ、取得時刻不明 |
| F05 | 出走表5艇、艇番重複、範囲外艇番、エントリーnull、キーと艇番の不一致。氏名/登録番号のみ欠損した正常6艇も別途用意 |
| F06 | 締切済み・締切不明・不正日時・過去日・別レースを個別に作成 |
| F07 | raw program内にpreview/result、着順・払戻・返還・本番ST等を含む |
| F08 | 取得/確認時刻・batchIdだけ変更した同一事実データ |
| F09 | 展示・部品・選手情報・F/L・締切のうち1項目だけ更新したデータ |
| F10 | 成功JSON、艇番重複、同一買い目、空欄、null、文字列艇番、壊れたJSON |
| F11 | providerの遅延、通信例外、408/429/5xx、401/403、出力打切り |
| F12 | 保存前失敗・保存commit後の応答消失・worker終了・旧owner遅延 |

実データからfixtureを作る場合は採取日時・対象レース・データハッシュを記録する。実モデル比較では予想時点より後の結果を含めない。

## 4. 試験仕様・成績欄

各行の「未実施」は実施後にpassed/failedへ更新し、実測・証跡欄を埋める。モック成功と実モデル成功を混同しない。

### 4.1 入力と判定

| ID | 要件 | 操作・条件 | 期待結果 | 成績 | 実測・証跡 |
|---|---|---|---|---|---|
| I01 | R02,R03 | F01を専用RPCから組立 | 出走表・展示の全API項目を保持。採点allowlistで欠落しない | passed | 公開API sample 156レースをnormalize→records→buildAiInputへ通し、実sampleの6艇1レースを一時ローカルfixture経由で専用RPCへ流して全事前項目値・展示値を照合。result field除外とfinally cleanupも確認 [前段証跡](test-evidence/v0.1.19/20260928-i01-source-to-input-partial.json) [実RPC証跡](test-evidence/v0.1.19/20260929-i01-source-postgrest.json) |
| I02 | R04 | F07を入力化 | 内包result・払戻・返還・本番ST/実進入・既存予想がAI入力にない | passed | 実PostgREST/隔離DBの再帰除外確認 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| I03 | R03,R06 | F03、null/欠落/空配列/原文を含める | それぞれ区別。欠損値・コース・成績を補完しない | passed | 実PostgREST全preview variantを確認 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| I04 | R05 | 入力RPCから選手/モーターのAPI内集計値を取得 | 出走表内の集計値を保持。過去レース結果を追加検索/送信しない | passed | 隔離fixtureから実PostgREST input RPCへ全国/当地勝率・モーター2連率の既知数値を照合。入力RPCは選択レースのcurrent day-head/componentのみを読み、履歴テーブル/過去日検索なし。過去結果は投入/送信していない [I04 evidence](test-evidence/v0.1.19/20260928-i04-api-aggregates-no-history.json) |
| I05 | R06 | F02/F03を生成入口へ送る | 6艇が有効なら展示欠損でもAIへ進む | passed | 実Edge+PostgRESTでpreview欠損のprovider到達を確認 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| I06 | R06 | F05の6艇の識別ができない/矛盾する各パターンを送る | AI未呼出。安全な失敗応答、入力の勝手な修復なし | passed | 各不正6艇identityでclaim/provider未呼出 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| I07 | R02,R17 | F06を各パターンで送る | 当日対象・締切前の条件を満たさない新規開始を拒否 | passed | 実DBで過去日claim拒否、handlerで不正日/締切不明・不正・経過をclaim前に拒否 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| I08 | R18 | F04を各パターンで送る | 取得経過時間・取得時刻不明だけで停止しない | passed | 11/31分・時刻不明の実PostgREST読取と11分前データのmock provider到達 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| I09 | R02,R03 | 読取中にday_headsを更新 | 同一採用batchのprogram/previewで整合。別版を混ぜない | passed | 120同時RPC read/120 batch切替でbatch/component/program/preview整合、cleanup後残存0 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| I10 | R03,R07 | タイトル等に指示風文字列、未知の事前項目を追加 | 事実データとして分離。未知項目保持と結果境界の確認ができる | passed | 指示風データとsystem instructionの分離 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| I11 | R01,R06 | 艇番1〜6のエントリーがあり、氏名/登録番号の一部のみ欠損 | 属性欠損だけで拒否せず、そのまま生成へ渡す。氏名等を補完しない | passed | 氏名/登録番号欠損を補完せずpayload保持 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |

### 4.2 生成・出力・再利用識別

| ID | 要件 | 操作・条件 | 期待結果 | 成績 | 実測・証跡 |
|---|---|---|---|---|---|
| G01 | R07,R09,R10 | 初期requestを採取 | 固定採点・買い目例・欠損評価・段落・口調の誘導なし。4項目一括依頼 | passed | 合意promptと4項目schemaを確認 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| G02 | R08,R09 | F10の正常JSONを返す | 3点と展開文を同じ応答から採用 | passed | mock応答の一括DB保存・読取・再利用 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| G03 | R08 | 各買い目内重複・範囲外・長さ不正・文字列艇番 | 全て出力不備。艇番の自動差替・型の推測修正なし | passed | 全3買い目の不正配列検証 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| G04 | R08 | main=counter等、完全一致を返す | 不備。異なる買い目間で一部の艇が共通するだけなら許容 | passed | 全3組の完全重複拒否と部分重複許容 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| G05 | R08,R09 | 買い目欠落/null、文章空白のみ、壊れたJSON | 不備。部分的な結果を保存・表示しない | passed | 欠損/空文/壊れJSONを2回で停止し非保存 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| G06 | R10 | 短文/500字超/1000字超、1段落/複数段落 | 有効な完了応答なら長さ・段落だけで落とさない。本文切断なし | passed | 短文/>500/>1000/複数段落をvalidate/画面表示 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| G07 | R09,R13 | 初回重複→2回目正常 | 不備を伝えて4項目再生成。合成せず2回目の一組を保存 | passed | 2回目の正常bundleのみ4項目一括保存 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| G08 | R13,R19 | 初回不正→2回目不正 | AI計2回で終了。3回目・旧採点・定型展開文への逃避なし | passed | 2回上限・旧方式fallback/部分保存なし [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| G09 | R15 | F08を比較 | 事実ハッシュ・reuseKey同一。成功結果を再利用 | passed | 同一入力・設定で同一bundleを再利用、追加provider呼出なし [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| G10 | R03,R15 | F09を各項目で比較 | 全事前項目の意味のある変更がreuseKeyへ反映 | passed | 事実/展示/艇属性/presence/締切変更でfactsHash変更、DBの事実変更で別job/bundle [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| G11 | R12,R15 | モデル/指示文/口調/推論設定/Schema版を変更 | 設定ハッシュが変わり旧結果を誤再利用しない | passed | 全設定versionのhash差分と実DBでmodel変更時の別job/bundleを確認 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| G12 | R11,R12 | 対応するGeminiモデル設定を交換、未対応provider/パラメーターも指定 | UI契約を変えず既存adapterが設定モデルへ送る。未対応設定は安全に拒否 | passed | 模擬fetchでgemini-3.1-flash-liteへのgenerateContent routeと同一output契約を確認。未対応provider/thinking設定を送信前に拒否 [G12 evidence](test-evidence/v0.1.19/20260928-g12-config-swap.json) |
| G13 | R09,R12,R15 | 初回生成中に入力/モデル/指示文設定を変更し、修正再生成 | 開始済みjobは固定bundle/configで続行。新規STARTだけ新しい設定・データを使う | passed | 実PostgRESTで初回jobの入力/model/styleと修正要求が開始時のまま、新STARTは変更後bundle/configで別jobを作ることを確認 [D02/G13 evidence](test-evidence/v0.1.19/20260928-d02-g13-postgrest-results.json) |

### 4.3 時間・通信

| ID | 要件 | 操作・条件 | 期待結果 | 成績 | 実測・証跡 |
|---|---|---|---|---|---|
| T01 | R13 | 初回20秒で一時通信失敗→2回目成功 | 残り時間内で再試行。保存まで90秒以内 | passed | 20秒失敗・1回retry・90秒内保存を仮想時間mockで確認 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| T02 | R13 | 両要求を遅延させる | 絶対期限で終了。再試行で90秒をリセットしない | passed | 2回遅延後に元の90秒期限超過、保存なし [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| T03 | R13 | 通信例外/408/5xx→成功 | 初回含む最大2回。バックオフも期限に算入 | passed | 通信例外/408/5xxの最大2回retryとbackoff [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| T04 | R13 | 短期429、日次枠超過、長いRetry-After | 短期のみ残時間内再試行。回復不能/時間不足で追加送信しない | passed | 短期429回復・日次429停止・長Retry-After停止 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| T05 | R13 | 401/403/未対応モデル等を返す | 即時終了。利用者にprovider本文を表示しない | passed | 実PostgREST/handlerで401/403/404即時停止、本文非露出、非保存 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| T06 | R10,R13 | MAX_TOKENS等の未完了応答 | 文字数超過と区別し、一組の再生成を最大1回 | passed | MAX_TOKENS後に一組だけ再生成・保存 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| T07 | R13,R16 | 202が5回を超えて続き60秒で成功 | 旧maxRequests=5で早期失敗せず、期限内で取得 | passed | job GETを7回pollし60秒内成功、POST再発行なし [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| T08 | R13,R16 | PC時計差、remainingMs延長応答、状態GET一時失敗 | 自身/共有の短い期限を守り、延長・新規POSTの自動増殖なし | passed | ±24hのwall-clock jump、延長無視、GET回復/POST重複なしをmock clockで確認 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| T09 | R01,R13 | 初回AIが50秒/70秒で正常完了 | 任意の42秒で打ち切らず、1回で保存・表示できる | passed | 実時間50秒/70秒mock応答は各1回で90秒内保存。実PostgREST/handlerの60秒完了はD05でも確認 [T09 evidence](test-evidence/v0.1.19/20260928-t09-real-clock-results.json) |
| T10 | R13 | 初回が生成用残時間を使い切り、2回目の時間がない | 1回で終了。2回必須と解釈して90秒を延長しない | passed | 初回で時間枯渇後は2回目送信なし [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| T11 | R13,R16,R19 | claimのロック待機、残2秒の状態GET、retryable=falseを個別確認 | 待機・通信で期限を再開せず、可能な最終GETを送信。再試行不可で案内しない | passed | 実DB row lockで約2秒停止、provider未呼出。残2秒GETと非再試行をclient testで確認 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |

### 4.4 DB・共有・締切

| ID | 要件 | 操作・条件 | 期待結果 | 成績 | 実測・証跡 |
|---|---|---|---|---|---|
| D01 | R14,R15 | 正常生成を保存 | bundle・成功試行・job・keyが同一TXで確定 | passed | 成功job/key/attempt/bundleの参照整合を実DBで確認 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| D02 | R14 | F12の保存前エラー | 成功表示・部分bundleなし。保存失敗でAIを再生成しない | passed | finish RPC前のエラー後にbundle/成功表示なし、provider再呼出なし、GETは成功や部分結果を返さない [D02/G13 evidence](test-evidence/v0.1.19/20260928-d02-g13-postgrest-results.json) |
| D03 | R14,R15 | 保存commit後の応答消失 | 読取/冪等保存で同じIDを確認。成功行重複なし | passed | commit後にfinish RPC応答を落とし、GETで一件の保存結果を回復 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| D04 | R15 | 同じreuseKeyへ同時20要求 | owner1つ、共有job1つ、AI呼出は合計最大2回 | passed | 実handler/PostgRESTで20要求が1 job/owner/provider requestを共有 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| D05 | R16 | 0秒START、30秒後に参加、60秒で保存 | 待ちは概ね60/30秒。先行期限・AI要求を延長/再開しない | passed | 実経過+0/+30/+60秒で同一job、1 provider要求、60秒成功を確認 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| D06 | R15,R16 | 2番目START前にF09へ更新 | 別job・別bundle。先行入力を差替えない | passed | 進行中provider応答を保持して入力を更新、別jobと各開始時bundleを実DBで確認 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| D07 | R16 | 先行ブラウザー切断、後続が継続 | 背景処理は継続可能。後続は同じ成功結果を取得 | 部分確認 | production handler＋実PostgREST fixtureで開始側AbortSignal、同一jobへの後続参加、mock生成1回、1 bundle保存、成功GETを確認。実EdgeRuntime上の切断後取得は追加確認中。第77節 |
| D08 | R13,R15 | worker終了、期限切れ→締切前の手動START | 旧job expired、新jobを作成可能。GETだけで再起動しない | passed | 期限切れjob GETで再生成せず、手動STARTが新jobを作成・完了 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| D09 | R13,R15 | 旧ownerが新job開始後に遅延保存 | フェンス検証で拒否。新job・保存値を上書きしない | passed | 遅延した旧workerはbundleを保存せず、新jobの1件だけ保存 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| D10 | R17 | 締切前開始→締切後に初回不正→再生成成功 | 固定した締切前入力で完了・保存・GET表示可能 | passed | 締切後に不正応答を受けた後、開始時bundleで一回修正して保存 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| D11 | R17 | 締切後に新規POST、開始済みjobのGETを比較 | POSTは拒否（成功キャッシュがあっても同様）、GETは読取可 | passed | 実PostgRESTでcached START拒否、既存job GETは同一bundleを返す [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| D12 | R14,R15 | DB制約へ不正配列・null要素・多次元配列・空文・duplicate key・別キーのbundle参照を投入 | DBでも拒否。SQL null判定の抜け道がなく、参照整合性維持 | passed | 隔離DBの全制約負例・正常保存・cleanupを確認 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| D13 | R14,R20 | anon/authenticated/service_role権限を確認 | 内部テーブル/RPCはservice_role限定。公開応答にowner/raw/Secretなし | passed | 実local DB権限、HTTP認証境界、handler成功応答の秘密/内部項目非露出を確認 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| D14 | R15,R18 | 時刻だけ更新して成功結果を再取得 | 初回実送信payload・取得時刻を保持。時刻を現時刻へ偽装しない | passed | fetchedAt/last_success_at更新だけで同一bundle再利用、保存済み初回fetchedAtを保持 [follow-up evidence](test-evidence/v0.1.19/20260928-autonomous-followup-results.json) |
| D15 | R13,R14 | begin_ai_attemptの重複呼出/応答消失、初回不成功記録を確認 | 同じsequenceでcount増加・provider送信を重複しない。失敗試行が記録される | passed | 実PostgRESTでbegin RPC commit後の応答消失を注入。provider未呼出、attempt unknown 1件、job retryable failureを確認 [D15 evidence](test-evidence/v0.1.19/20260928-d15-authorization-response.json) |
| D16 | R14,R15 | 成功保存と期限切れGETを同時実行 | 統一したロック順で仲裁。成功をexpiredへ上書きせず、不成功はbundleなし | passed | 実PostgRESTでjob row lockとreuse-key lockを使い両方の勝敗順を確認。成功後の期限切れGETは成功維持、GET先行時は後続save拒否・bundleなし [D16 evidence](test-evidence/v0.1.19/20260928-d16-postgrest-race-results.json) |

### 4.5 画面・既存機能

| ID | 要件 | 操作・条件 | 期待結果 | 成績 | 実測・証跡 |
|---|---|---|---|---|---|
| U01 | R09,R19 | 初期表示→会場/レース選択 | 待機1・2・3、即時START判定、選択だけのAI呼出なし | passed | Windows Edge/Playwrightのlocal-only mockで初期リール1-2-3を確認。会場のみではSTART無効、会場+レース選択で有効、選択によるPOST 0回。開始後は3slotが即時回転。実API/スマートフォンではない [timing evidence](test-evidence/v0.1.19/20260929-ui-animation-timings.json) |
| U02 | R09,R16 | START→速い結果/遅い結果 | 即回転、最初3秒との並行、3着→6秒→2着→9秒→1着の減速順 | passed | Playwright/Edgeでfast/5.5秒遅延mockを測定。初回停止3,039/5,842ms、追試3,041/5,821ms。停止間隔は前停止完了から約6,017/9,016ms [timing evidence](test-evidence/v0.1.19/20260929-ui-animation-timings.json) |
| U03 | R09,R14 | 全停止前後を観測 | 対抗・穴・展開は全停止0.5秒後。同一bundleのみ表示 | passed | counter/hole/narrativeは全停止後500/509ms、追試500/499msで一括表示 [timing evidence](test-evidence/v0.1.19/20260929-ui-animation-timings.json) |
| U04 | R16,R17 | 待機中の定期更新・日付切替・締切到来 | 操作解除/対象差替なし。成功後は締切再判定 | 部分確認 | virtual clockで締切解除・JST日付切替・5分更新確認。実Edge/API連携は未確認。第40・65節 |
| U05 | R19 | 通信/検証/保存の各失敗 | 簡潔な共通文言、1・2・3へ復帰、部分結果なし | passed | 成功bundle後にprovider 503・通信切断・無効bundle・保存失敗応答をbrowser mockで返し、共通案内・以前の結果消去・待機1-2-3復帰・START復帰を全て確認。実DB保存前失敗はD02で別途passed。画面応答はlocal mock [UI evidence](test-evidence/v0.1.19/20260929-ui-failure-paths.json) [DB save failure evidence](test-evidence/v0.1.19/20260928-d02-g13-postgrest-results.json) |
| U06 | R17,R19 | 失敗時に締切前/締切後を比較 | 再試行可能時のみ案内とSTART許可。締切時に再試行を促さない | 部分確認 | mockで締切を跨ぐrunの締切案内・再試行非表示を確認。実Edge/API障害は未確認。第40・65節 |
| U07 | R10,R18 | 長文・改行・HTML風文字を表示 | 改行保持、textContentで表示、取得時刻・モデル名等の追加なし | passed | Windows Edgeで1000文字超の全文表示、画面上の改行、HTML風文字のtext描画（img/script要素なし）、取得時刻/モデル情報を付加しないことを確認。全API通信mock [UI narrative evidence](test-evidence/v0.1.19/20260929-ui-narrative-display.json) |
| U08 | R15,R16 | 画面離脱/次run後に旧応答が到着 | 新runの結果・操作状態を上書きしない | passed | Edge browser mockで、旧画面→新画面および同一画面のtimeout後新runの2条件を確認。遅延旧POST応答は新結果/買い目/Start状態を上書きしない [U08 evidence](test-evidence/v0.1.19/20260929-ui-stale-response.json) |
| U09 | R20 | コメント投稿/一覧/旧予想関連の回帰 | 今回対象外の既存契約が維持。予想差異の保留は解消扱いにしない | 部分確認 | コメントNode回帰52件、Deno handler stub 9件、mock返信付きhandlerの実ローカルPostgREST投稿/一覧/cleanup合格。ブラウザー表示と旧予想連携は未確認。第40・129・132節 [U09 evidence](test-evidence/v0.1.19/20260929-u09-deno-handler-integration.json) |
| U10 | R19 | 320/390/430pxとデスクトップ、再利用・長文・失敗を表示 | 横はみ出しや操作不能なし。選択欄・艇色・演出の既存仕様維持 | 部分確認 | 320/390/430/1280pxで幅、bundle再利用、長文/失敗表示をmock確認。実スマホ/全既存仕様は未確認。第40・64節 |
| U11 | R13,R15,R19 | 新旧script/client/APIの配信版・通信契約を混在させる | 新画面はv0.1.19を表示し版を識別。旧POSTをai_bundleへ流さず、AI未呼出の安全な失敗。再読込で正常化 | 部分確認 | v0.1.18 POST拒否/model呼出0回、再読込後v0.1.19 mock成功。実Edge/API配信は未確認。第40・67節 |

### 4.6 実モデル・移行

| ID | 要件 | 操作・条件 | 期待結果 | 成績 | 実測・証跡 |
|---|---|---|---|---|---|
| M01 | R11,R12 | 隔離環境で3.8 Flashを実キー呼出 | 指定モデル・構造化出力が利用可能。キー非出力 | failed | 3回の各1要求がHTTP 503で契約有効な生成応答なし。直近の事前表示はRPM 1/5、TPM 478/250K、RPD 2/20。503の原因は未特定、同条件追加要求停止 [M01 evidence](test-evidence/v0.1.19/20260928-m01-gemini-retry-503.json) |
| M02 | R01,R07〜R11 | 6レース程度の固定入力で比較 | 成功率・根拠・買い目との整合・文章の違い・時間・使用量を記録 | 未実施 | — |
| M03 | R11,R13 | 後続最適化として3.5/3.1 Flash Liteで同じ入力セットを実行 | 同じ評価軸で比較。初回公開の必須条件にはしない | 未実施（後続） | — |
| M04 | R12,R20 | 追加migration後、v0.1.18タグのpredictions/依存ソース・フロントと旧実効設定へ切り戻す | 旧採点と展開文が動作、表示v0.1.18、旧データ/コメント/収集の維持、新bundle保持。対象外変更なし | 部分確認 | 一時展開したv0.1.18 handlerが現行migration後のローカルPostgREST/DBで旧形式snapshot/narrativeを保存。Geminiはmock。cleanup後AI/comment件数とfixture 0を確認。実EdgeRuntime配信/フロント・設定切替は未確認 [M04 evidence](test-evidence/v0.1.19/20260929-m04-v018-handler-postgrest.json) |
| M05 | R13,R16 | 背景処理を実行環境で90秒近く継続/中断 | 制約内で完了または期限切れ復帰。応答直後終了の有無を確認 | passed | `waitUntil`登録後に202を返し、追加Function要求なしでworker 90,001ms・host 90,015msの完了callbackを受信。15秒ごとのheartbeatあり。第77節 |
| M06 | R20 | 公開前のO01〜O04・成績・対象差分・詳細設計12.1〜12.3を確認 | 製品版v0.1.19、コメントの当面方針、本番関数/旧設定の復元基準、切り戻し試験、公開許可がそろうまで未公開 | 未実施 | — |
| M07 | R16,R17 | ai_bundle生成中にlegacyへ切替、完了後に旧backendへ戻す | 切替後も開始済みjob GETが使え、完了/期限切れ確認後に切り戻せる | 部分確認 | 実PostgREST＋mock providerで進行中/完了後GETとlegacy経路を確認。さらに利用者実行の実EdgeRuntime legacy境界ではAI形式POST拒否、malformed selector拒否、OPTIONS/public-key境界を確認。実EdgeRuntime上の進行中job完了・v0.1.18復帰は未確認 [handler evidence](test-evidence/v0.1.19/20260929-m07-handler-mode-switch.json) [Edge boundary](test-evidence/v0.1.19/20260929-m07-edge-legacy-mode-boundary.json) |
| M08 | R11,R13 | 設定したRPMを超える異なるレース要求をモックし、実モデル試験は枠内で実施 | 再試行の無限連鎖なし。枠不足とモデル品質を区別し、試験を無料枠内に調整 | 部分確認 | 6個の異なるjobを同時実行し3要求に模擬429を返すunit試験で、全6件の保存成功・合計9要求・各job最大2回を確認。実Geminiの残枠/RPM確認とモデル試験はM01の503で未完了 [AI module regression](test-evidence/v0.1.19/20260928-ai-module-regression.json) |

## 5. 実モデル比較の記録欄

文章の流暢さを的中精度と同一視しない。自動の形式合格と、人が読む根拠・整合性の評価を分ける。

| モデル | 設定/指示文版 | 実施ケース数 | 初回成功 | 修正後成功 | 最終失敗 | 時間の中央値/最大 | 使用量 | 費用 | 根拠・整合性・多様性の所見 |
|---|---|---|---|---|---|---|---|---|---|
| gemini-3.8-flash | 未測定 | 0 | — | — | — | — | — | — | 未実施 |
| gemini-3.5-flash-lite | 未測定 | 0 | — | — | — | — | — | — | 未実施 |
| gemini-3.1-flash-lite | 未測定 | 0 | — | — | — | — | — | — | 未実施 |

各ケースについて入力factsHash、出力bundle、生成時間、再試行回数、検証結果、人による事実確認の所見を保存する。DBの再利用を無効化した比較は本番で行わず、モデル別設定を明確にした試験環境で行う。

初期モデル3.8 Flashの最低確認条件は、6種類の入力すべてで最大2回・90秒以内に有効な一組を生成・保存でき、入力にない具体的事実の断定や買い目と文章の明白な矛盾が確認されないこととする。これは初期の技術受入基準案で、少数例で本番成功率・的中率を保証しない。満たさない場合は失敗箇所を記録し、設定・モデル・プロンプトの変更後に対応ケースを再試験する。M03のFlash Lite比較は後続でよく、未実施のままでも他の初回条件を満たせば公開判定に進める。

推奨の6入力は、展示完備、展示なし、一部欠損、整備情報あり、古い当日データ、異なる会場/選手構成。同一の型を繰り返すだけで多様性評価を済ませない。初期モデルの利用不能・性能不足が判明した場合は設計を更新し、勝手に別モデルを本番採用しない。

## 6. 不具合・再試験記録欄

| 不具合ID | 試験ID | 期待との差 | 原因 | 修正差分 | 再試験日時 | 結果/証跡 |
|---|---|---|---|---|---|---|
| — | — | 未実施 | — | — | — | — |

## 7. 公開判定

- 初回対象69件の機能試験・DB試験・初期モデル試験・画面試験・公開前確認の結果と証跡がそろっている。M03のみ後続比較として分離する。
- 未実施をpassedに含めない。保留ケースは理由と公開への影響を明記する。
- コメント連携保留の当面の運用、製品版v0.1.19、無料枠運用の制約、対象FunctionとDB変更を確認する。
- 旧データを保持した切り戻し手順が確認できる。
- commit・push・DB適用・deploy・本番E2Eは明示的な指示後に行う。

現時点の判定: **単体・部分結合の成功実績はあるが、全70受入ケース（初回69・後続比較1）の受入条件全体の確認は未完了であり、公開可否は判定していない。実生成スモークはHTTP 503で失敗。PREDICTION_MODEの既定値はlegacyであり、本番の実効設定は未確認。**

## 8. 文書再レビュー記録（1.1）

42秒打切りの撤回、属性欠損の許容、進行中の入力/設定固定、RPC送信権の冪等性、SQL null/参照制約、保存と期限切れの競合、旧クライアントの配信切替、切り戻し時のjob読取継続に合わせて期待結果を修正した。I11/G13/T09〜T11/D15〜D16/U11/M07〜M08の10件を追加。実装試験は行っていない。

## 9. 切り戻し基準確認（1.2）

2026-09-26 JST、ローカルとGitHub双方のv0.1.18タグが上記commitを指すことを読取確認した。製品版v0.1.19を文書に反映し、M04/M06の条件を具体化した。これはM04/M07の動作試験ではないため、passedへ変更していない。70件の計画件数も変更していない。

## 10. 実装確認記録（1.3）

ローカル実装と7件のmodule単体試験コードを追加した。試験の実行はできていない。Windows Node.exeはWSLから起動できず、Deno/PostgreSQL/Supabase環境も見つからなかった。migration、背景処理、Gemini API、画面、切り戻しはすべて未確認。70件の成績と公開判定は変更していない。

## 11. ユーザー実施の単体試験結果（1.4）

2026-09-26、ユーザーがPowerShellからWSL Ubuntuを起動し、`/mnt/c/codex/project-012/Project-012` で以下を実行したログを会話で受領した。エージェントによる再実行結果ではない。実行時の差分ハッシュは未採取のため、その後の変更への合格の引継ぎは行わない。

```text
node --version
v24.21.0
node --test race-prediction/ai-contract.test.mjs
tests 7
suites 0
pass 7
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 368.869709
```

| 単体試験名 | 結果 |
|---|---|
| input retains full pre-race raw facts and removes result data | passed |
| input rejects malformed or contradictory boat identities, not missing names | passed |
| output checks structure and distinct tickets without narrative length rules | passed |
| default model and settings are configurable within the designed limits | passed |
| Gemini receives instruction and race facts in separate request fields | passed |
| bundle client starts once, polls the shared job and validates the whole result | passed |
| prompt leaves paragraphs, tone and narrative lengths unconstrained | passed |

固定データと模擬応答による試験であり、実際のGeminiモデルの利用可否・生成品質、SQL migration、DB保存と同時アクセス、Edge背景処理、画面演出、切り戻しは確認していない。ユーザーのUbuntuではNode.jsが利用できることが確認できたため、従前の実行環境の問題をユーザー環境にも適用しない。

## 12. 続行したローカル試験と修正（1.5）

2026-09-26、Ubuntu側のNode.jsを絶対パスで起動できることを確認し、エージェントが試験を実行した。追加の`ai-generation.test.mjs`は23件、`ai-client.test.mjs`は8件。既存の`ai-contract.test.mjs`7件を含む刷新用38件と、既存回帰96件の合計134件が合格した。ユーザー実施の7件はこの134件に含まれ、重複加算しない。

実行コマンド（UbuntuでnodeのPATHが設定済みの場合）:

```bash
node --test --test-isolation=none race-prediction/*.test.mjs
```

試験ログと対象ソース・試験ファイルのSHA-256は[ローカル試験証跡](AI-PREDICTION-REFRESH-LOCAL-TEST-20260926.txt)に保存した。結果はtests 134 / pass 134 / fail 0 / cancelled 0 / skipped 0、実行時間1046.160512ms。子プロセス分離ありではこの環境で個別ケース詳細が得られなかったため、同一プロセス実行で詳細を採取した。

初回の刷新用36件は24件合格・12件失敗。次の不具合を修正して36件合格を確認し、応答しない通信の期限・中止試験2件を追加した。時間経過の多くは模擬時計を使い、実モデルの70秒処理を測定したものではない。

| 不具合 | 原因・修正 | 再試験 |
|---|---|---|
| Retry-Afterなしで待機0秒、不正値でNaN | nullの数値変換と無検証の日時変換。欠落・不正値は既定1秒を使う | 408/429/5xx、指定秒数、時間不足、日次枠を確認し合格 |
| 未完了応答の再生成が例外 | JSON正常時のvalidation.errorsが未定義。未完了コードを配列として渡す | MAX_TOKENS後の2回目成功が合格 |
| workerが期限後の応答を保存へ渡す | 応答後の期限検査不足。期限・abortを検査して不採用とする | 期限超過の保存呼出なしを確認し合格 |
| クライアントが期限後・中止後の結果を採用 | AbortSignalのみでは遅延結果を排除できなかった。待機を中断し、応答後も期限・中止を確認 | POST/GET遅延、中止、応答しない通信で合格 |

全体回帰の初回は127件合格・7件失敗。既存試験のv0.1.18版表示、旧script URL、60秒のみを保持する模擬タイマー、旧失敗文言がv0.1.19設計と一致していなかった。設計済みのv0.1.19・90秒・共通失敗文言に試験を更新した。艇の停止順、待機中の部分表示禁止、締切時の表示などの期待値は維持し、全134件合格を確認した。

今回の単体試験はG07/G08、T03〜T06/T08〜T10、D02/D15などの一部を模擬環境で確認する。DBトランザクション、20要求の競合、Edgeの背景処理、実際のGemini、実ブラウザーでの演出や幅、運用切り戻しは確認していない。このため70受入ケース全体の合格とは扱わない。保存例外の試験は「別のAI生成を開始しない」ことのみを確認し、保存commit後の応答消失からの復旧を保証しない。

## 13. DB接続確認と静的契約試験（1.6）

Docker DesktopのCLIを確認したが、Ubuntu WSLから`docker`が見つからず「このWSL 2 distroでDocker commandが見つからない。WSL integrationを有効化する」旨が表示された。`deno`、`psql`、`supabase`、`pg_ctl`、`initdb`もPATHまたは標準配置で見つからず、migrationを実行できる隔離DBは利用できなかった。Windows側PowerShell起動もWSLのvsockエラーで失敗した。ユーザーの本番Supabaseへ接続・変更して代用していない。

PostgreSQL実行試験を静的なコード照合で置き換えず、`ai-migration-static.test.mjs`に6件を追加した。追加した6件を含め、すべての`race-prediction/*.test.mjs`を同一Node.jsプロセスで実行した結果はtests 140 / pass 140 / fail 0 / cancelled 0 / skipped 0 / duration_ms 1206.522404。実行ログ、時刻、ソースと試験ファイルのSHA-256は[試験証跡](AI-PREDICTION-REFRESH-LOCAL-TEST-20260926.txt)に記録した。

静的試験で照合した内容は、4テーブル・RLS・権限文、買い目とattempt上限制約、7 RPCのラッパー・内部関数対応、固定期限とowner/reuse key検査、事前結果の再帰的除去と成功保存を担う関数、EdgeからのRPC名対応・API key非格納である。これはPostgreSQLの構文解析・migration実行・権限の実効確認ではなく、D01〜D16やM05のpassedには数えない。

実DB試験を続けるには、UbuntuをWindows側Docker DesktopのWSL Integrationで有効にし、Ubuntuで`docker version`がServer情報も表示する状態が必要。代わりにUbuntuへ隔離PostgreSQL/Supabase local環境を用意してもよい。実接続可能になった後は、試験専用DBの初期schema適用、追加migration適用、制約・service_role境界・保存の原子性・同時claim・期限/owner検査をfixtureで確認する。本番DBは試験対象にしない。

## 14. 隔離DBスモーク試験の準備（1.7）

ユーザーのWSL端末から実行できる`tools/local-integration/ai-bundle-db-smoke.sh`を作成した。`postgres:17-alpine`の使い捨てコンテナを`--network none`で起動し、ポート公開・volume永続化なしで、最小の既存race_data fixtureを作成してv0.1.19 migrationを適用する。試験後はtrapでコンテナを削除する。シェル構文検査`bash -n`は合格。DB上の実行結果はまだない。

スクリプトは、migration適用、service_role限定RPC、6艇入力と結果情報除去、同一sequence二重開始拒否、不正買い目保存時の部分更新なし、正しい一括保存、job成功照会を確認する。D04等の多数同時claim、Edge Runtimeのbackground task、実Gemini・画面・本番切戻しを検証するものではない。

ユーザーに依頼中の実行コマンド:

```bash
cd /mnt/c/codex/project-012/Project-012
bash tools/local-integration/ai-bundle-db-smoke.sh
```

完了後に出力を受け取り、失敗があれば原因を調べてスクリプトまたは実装を修正し、再実行する。


## 15. PostgreSQLイメージ取得の初回試行（1.8追記）

ユーザー端末でスクリプトを初回実行したところ、`postgres:17-alpine`はローカルになく、Dockerのcredential helperがWSL interopの`UtilAcceptVsock: accept4 failed 110`により起動できず、pull前に停止した。DBコンテナは起動していない。この試行はDB試験未実施のままである。

対応として、スクリプト内だけで空の一時`DOCKER_CONFIG`を作り、認証ヘルパーを参照せず公開イメージを匿名pullするようにした。終了時に一時設定を削除する。Docker Desktopの保存済み資格情報を読み書きしない。`bash -n`は再度合格した。次の実行結果は未取得。


## 16. 隔離PostgreSQLへのmigration適用（1.9追記）

ユーザーがUbuntuで`ai-bundle-db-smoke.sh`を再実行し、PostgreSQL 17 Alpineの使い捨てコンテナへ最小race_data fixtureを作成した。v0.1.19 migrationのschema、table、constraint、function、grant/revoke文は最後まで適用され、SQL実行出力で完了した。続くRPCスモーク試験は、function引数smallintにintegerリテラルを渡したため`race_prediction_get_ai_input(date, integer, integer) does not exist`で停止した。DB処理の試験結果は未判定。コンテナはスクリプトの終了処理で削除された。

修正: race date selectorのstadium/race引数を`smallint`として明示。`bash -n`合格。PostgreSQLイメージはDockerにキャッシュされたため、次回は通常再pull不要。再実行待ち。


## 17. RPC試行開始の引数型修正（1.10追記）

2回目のユーザー実行ではmigrationが再度適用され、入力RPCの6艇保持/結果除去確認を通過した。試行開始RPCでsmallint sequenceにintegerリテラルを渡したため停止。試験SQLの開始/重複開始および保存RPCのsequenceをsmallintへ明示変換した。`bash -n`合格。次のDB試験は未実施。


## 18. 保存後のRLS確認とfixture修正（1.11追記）

3回目の実行ではmigration、入力RPC、買い目の不正保存後もjobがgeneratingで部分bundleが残らないこと、正しい出力の保存とjob succeeded確認まで通過した。最後のbundle件数確認は、テストrole `service_role`にBYPASSRLSを与えていなかったため、RLSで行が見えず失敗した。これは試験fixtureのrole設定不足である。試験roleに`BYPASSRLS`を設定し、その属性もfixture内で検査するよう変更した。`bash -n`合格。これらを含む全スモーク試験の再実行は未実施。


## 19. PostgreSQLスモーク試験合格、競合試験を追加（1.12追記）

ユーザーがUbuntuからスクリプトを実行し、以下のPostgreSQL 17隔離DB試験がすべて完了した。ログに`NOTICE: PASS`と最終`PASS`を確認した。結果は本番DBやSupabase実環境の試験へ一般化しない。

- v0.1.19 migrationのPostgreSQL 17への適用
- service_roleだけがprivate RPCを実行可能であること、匿名ロールには実行権がないこと
- 6艇入力を保持し、結果フィールドをAI用programから除くこと
- 同じsequenceのattempt開始を二度認可しないこと
- 不正買い目の保存を拒否し、job/bundleに部分成功を残さないこと
- 有効な買い目と文章を保存し、jobをsucceededとして一件だけ読めること

上記はD01/D12/D13/D15、I02等の局所確認に相当する。各受入ケース全体を実施したわけではないので、ケース一覧の状態は変更しない。

この後、重要な残りのローカルDB項目として同じreuse keyへの20件同時claim試験をスクリプトへ追加した。期待値はcreatedが一つ、同じjobを返すbusyが19件。スクリプトの`bash -n`は合格、並行DB実行は未実施。Dockerイメージはキャッシュ済み。


## 20. 成功保存時のattempt開始要件修正（1.13追記）

140件のNode試験（pass 140）とDBスモークで20件同時claim（owner 1 / joiner 19）が合格した後、D15要件を再確認し、開始記録のないattemptでもfinish RPCから直接成功保存できる点を修正した。migrationのfinish関数はattempt sequenceがjob.attempt_countと一致し、対応するai_generation_attempts行がstartedの場合のみ保存する。DBスモークへ開始前保存拒否・job状態維持のassertionを追加した。Node全試験140件と`bash -n`が再合格。migration/DBスモークの再実行待ちであり、この修正をPostgreSQL上でまだ確認していない。


## 21. 修正版DBスモークと20件同時claim合格（1.14追記）

ユーザーが改訂済みスクリプトをUbuntuで実行し、PostgreSQL 17へmigrationを適用した上で、migration、入力結果除去、RPC権限、attempt開始前の保存拒否、二重attempt開始拒否、不正出力のrollback、正常な一括保存、同一reuse keyの20件同時claim（created 1 / busy 19）が合格した。ログは`NOTICE: PASS`、20 caller `PASS`、最終`PASS`を示した。これは隔離した最小schemaでのスモークであり、D01〜D16全体の受入試験・本番Supabase適用合格を意味しない。


## 22. 期限・再利用・冪等性のDB試験を追加（1.15追記）

基本スモークと20件同時claim（one owner / nineteen joiners）はユーザー実行ログで合格済み。次の実行に向けて、保存RPCの再呼び出しが同じprediction IDを返すこと、同一keyの成功結果再利用、締切後POSTで保存済みキャッシュも拒否すること、期限切れjobを置換して旧ownerの保存を拒否することをスクリプトへ追加した。`bash -n`とローカルNode試験140件（全件passed）を再確認。DB上での追加ケースは未実施で、ユーザーの再実行待ち。


## 23. 再利用・期限・owner fenceのDB試験合格、retry状態の次段階（1.16追記）

4回目のユーザー実行で、同一成功keyのキャッシュ再利用、finish RPC再呼び出しの同一prediction ID、締切後claim拒否、期限切れjobの置換、旧ownerの保存拒否、20同時claimのowner1/joiner19が合格した。`NOTICE: PASS`、`PASS: 20 concurrent...`、最終`PASS`を確認。続けて最大2 attempt・sequence重複/超過拒否・retryable/nonretryable fail stateのDB確認をスクリプトへ追加した。`bash -n`とNode 140件が合格。追加分のDB実行は未実施。


## 24. attempt上限・retry可否のDB試験合格、Edge型検査の準備（1.17追記）

ユーザーの5回目のUbuntu実行ログで、最大2回までのattempt制御、sequence再利用拒否、3回目の拒否、retryable=true/falseをfailed job読取に反映することも合格した。前節までの一連のスモーク（migration、入力除去、権限、原子保存、期限切れfence、キャッシュ、20同時claim）も再度完了。

次に、Supabase Edge FunctionをDenoで型検査する`tools/local-integration/ai-edge-typecheck.sh`を用意した。`bash -n`合格。公式Deno Alpine imageを匿名取得し、workspaceをread-only mount、container network無効で`deno check --no-config`を実行する。typecheck結果は未取得であり、Supabase Edge Runtimeの実動作とは区別する。


## 25. Denoコンテナ起動引数修正（1.18追記）

ユーザー実行で公式Deno Alpine image pullは合格したが、image entrypointはsubcommandを自動補完せず、`check: not found`で停止した。実行コマンドを`deno check --no-config ...`と完全修飾するよう修正。`bash -n`合格。Deno型検査自体は未実施で再実行待ち。


## 26. Deno型検査で判明したEdge source不備を修正（1.19追記）

ユーザー実行のDeno型検査はEdge function内に同名`hash`実装が二つあるTS2393と、catch変数が`{}`型なのに`.message`を読むTS2339を検出した。重複関数を除去して残る同一`hash`を共用し、Error instance判定で旧500応答のmessage値を維持しつつcatch値を安全に文字列化する。Node 140件が再合格。修正後のDeno型検査はユーザー実行で合格した。


## 27. Edge mock通し試験を追加（1.20追記）

NodeからEdge handlerをmock環境で起動する`race-prediction/ai-edge-handler.test.mjs`を追加した。公開鍵なしの401、生成開始202、background workerの attempt・Gemini応答・一括保存RPC、結果GETまでを確認する。GeminiとSupabaseへの実通信ではない。全Node試験は141件合格。


## 28. Supabase PostgreSQLコンテナ内の一時DB試験合格（1.21追記）

`tools/local-integration/ai-bundle-db-smoke.sh`に、既存のローカルSupabase PostgreSQLコンテナを指定すると専用の一時DBを作成し、migration/fixture/DBスモークを実施後にそのDBだけを削除するモードを追加した。既定の使い捨てPostgreSQLコンテナ試験も維持する。`bash -n`と`git diff --check`は合格。

2026-09-27 JST、ユーザーが`AI_DB_SMOKE_CONTAINER=supabase_db_project-012 bash tools/local-integration/ai-bundle-db-smoke.sh`を実行。ログでSupabase PostgreSQLコンテナ内へのmigration適用、6艇入力・結果除去、RPC権限、二重/開始前attemptの拒否、不正出力時rollback、正常一括保存、キャッシュ再利用、締切後拒否、期限切れowner fence、最大2 attempt、retryable/nonretryable状態、20並行claim（owner 1・joiner 19）のPASSを確認。一時DBはtrapで削除され、既定`postgres` DBへは適用していない。

この試験はSupabase PostgreSQLエンジンと既存のグローバルroleを使う隔離DB試験である。PostgREST経由RPC、Edge Runtime実行、Gemini実通信、既定DBへのmigration適用、本番環境を確認したものではない。D01/D04/D12/D13/D15等の一部技術条件への証拠であり、70受入ケースの状態は未実施のまま維持する。


## 29. ローカルSupabase Edge HTTP smoke準備（1.22追記）

`tools/local-integration/ai-edge-local-smoke.mjs`を追加した。ユーザー端末のローカルSupabase CLIでpredictions Functionを起動し、OPTIONS、公開鍵なしの401、不正race selectorの400、不正job IDの400をHTTP経由で確認する。テスト用env fileは一時ディレクトリに置き、ローカルanon keyの値やFunctionログは出力しない。Gemini API・DB RPC・既定DBへの書込・deployは行わない。Node `--check`は合格。実行は未実施。

ユーザー端末での実行待ち:

```bash
cd /mnt/c/codex/project-012/Project-012
node tools/local-integration/ai-edge-local-smoke.mjs
```


## 30. ローカルEdge起動の初回失敗（1.23追記）


その後の修正版実行ではCLI/Functionは起動し、preflightと未認証401は通過したが、試験用公開鍵付きPOSTも401となりHTTP試験は不合格。ローカル環境ファイルに旧anon JWTと現行publishable keyの両方があることを値を出さず確認した。試験スクリプトは現行publishable keyを優先し、Edge auth helperの双方の設定名へ渡すよう修正。再実行待ち。


## 31. ローカルSupabase Edge HTTP smoke合格（1.24追記）

2026-09-27 JST、ユーザーが修正版`ai-edge-local-smoke.mjs`をローカルSupabaseで実行。Edge HTTP route、OPTIONS/CORS、公開鍵なしの拒否、範囲外selectorの400、不正job IDの400がすべて合格した。Gemini API、DB RPC、migration適用、本番deployは行っていない。これはEdge Runtime上のHTTP境界の部分確認であり、70受入ケースや生成workerの実動作とは区別する。


## 32. Edge handler異常系mockと全回帰150件（1.25追記）

追加したhandler mockで契約版違い、DB入力なし、identity不一致、艇番不備、締切済み、成功キャッシュ、busy共有job、claim拒否/不正応答、Edge background runtime欠落、job missing/generating/nonretryable failed、RPC errorを確認。10件すべて合格。Gemini/Supabase実接続はなし。

その後、`node --test --test-isolation=none race-prediction/*.test.mjs`を再実行し、150件passed / 0 failed。これはユニット・mock回帰試験であり、70受入ケースを実施済みに変更するものではない。


## 33. ローカルPostgREST/Gemini live smoke runner準備（1.26追記）

`tools/local-integration/ai-edge-postgrest-smoke.mjs`を追加。ローカルmigration historyを読取照合し、v0.1.19 migrationだけが未適用の場合に限り`supabase migration up --local`を実行する。その後、ローカルEdge Functionから未存在レース/未存在jobの読取RPCをPostgREST経由で確認する。主DBへは追加migrationが残るが、fixture/AI job/結果は作らず、Geminiも呼ばない。別のmigrationが未適用なら変更前に終了する。

`tools/local-integration/ai-gemini-live-smoke.mjs`を追加。一時的にシェル環境変数へ設定した`GEMINI_API_KEY`で3.8 Flashへ1回だけ実リクエストし、出力契約・usage・応答時間を確認する。DBには接続せず、キーと生成文を表示しない。両ファイルのNode構文検査は合格。実行は未実施。ローカルDockerへのエージェント直接接続とGemini API keyの実行環境設定がないため、ユーザーWSL端末での実行が必要。


## 34. ローカルPostgREST smokeで502（1.27追記）

初回は未存在レース要求が期待した404ではなく502となったため、HTTP応答本文を公開鍵/JWTを伏せて最大1000文字表示するようrunnerを修正した。初回失敗は次節の再実行で解消し、70受入ケースの集計は別扱いのまま維持する。


## 35. ローカルPostgREST input/read RPC smoke合格（1.28追記）

2026-09-27 JST、ユーザーのWSL上でCodex CLI 0.157.0を`YOLO mode`で起動し、Docker接続をCodex自身から確認した後、`node tools/local-integration/ai-edge-postgrest-smoke.mjs`を実行。終了コード0。migration `20260926000000`をローカルSupabaseへ適用・確認し、実Edge Function + PostgREST経由で未存在raceのinput RPCと未存在jobのread RPCが期待どおり到達し成功。fixture、生成job、predictionは作らず、Gemini API・ホストSupabaseは呼び出していない。これはRPC経路の部分確認であり、70受入ケースは受入条件全体の検証が未完了のため0/70を維持する。

## 36. 試験計画と環境確認、直近の補助結果（1.29追記）

2026-09-27 JST、利用者の依頼により試験計画書・70項目対応表・環境確認結果を作成。計画→診断ログ補強→個別試験の順序を定めた。初回公開の分母69、M03を含む全計画の分母70を分ける。今回、正式な各行の成績は変更していない。

前回ターンで実行済みだったが未反映の補助結果を記録する。生ログ全文ではなく会話内の実行結果に基づく要約であり、今回の環境点検での再実行ではない。

- `race-prediction/*.test.mjs` は11ファイル成功。リポジトリ全体の `.test.mjs` は33ファイル中32成功。過去の個別テスト150件とは単位が異なるため加算しない。
- `race-ingestion/acceptance-harness.test.mjs` は通常実行でloopbackのEPERM。権限拡張後は429確認時に想定外のAbortとなり、3テスト中2成功/1失敗。原因は未確定。
- 保存済みキーでmodels.listはHTTP 200、設定モデルとgenerateContent対応を確認。
- `ai-gemini-live-smoke.mjs` の実生成1回は `provider_http_503` で失敗。GeminiからのHTTP応答が得られたが、正常出力/生成成功の証拠ではない。使用量/費用は不明。

今回の環境点検では、Node/npm/Codex CLI、Windows PowerShell、WSL2、ホストWSL経由のDocker、ローカルSupabase/DB、Deno、Windows同梱Playwright+Edgeの起動・クリック・画像取得を確認。Geminiはモデル一覧のみ再確認し、生成要求は0回。GitHubのmain/tag読み取りとSupabase管理プロジェクト一覧取得も成功。DBスキーマ変更、deploy、pushは行っていない。

残準備: Supabase Vector再起動の調査、背景処理用のローカル設定、結合/画面runner・fixture、実モデル枠、検証先識別、公開前のGitHub書込認証。これらは[環境確認結果](AI-PREDICTION-REFRESH-TEST-ENVIRONMENT.md)で管理する。

## 37. 障害切り分け用ログの補強と確認（1.30追記、2026-09-27 JST）

基本設計第17節・詳細設計第23節を先に追記し、共通構造化logger、provider通信分類、生成workerの工程ログ、AI専用RPC/公開応答の保護、X-Request-ID、ログ抽出ツールを実装した。生成文/入力/秘密値/任意例外は一般ログへ出さない。DB保存結果が不明な場合に再生成・failed更新を追加しない。

### 37.1 補助試験の成績（正式70項目とは別）

| ID | 判定 | 確認内容・証跡 |
|---|---|---|
| L01 | passed | 正常生成→検証→保存、POST/backgroundのrequest ID共有とGETのjob ID相関。モックで確認。実Edgeでは3要求の応答ヘッダーと開始/終了ログを照合 |
| L02 | passed | DNS、接続、TLS、timeout、中止、不正引数、権限の分類と期限後の保存防止を模擬障害で確認 |
| L03 | passed | HTTP 401/403/429/503、本文JSON不正/本文受信中断、MAX_TOKENS、買い目重複。固定分類と既存の再試行判断を確認 |
| L04 | passed | begin/finishAttempt/finishPrediction/failPredictionの例外、DB HTTP失敗、sink同期例外/Promise拒否/未完了を注入。追加送信なし、保存成否不明でfailed書込なし、waitUntil側で未処理例外を止めることを確認 |
| L05 | passed | ダミー秘密を入力/出力/例外/ヘッダー/任意項目へ注入。収集stdout、保存対象のsafeレコード、エラー応答に出ないことを確認。正常な公開予想本文は本来の生成文を返す |
| L06 | passed | 共有64行・2048byte、無効化、同時jobの相関、旧worker開始拒否、ログのフィルタ/16KiB超過行破棄。未完了sinkをawaitしない。実ローカル採取で標準出力/標準エラーを両方処理 |

専用の`ai-diagnostics.test.mjs`と`ai-diagnostics-edge.test.mjs`は30件合格。関連回帰全体は**184件中184件合格**（この30件を内包、重複加算しない）。Node v24.21.0で`--test-isolation=none`を指定し、ファイル単位ではなく個別test/subtest集計を取得した。

- 実行: `node --test --test-isolation=none --test-reporter=tap race-prediction/*.test.mjs supabase/functions/predictions/public-auth.test.mjs`
- Deno: 既存イメージをnetwork none、workspace read-onlyで使用。`deno check --no-config supabase/functions/predictions/index.ts`、終了0。
- 実ローカルEdge: `node tools/local-integration/ai-edge-local-smoke.mjs`、終了0。OPTIONS、認証拒否、無効selector/job、相関ヘッダー/ログを確認。DB RPCと実Geminiは0回。
- 初回実Edge採取は`start log missing`で失敗。Docker stdoutだけを読んでいた収集処理をstdout/stderr両方のメモリ内フィルタへ修正し、再実行で6行/3要求の相関を確認。製品側で例外本文を表示する対処は行っていない。

[機械可読結果](test-evidence/v0.1.19/20260927-diagnostics-results.json)と[補強後のソース識別](test-evidence/v0.1.19/20260927-diagnostics-source-baseline.json)を保存。TAPと採取ログはGit対象外の`tools/audit-v019/diagnostics-20260927/`にあり、結果JSONには秘密を含まない要約と6行の相関ログを収録した。

### 37.2 範囲と残事項

今回の補強確認L01〜L06は6/6。正式受入70件の各行は変更しておらず、初回公開69件の合格確定率も従来のまま。実モデル、実DB保存の障害注入、長時間背景処理、UI/公開URL、切り戻し全体の合格を意味しない。リポジトリ全体/収集・コメントの網羅回帰も今回の184件には含まない。

Vectorの再起動は未解決だが、直接docker logs経由の安全な採取を確認済み。P3前に背景処理設定と採取方法を確定する。実Gemini要求、DB構造変更、本番操作、pushは行っていない。次は試験対応表I01から既存証跡を照合し、不足条件を一つずつ実行する。


## 38. P2入力・契約確認の実施（1.31追記、2026-09-27 JST）

試験計画P2に着手。P2対象のmodule/mock試験を補い、使い捨てPostgreSQL上で実RPC/migration経路を確認した。試験の過程で二つの仕様ずれを検出し、詳細設計とコードを合わせて修正した。

### 38.1 P2で確認した内容

| 条件 | 結果 | 確認範囲 |
|---|---|---|
| I02 結果情報の除外 | P2確認済み | `result`/払戻/返還に加え、入着・実進入・本番ST等の既知キーと既存予想用の名前付きキーを深い階層から除外。JS入力境界と使い捨てDBのget_ai_inputで確認 |
| I03 欠損の区別 | unit passed | null/欠落/空配列/原文、presence情報を入力化。実RPCで全variantを採取する条件は後続 |
| I06 艇識別 | unit/mock passed | 5艇、重複/不正艇番、null、key不一致等を入口Mockへ送り、claim/Gemini呼出前に拒否 |
| I07 締切/開催日 | 部分確認 | 過去日claimを実PostgreSQLが拒否。締切不明/過ぎの境界をmock/DBで個別網羅する残りはP3 |
| I08 古い取得時刻 | DB契約確認 | fetchedAtを2000年にしても時刻の古さだけでclaimを拒否しない。実Edge→モデル呼出はP3 |
| I10 事実と指示 | unit passed | 指示風のタイトル/未知API項目をfacts側へ保持しsystem instructionから分離。モデルが内容上従わないことの保証は対象外 |
| I11 氏名/登録番号欠損 | unit passed | 6艇を識別できる限り氏名/登録番号の欠損を補完せず、Gemini request factsにもそのまま保持 |
| G01/G03/G04/G05 | unit passed | プロンプト/4項目Schema、各艇番配列の型・長さ・範囲・重複、買い目同一性、必須欠損/空文/JSON不正を確認 |
| G06 | 部分確認 | 短文/長文/複数段落をvalidatorが受理。実ブラウザーでの非切断はP5 |
| G09/G10 | unit passed | 同一入力のfactsHash一致、各種事実更新と締切更新によるhash変更を確認。DB上の成功結果再利用はP3 |
| G11 | unit passed | model/prompt/style/thinking/Schema/adapter設定変更時のconfigHash変更を確認 |
| G12 | 部分確認 | 未対応provider/thinking値を拒否。provider adapter差替えの統合確認はP3 |

### 38.2 修正と実行結果

- P2の再利用キー試験で、詳細設計は意味のある締切変更を同一性へ反映すると定める一方、実装のfactsHashにはclosedAtが含まれていなかった。詳細設計の計算式を更新し、`inputSchemaVersion=ai-input-v2`としてclosedAtを追加。締切だけ変更した場合のhash変更を試験。
- DBのrecursive stripとJSの`separateProgram`の除外条件にずれがあった。入着/実進入/本番ST等および`existing_prediction`/`ai_prediction`/`prediction_snapshot`を再帰的に除外するよう両方を合わせ、深い階層のfixtureで確認。
- 使い捨てPostgreSQL 17でmigration/RPC入力、過去日拒否、古いfetchedAt許容、権限、attempt重複防止、失敗時rollback、成功保存/再利用、20同時claimを再試験し全て合格。実Geminiでなく模擬429を六つの別jobへ同時注入する試験も追加し、1jobあたり最大2送信と成功/回復を確認。利用者のSupabase DBは変更していない。
- 対象回帰は**209件中209件合格**。試験ファイル内のsubtestを含むNode test件数で、70受入ケースへ足し合わせない。
- Deno `deno check --no-config supabase/functions/predictions/index.ts`終了0。
- 追加mock: 20秒一時通信失敗後の保存、202を6回超受けるjob polling、複数レース同時実行中のHTTP429回復。いずれもvirtual time/模擬providerで、実時間20秒・実RPM計測ではない。

詳細: [P2機械可読結果](test-evidence/v0.1.19/20260927-p2-results.json)、[P2後source baseline](test-evidence/v0.1.19/20260927-p2-source-baseline.json)。TAPは`tools/audit-v019/diagnostics-20260927/p2-regression.tap`。

I01の全API項目比較、I03/I08の実RPC→Edge経路、各IDのP3条件は未完了。正式な70項目の判定は、全受入条件がそろうまでpassedへ繰り上げない。P2のunit/mock項目は計画範囲を実行済み。I03の実RPC variant、I08の実Edge生成、G09/G10の成功bundle再利用等はP3の依存項目として明記し、次はP3でI01から実RPC/Edgeの結合を行う。M08の実モデル使用量試験はP4で実施する。

## 39. P3のローカル実DB/Edge確認（1.33追記、2026-09-27 JST）

P2終了後、計画に沿ってP3のうち外部AIを呼ばずに確認できるローカル経路を進めた。実レースデータはローカルDBに存在せず、合成fixtureでの限定確認となる。

| 実施内容 | 結果 | 範囲と限界 |
|---|---|---|
| 実PostgREST `get_ai_input` と合成6艇fixture | passed | 6艇のraw entry、未知API項目、欠損/null/空値のpreview variantを維持。結果/払戻/着順/実進入/本番ST/既存予想キーを再帰除外。終了時fixture cleanupを実行。正式I01の全API仕様比較ではない |
| 実ローカルEdge + PostgRESTのinput/read RPC | passed | migration `20260927000000`を確認し、未存在レース/jobのRPC経路と期待応答を確認。fixture/job/Gemini呼出なし |
| 締切済みfixtureの実Edge入力検証 | passed | 実EdgeがDBからfixtureを読み、契約検証後に`closed`を返す。job 0件、Gemini 0回。fixtureはrunnerの`finally`で削除 |
| Edge handler→実PostgREST成功結合（provider mock） | 技術確認passed | claim→begin attempt→provider mock 200→validation→finish attempt/job→bundle readが成功。再POSTで同じsaved bundleを再利用し、追加provider呼出しなし。異なる入力で初回重複→2回目正常の修復、別入力で2回空文→retryable failure・部分bundleなしも確認。合計5回のmock応答。handlerはNode内、`EdgeRuntime.waitUntil`はテストcaptureなので、Deno runtimeの背景継続を証明しない |
| 両AI migrationを含む隔離PostgreSQLスモーク | passed | migration、recursive input filtering、歴史日付拒否、RPC権限、duplicate attempt fence、rollback/atomic save/reuse、期限切れowner fence、最大2試行、retryable/nonretryable、20並列claim（owner 1 / joiner 19）。一時DBは削除 |
| D12 不正買い目/展開文のDB制約 | 部分確認 | 重複/null/範囲外/要素数違い/空の艇番配列と空白展開文を拒否し部分bundleがないことを確認。キー/FKを含む全制約組合せは未完了 |
| Edge TypeScript/Deno型検査 | passed | `supabase/functions/predictions/index.ts`、終了コード0 |
| Gemini実モデル疎通（P4 M01） | failed | 生成APIを1回呼出し、HTTP 503。契約有効な生成結果なし。キー・応答本文・生成文は証跡に含めない。枠とサービス可用性を確認するまで再要求しない |
| M05 ローカル90秒waitUntil | 未確認 | 一時Edge Functionを起動したがrouteが404/503で、完了markerを取得できず。既存Edge RuntimeコンテナはCreated状態で、手動起動はmain worker entrypoint不足で終了コード1、predictions routeは503。一時Functionは削除済み。ローカル環境要因として製品機能の不合格とは判定しない |
| ローカル実データ有無確認 | 完了 | `race_data.races`/`normalization_batches`/`day_heads`は各0件。公式APIサンプルとの完全比較に使える既存レースなし |

P3のfixture/DB/Edge試験は実際には一時生成jobとbundleを作成し、確認後にrunnerの`finally`で削除した。後続のPostgREST fixture再投入・読取・削除も成功し、合成raceを再利用できることを確認した。ホストSupabase接続、公開環境操作は行っていない。別途P4の実Gemini smokeを1回実施したがHTTP 503。ローカル`supabase/config.toml`の`per_worker`指定は存在するが、`EdgeRuntime.waitUntil`のDeno runtime継続は未確認。

P3の正式ケースは全条件を満たすまでpassedへ繰り上げない。I01は全API項目比較が未実施、I03は実Edgeでのnull/欠落全variantが未実施、D01〜D16は実Edge統合や障害条件が未完了。試験結果の機械可読記録は[test evidence](test-evidence/v0.1.19/20260927-p3-results.json)、対応ソース識別は[P3 source baseline](test-evidence/v0.1.19/20260927-p3-source-baseline.json)。

## 40. P5ローカル画面mock確認（1.34追記、2026-09-27 JST）

Playwright + Windows Edgeでローカル静的serverを使い、`tools/local-integration/ai-ui-browser-smoke.cjs`を実行した。Supabase、Gemini、コメントの全外部HTTP要求はroute mock/abortに固定し、実API・DB・公開URLへは接続していない。

| 確認範囲 | 結果 | 制約 |
|---|---|---|
| U01 | 部分確認 | 初期はSTART無効、開催会場と開場レースの選択後に有効 |
| U02/U03 | 部分確認 | 202 pending→job read success後、停止演出完了後に一括bundle表示。細かい演出時間計測/別の遅延時間比較は未実施 |
| U05 | 部分確認 | 2回目のmock POST 503で失敗案内、古い対抗/穴/展開を消し、STARTを復帰 |
| U07 | 部分確認 | 後続ブラウザー実行で1000文字超の複数行展開文を表示。HTML風文字列の表示確認は前回実行、実Edge/API連携は未確認 |
| U10 | 部分確認 | 320/390/430/1280pxで横スクロール幅がviewport以下。買い目bundle再利用と長文/失敗表示も後続実行で確認。実スマートフォンは未確認 |
| U04 | 部分確認 | 仮想時刻で締切到来後の選択解除、JST日付切替後の再取得、5分更新を合成APIで確認。実Edge/API連携は未確認 |
| U06 | 部分確認 | U05の締切前retryable失敗に加え、締切直前開始→期限到来で閉鎖案内となり、再試行を促さずSTARTを停止することを仮想時刻で確認。実Edge/API障害は未確認 |
| U08 | 部分確認 | 旧ページの遅延POST応答が、新ページで完了したbundleやSTART状態を上書きしないことを確認。実通信/同一画面内の新run競合は未確認 |
| U11 | 部分確認 | v0.1.18画面の旧形式POSTは新APIモックが安全に拒否しモデル呼出し0回。再読込でv0.1.19画面が新契約を使用し成功。実Edge/API連携は未確認 |
| U09 | 部分確認 | コメント関連Node単体回帰52件は合格。ブラウザー実投稿/一覧/旧予想関連は未確認 |

このrunnerはbrowser/pageを終了する前に成功を出し、外部ネットワーク要求は発生していない。mockで一部条件だけを確認した場合はpassedへ上げない。受入条件が画面側にある項目は、指定された全状態・異常分岐を実ブラウザーで確認して判定する。実端末、コメント回帰との総合確認、実サービス配信を要する他ケースは未完了である。詳細な機械可読結果は[P5結果](test-evidence/v0.1.19/20260927-p5-results.json)、試験対象ソースは[P5 source baseline](test-evidence/v0.1.19/20260927-p5-source-baseline.json)を参照。

### U09関連コメント回帰（2026-09-27 JST）

コメントの返信生成、安全処理、予想コンテキスト、レース文脈、返信ルーティングに関する既存Node単体テスト52件を実行し、52件すべて合格。ブラウザーからの実投稿、Edge統合、予想刷新画面との連携は含まないため、U09は部分確認のままで正式合格にはしない。詳細は[P5機械可読結果](test-evidence/v0.1.19/20260927-p5-results.json)に記録した。

### U04日付・定期更新およびU06締切後の失敗表示（2026-09-27 JST）

Windows Edgeで仮想時刻を使い、23:58 JSTから締切到来後に選択が解除されること、日付切替後に新しい日付の開催情報を取り直すこと、5分周期の定期更新が現在の日付を再取得することを確認した。また締切直前に開始し、処理中に締切を迎えた場合は閉鎖案内を表示して再試行を促さず、STARTを停止することも確認した。合成APIによる部分確認であり、実Edge/API障害を含む正式U04/U06合格ではない。実行runnerは`tools/local-integration/ai-ui-date-refresh-smoke.cjs`。

### U08画面遷移後の遅延応答（2026-09-27 JST）

Windows Edgeで、旧画面のSTART要求に対する応答を保留し、新しいページで別のbundle生成を完了させた後に旧応答を返した。新ページの展開文・買い目・START状態は変化しなかった。ローカルmockの画面遷移ケースのみであり、同じ画面内の新run競合や実API通信を含む正式U08合格ではない。実行runnerは`tools/local-integration/ai-ui-stale-response-smoke.cjs`。

### U11 v0.1.18画面とv0.1.19 API契約（2026-09-27 JST）

タグv0.1.18の画面をローカル配信し、旧形式のPOSTをv0.1.19 API契約モックへ送信した。新APIは409相当の非再試行失敗を返し、Gemini呼出しは0回。画面を再読込するとv0.1.19と表示され、新しいAI bundle契約でmock生成が完了した。ローカルmock試験のため、実Edge/API配信を含む正式U11合格ではない。実行runnerは`tools/local-integration/ai-ui-mixed-version-smoke.cjs`。

## 64. Windows Edgeの長文・再利用・失敗UI確認（1.37追記、2026-09-28 JST）

ユーザーがWindows PowerShellからPlaywright/Edgeの`tools/local-integration/ai-ui-browser-smoke.cjs`を実行し、初期選択、START/poll/success、二つ目のbundle表示、1000文字超の複数行展開文、失敗時の表示クリアを確認した。320/390/430/1280pxの画面幅で横はみ出しがなく、Supabase/Gemini/コメント通信はすべてinterceptされた。実サービスや公開URLへの通信なし。これはU01/U02/U03/U05/U07/U10の部分確認を補強するが、演出時間の全要件、実API連携、実スマートフォン、既存艇色等を含む正式な受入条件は未完了のため、正式合格数47件を維持する。


## 65. U04日付切替・U06締切後のUI（1.38追記、2026-09-28 JST）

ユーザー実行のWindows Edge local mockで、締切後の選択解除、JST日付切替時の開催情報再取得、5分後の定期更新、実行中に締切を迎えた際の締切案内と再試行非表示を再確認した。virtual clockと合成APIのみであり、Supabase/Gemini/hosted/public URLへの通信なし。U04/U06は部分確認を更新したが、実API/API障害を含む受入全条件は未完了のため正式合格数47件は維持する。[U04/U06 browser evidence](test-evidence/v0.1.19/20260928-ui-date-refresh-smoke.json)


## 66. U08画面遷移後の古い応答（1.39追記、2026-09-28 JST）

ユーザー実行のWindows Edge local mockで、最初のページのSTART POST応答を保留し、新しいページで別runを成功させてから古い応答を返した。新しい展開文・買い目・START状態が上書きされないことを確認した。Supabase/Gemini/hosted/public URLへの通信はない。画面遷移の部分条件は再確認したが、同一画面内の新run競合や実API通信を含む受入全条件は未完了のため正式合格数47件を維持する。[U08 browser evidence](test-evidence/v0.1.19/20260928-ui-stale-response-smoke.json)


## 67. U11新旧画面/API契約混在（1.40追記、2026-09-28 JST）

ユーザー実行のWindows Edge local mockで、v0.1.18画面の旧形式POSTが新API契約に安全に拒否され、モデル要求が0回であることを確認した。再読込後のv0.1.19画面では版表示とAI bundle契約を確認し、mock生成が正常完了した。Supabase DB/Gemini/hosted/public URLは未使用。実Edge/API配信切替の全条件は確認していないためU11は部分確認のまま、正式合格数47件を維持する。[U11 browser evidence](test-evidence/v0.1.19/20260928-ui-mixed-version-smoke.json)


## 68. D07/M05 runnerのWindowsパス修正（2026-09-28 JST）

ユーザーがWindows PowerShellから`ai-edge-waituntil-smoke.mjs`を起動した際、初回は`URL.pathname`由来の`/C:/...`をWindowsパスとしてresolveし、`C:\C:\...`となって一時Function作成前に`ENOENT`で停止した。`fileURLToPath()`へ修正後の2回目はFunction serve起動とreadiness probeまで進んだが、OPTIONS probeが502を返したため、POST要求前に停止した。runnerのfinallyが一時Function directoryを削除した。次回の原因調査に備え、Docker Edge container状態と関連する起動/worker/error行だけを収集し、JWT/Bearer/API key等を伏字にして表示する診断を追加。修正版はNode構文検査済み。D07/M05の実ランタイム試験は未実施であり、502のみでは製品機能の不合格と判定しない。


## 69. D07/M05 readiness 503時の診断と後始末修正（2026-09-28 JST）

ユーザー再実行ではOPTIONS readinessが503となり、POSTは送信されなかった。Node.js終了時にlibuv assertionも出力された。503分岐が診断情報を含めていなかったことと、エラー応答bodyをcancelする前にthrowしていた点を修正し、502/503とも安全に伏字化した診断を出すよう変更した。Windowsでは`taskkill /T`でserveプロセスツリーを停止し、子プロセス`close`を待ってから一時functionを削除する。Node構文検査済み。実Edge Runtimeの背景継続はまだ未確認。


## 41. 自律実施できる試験の追加実行（1.35追記、2026-09-27 JST）

依頼に基づき、利用者の操作を必要としないローカル試験を継続した。秘密情報は記録せず、Geminiの追加生成要求・ホストSupabase・公開URL・deploy・pushは使用していない。

| 試験 | 結果 | 確認した範囲 |
|---|---|---|
| `node --test race-prediction/*.test.mjs` | passed | 現ソース205件、失敗0。単体/mock回帰であり70正式項目には加算しない |
| 実PostgREST入力fixture | passed | 6艇の生項目とpreview variantを保持し、結果/既存予想情報を再帰除外。cleanup済み |
| 実Edge + PostgREST締切済みfixture | passed | 合成6艇入力を読み、締切済みをjob claim前に拒否。cleanup済み、AI要求0 |
| production handler + 実PostgREST/mock provider | passed | claim/attempt/save/read/reuse、重複買い目の修復、2回不正後の部分保存なし。fixture/生成行cleanup済み |
| D12 key/FK制約（隔離PostgreSQL） | 部分確認 | この時点では不正key形式、存在しないkey、job/reuse-key不一致を確認。全参照関係を含む正式合格は第42節で記録 |
| EdgeRuntime `waitUntil` 90秒継続 | blocked | 一時Functionのready確認がHTTP 503。POSTを送らず、Function directory cleanup済み。製品動作の判定には使わない |

D12試験追加時の初回実行はfixture jobの一意制約に当たった。key/jobを独立させ、SQL NULLを明示的にfalseと区別する assertion に修正して再実行し、全体が成功した。機械可読詳細と更新後のP3ソース識別は[P3結果JSON](test-evidence/v0.1.19/20260927-p3-results.json)と[P3 source baseline](test-evidence/v0.1.19/20260927-p3-source-baseline.json)に記録した。D12は全条件を満たした証跡に基づきpassedへ更新。


## 42. D12正式合格と自動試験の最新集計（2026-09-28 JST）

D12の受入条件に対応する不正値を使い捨てPostgreSQLへ投入し、すべて制約違反となることを確認した。対象はnull/重複/範囲外/長さ不正/空/多次元の艇配列、空白展開文、不正形式と重複reuse key、重複bundle、key・job・attempt・bundle・raceの不在参照、jobとreuse keyの複合参照不一致。既存の正常保存、再利用、retry/fencing、20同時claimも同じ最終smokeで成功し、使い捨てDBは削除された。D12の期待条件と証跡が揃ったため、これを正式passedとする。

- 正式受入: **初回対象1/69、全計画1/70**。残りを自動試験件数で代替しない。
- 現ソースの`race-prediction/*.test.mjs`: **205 passed / 0 failed**（単体/mock回帰。正式分子には加算しない）。
- 実PostgREST/Edge/模擬providerでの合成fixture確認は成功。Gemini生成要求は今回0回。
- M05背景処理90秒確認は一時Function routeがHTTP 503となり未完了。ローカルEdge Runtime起動環境の問題とし、製品動作のpass/failは判定しない。

P3の機械可読結果と更新後source baselineを更新した。Gemini HTTP 503、未解決のEdge Runtime起動、実機/公開環境など、Codex単独で安全に完了できない条件は未完了のまま管理する。


## 43. P2/P3自動合格項目の追加確定（2026-09-28 JST、後続更新前の記録）

この節の15/70は同節作成時点のスナップショットで、最新件数ではない。最新の正式合格数は第57〜58節と機械可読証跡を参照。「単体/mock完了」とだけ記録していたケースを、試験対応表の条件とP3実DB/Edge fixtureを照合して再判定した。I02、I03、I05、I06、I10、I11、G01〜G08は必要条件がそろったため正式passedへ更新。D12は第42節の隔離DB証跡でpassedを維持する。

- **正式合格: 15/70（全計画）、15/69（初回公開対象）**。残りを205件の単体assertion数から推定していない。
- 単体/mockは205/205、P3実PostgRESTとmock providerの9要求、P5の1000文字超画面表示も成功。外部サービス要求は行わず、Gemini生成0回。
- P3統合で、preview欠損のまま有効な6艇データがproviderへ進むこと、重複買い目の2回目出力だけが4項目まとめて保存されること、欠落/空文/壊れJSONが最大2回で停止し、部分結果や旧方式fallbackが出ないことを確認した。

ケース別根拠、実行結果、対象ソースハッシュは[自律追試結果](test-evidence/v0.1.19/20260928-autonomous-followup-results.json)と[source baseline](test-evidence/v0.1.19/20260928-autonomous-followup-source-baseline.json)。未完了ケースはHTTP 503のEdge Runtime、Gemini実生成、実データ源、実機/公開環境などの条件を含み、引き続き個別管理する。


## 44. 時間制御・provider障害ケースの確定（2026-09-28 JST）

ケース単位で、T01/T02/T03/T04/T05/T06/T07/T10をpassedへ更新した。T01/T02/T03/T04/T06/T07/T10は仮想時間/模擬providerで仕様上のdeadline、retry、polling動作を確認。T05は実ローカルPostgRESTとproduction handlerにprovider HTTP 401/403/404を模擬し、再送なし、private provider body非露出、bundle非保存を確認した。

T08/T11は完了。T09は50/70秒の模擬応答試験が通ったが、実時間のDeno EdgeRuntime継続を確認できていないため部分確認に留める。

合格済みは **42/70（初回対象42/69）**。全race-prediction単体/mockは206/206。外部AI生成要求は0回。ケース別結果と最新ソース識別は[自律追試結果](test-evidence/v0.1.19/20260928-autonomous-followup-results.json)に記録した。


## 45. 古い取得時刻の生成経路確認（2026-09-28 JST）

I08をpassedへ更新した。実ローカルPostgRESTで11分・31分前および時刻不明のfetchedAtが保持されること、古い時刻だけで新規claimを拒否しないこと、production handlerから11分前のfetchedAtを含むpayloadがmock providerへ送られ生成・保存されることを確認した。合成フィクスチャはcleanup済みで、外部AI要求は行っていない。


## 46. 新規開始の対象日・締切境界確認（2026-09-28 JST）

I07をpassedへ更新した。隔離PostgreSQLのclaimで過去日レースを拒否し、production handler試験で書式不正の日付、欠落/不正な締切時刻、締切経過をRPC claim前に拒否することを確認した。試験DBは破棄済み。


## 47. 再利用キーと設定変更の確認（2026-09-28 JST）

G09〜G11をpassedへ更新した。同一入力・設定の再要求では前回のbundleを返しproviderを呼ばない。展示/事実/presence/締切の変更はfactsHashへ反映し、実DB連携でも事実変更が別job/bundleを作る。モデル等の設定変更はconfigHashへ反映し、実DBでmodelだけ変えても古い成功結果を再利用しないことを確認した。


## 48. day_heads更新中の読取整合性（2026-09-28 JST）

I09をpassedへ更新した。ローカルPostgRESTで合成した2つのready batch間をday_headsが切り替わる間に120 RPC readを実行し、各結果のbatchIdと出走表/展示/component IDが同一batch由来であることを確認した。fixture cleanup後、race・batch・component・day_head参照の残存件数は0。


## 49. 同時開始と権限境界（2026-09-28 JST）

D04/D13をpassedへ更新した。実production handlerとlocal PostgRESTで同じ選択の20同時STARTをmock provider応答待ちの状態で合流させ、同一job・単一worker・単一provider要求を確認した。ローカルSupabaseではanon/authenticatedの全AI RPC/内部job・bundle表拒否、service_role必要権限を確認し、HTTP入口と成功job応答にもraw入力・owner・provider key・内部設定等が出ないことを検証した。


## 50. 期限切れ再開始と旧workerの保存拒否（2026-09-28 JST）

D08/D09をpassedへ更新した。開始中jobを期限切れにした後のGETはproviderを再呼出しせず、手動STARTだけが別jobを開始した。遅れて完了した旧ownerはbundle保存を拒否され、置換jobのbundleのみ1件保存された。


## 51. 成功保存の参照整合と開始時入力固定（2026-09-28 JST）

D01/D06をpassedへ更新した。成功保存後にjob・reuse key・成功attempt・bundleの参照整合を実DBで確認した。provider応答を保留中に出走表データを更新すると2番目のSTARTは別jobとなり、各jobの入力bundleがそれぞれ開始前/更新後の値を保持して両方保存された。


## 52. 保存commit後の応答消失（2026-09-28 JST）

D03をpassedへ更新した。production handlerが実PostgRESTへ保存をcommitした後、試験fixtureがfinish RPCのHTTP応答だけを破棄した。provider要求の再送や二重保存はなく、job GETから成功結果を回復できることを確認した。


## 53. クライアント時計ずれ（2026-09-28 JST）

T08をpassedへ更新した。リクエスト中にDate.nowを+24時間/-24時間変化させてもperformanceベースの単調時計で共有期限を守り、後続202応答のremainingMs延長を無視し、一時GET失敗からSTARTを再送せず復帰することをmock試験で確認した。


## 54. 締切後読取と取得時刻更新（2026-09-28 JST）

D11/D14をpassedへ更新した。締切後の新規STARTは既存成功キャッシュがあっても拒否され、開始済みjobのGETは同じbundleを返す。fetchedAt/last_success_atだけを更新した再STARTではAIを再度呼ばず、保存bundleの初回fetchedAtも変更されなかった。


## 55. 0/30/60秒の同時利用（2026-09-28 JST）

D05をpassedへ更新した。実時間で最初のSTARTを0秒、2件目を30秒後、mock provider応答と保存を60秒後に置き、同じjob/worker/provider要求を共有することを確認した。両者の結果は共通jobから取得でき、90秒の共有期限内に成功した。


## 56. 締切を跨ぐ修正生成（2026-09-28 JST）

D10をpassedへ更新した。締切3秒前にjobを開始し、初回の重複買い目応答を締切後に返すと、保存済みの入力bundleで一度だけ修正要求を行い、締切後に一括bundleを保存・GETできた。


## 57. claim lock waitと最後の状態GET（2026-09-28 JST）

T11をpassedへ更新した。実ローカルPostgreSQLのreuse-key行をロックし、production handlerのclaimが2秒予算の約2005msで停止してproviderを呼ばないことを確認した。別途client mockでは残り2秒でjob GETを一度行い、retryable=falseを受けたら再POSTせず終了した。


## 58. 最終回帰と型検査（2026-09-28 JST）

追加したI/G/D/Tケースの後、`node --test race-prediction/*.test.mjs`で全15 test modulesが通過し、`tools/local-integration/ai-edge-typecheck.sh`も終了コード0で完了した。最終結果は42/70（初回対象42/69）。Gemini生成、hosted Supabase、GitHub write、deployは行っていない。


## 59. D15 開始RPC応答消失の単体確認（2026-09-28 JST）

begin_ai_attempt RPCの例外を単体fixtureで再現し、送信許可を受け取れない場合にproviderを呼ばず、attemptをunknownとして記録し、jobをretryableな失敗状態に閉じる処理を追加した。診断イベントは許可リストへ追加し、秘密値を含めないことも確認した。Node全15モジュールは再度passした。この時点ではDocker socketへの接続権限がなく実PostgREST試験待ちとなり、D15は一部確認だった（次節で完了）。Gemini/hosted Supabaseへの通信は行っていない。


## 60. D15実PostgREST確認（2026-09-28 JST）

ユーザー実行のローカルPostgREST fixtureでbegin-attempt RPCのcommit後応答消失を注入し、provider要求が増えないこと、sequence 1のattemptがunknownとして1件記録されること、jobがretryable failureで閉じることを確認した。全fixtureはfinallyで削除され、Gemini/hosted Supabaseへの要求はない。D15をpassedへ更新し、正式合格は43/70（初回対象43/69、全体61.4%、初回対象62.3%）。[D15 evidence](test-evidence/v0.1.19/20260928-d15-authorization-response.json)


## 61. D02保存前エラーとG13開始後の入力・設定固定（2026-09-28 JST）

ユーザー実行のローカルPostgREST fixtureで、finish RPCがDBへ届く前に502となる保存障害を注入した。provider要求は1回のままでbundle/成功表示はなく、GETも生成中を返した。続けてprovider待機中に入力・model・styleを変更し、旧jobの初回/修正requestが旧値、後続STARTが新値の別job/bundleを使うことをDBとmock provider payloadの両方で確認した。fixtureはcleanup済み。D02/G13をpassedへ更新し、正式合格は45/70（初回対象45/69、全体64.3%、初回対象65.2%）。Gemini/hosted Supabaseへの通信はない。[D02/G13 evidence](test-evidence/v0.1.19/20260928-d02-g13-postgrest-results.json)


## 62. T09の実時間遅延応答（2026-09-28 JST）

Node回帰に実時間試験を追加し、模擬providerが50秒/70秒待って正常応答する両条件で、要求1回・bundle保存1回・元の90秒期限内完了を確認した。D05では別途、実PostgREST/production handlerの60秒完了を確認済み。全15 Node test modulesも実時間T09を含め再度passした。T09をpassedへ更新し、正式合格は46/70（初回対象46/69、全体65.7%、初回対象66.7%）。生成APIは呼び出していない。[T09 evidence](test-evidence/v0.1.19/20260928-t09-real-clock-results.json)


## 63. D16保存と期限切れGETの競合（2026-09-28 JST）

ユーザー実行のローカルPostgREST fixtureで、保存RPCが先にjob row lock待ちへ入った状態でGETを並行させ、保存が先に確定した場合はGETが成功を読み、期限切れ時刻を過去にして再GETしても成功状態が維持されることを確認した。別シナリオではsaveをreuse-key lockで待機させ、期限切れGETが先にjobをexpiredへ遷移させた後、saveがbundleを作らず拒否されることを確認した。D16をpassedへ更新し、正式合格は47/70（初回対象47/69、全体67.1%、初回対象68.1%）。fixture cleanup済み、外部AI要求なし。[D16 evidence](test-evidence/v0.1.19/20260928-d16-postgrest-race-results.json)


## 70. Edge起動途中の503による早期停止を修正（2026-09-28 JST）

ユーザー実行の診断は`edgeContainer=created|false|0`、CLI出力は`Setting up Edge Functions runtime...`だった。コンテナ未起動の時点でrunnerが503を即時エラーとし、起動中のCLIを終了させていた。コンテナが起動途中なのか起動できないのかはこの結果だけでは未確定。準備確認を独立helperへ抽出し、OPTIONSのみで404/502/503および接続失敗を最大60秒待機、204後だけ試験POSTへ進むよう変更。15秒ごとに待機状況を表示し、期限切れ/CLI終了/認証などの非一時的HTTPエラーでは診断付きで終了する。Docker logs取得にも5秒期限を設定。

外部通信なしの模擬試験4件（接続失敗と502/503/404から204への回復、継続503の60秒打切りとPOSTなし、CLI途中終了、401即時終了）を実行し全件合格。runner構文検査も合格。これらは試験補助処理の確認であり、実Edge Runtimeの90秒継続確認ではない。正式合格47/70を維持する。


## 71. 起動成功後のDockerログ取得エラー（2026-09-28 JST）

ユーザー再実行はreadinessと試験POSTの202応答・marker照合を通過し、完了待機中のdocker logs取得で停止した。ログ取得失敗の原因と90秒背景処理の成否は未確定。毎秒のDockerログ読取を変更し、serveプロセスから取得済みのstdout/stderrを優先して、このrun固有の完了markerと経過時間を確認する方式に修正した。Dockerログは15秒間隔の補助手段とし、取得失敗で即時中断しない。Functionへの追加要求は送らず、120秒内に完了証跡を得られなければ未確認として終了する。

補助処理の模擬試験4件（Docker失敗でもCLI完了検出、Docker補助経路で完了検出、証跡なし/別runを成功扱いしない、プロセス終了/不正時間を拒否）は全件合格。runner構文検査も合格。実環境再実行は未完了で、正式47/70は維持する。


## 72. 120秒観測しても背景処理完了markerなし（2026-09-28 JST）

ユーザー実行ではHTTP 202を確認し、15/30/45/61/76/91/106秒の各観測でDockerログは取得可能だったが、120秒以内に対象runの90秒完了markerを検出できなかった。背景処理が継続しなかったのか、ログによる観測が不十分なのかは未確定で、成功とは判定しない。M05を部分確認へ更新、正式合格47/70は維持。

リポジトリのedge_runtime.policyはper_workerで、Supabase公式background tasks資料のローカル試験設定と一致する。ただし稼働中runtimeへの反映は未確認。再実行前に読取専用のai-edge-runtime-diagnostics.mjsでCLI版、コンテナ状態と過去30分のログ分類/時刻を採取する。ログ本文と環境変数は出力せず、試験Function要求・起動・停止・設定変更は行わない。終了ログにはrunner後始末による終了や過去試行が混在し得るため、分類件数だけで原因を断定しない。診断script構文検査合格。


## 73. `per_worker`を実行中のローカルstackへ反映する手順（2026-09-28 JST）

診断結果は設定ファイルで`per_worker=true`、runtime containerはrunning、OOMなし、ログ6行で、特定できる終了理由や完了markerはなかった。設定値表示は稼働中containerの実効設定を証明しない。Supabase公式の[config reference](https://supabase.com/docs/guides/local-development/cli/config)は設定変更後に`supabase stop`と`supabase start`を実行するよう案内している。標準の`supabase stop`はDocker resourcesを維持し、`--no-backup`のみローカルデータvolumeを削除する ([CLI stop reference](https://supabase.com/docs/reference/cli/supabase-stop))。そのためローカル開発stackを通常停止・再起動し、per_worker適用後にD07/M05を再試験する。まだstop/startも再試験も実施していない。


## 74. Supabase再起動時のStudio health check停止（2026-09-28 JST）

ユーザーは通常の`supabase stop`を実行し、CLIがlocal dataをDocker volumeへ退避したと報告した。続く`supabase start`はstorage-api image更新後、Studio Next.jsがReadyと表示された一方で`supabase_studio_project-012 container is not ready: unhealthy`となって停止。Edge waitUntil smokeは起動していない。データ消去optionは使用していない。Supabase CLIは`start -x studio`でStudioを除外して他サービスを起動できるため、ローカル画面は一時的に停止したまま、試験に必要なEdge/API/DBを立ち上げる方針とする ([CLI start reference](https://supabase.com/docs/reference/cli/supabase-start))。


## 75. Studio除外起動後も完了ログなし・通知による観測（2026-09-28 JST）

ユーザーのstart -x studioは成功し、ローカルAPI/DBを起動できた。続くwaitUntil試験は202応答後、約120秒の観測でDockerログ読取に成功したが完了markerなし。再起動で改善したとは判定せず、設定反映漏れのみを原因とする仮説は未立証。Studioは除外したままで、後日復旧が必要。CLI出力に含まれた認証情報は証跡へ転記しない。

試験用Functionを、ログに依存せずローカルの一時HTTP受信口へ開始/完了/終了理由を通知する方式に変更。開始通知受信と202を確認後、Functionへ追加要求せず最大120秒観測する。run識別子と通知順序を検証し、完了時はFunction時間85〜100秒とホスト単調時計85〜120秒を両方確認。開始通知が通らない場合は試験経路不成立として早期終了。終了通知は取得できた場合のみ理由を表示し、通知なしを正常完了と解釈しない。

通知検証3件とローカルHTTP受信の実通信1件、計4件合格。最初のHTTP試験はsandboxのlisten禁止で停止したが、許可されたsandbox外実行で4件すべて合格した。runner構文検査も合格。Windows/Docker→ホスト通知経路と実90秒継続は再実行待ちで、正式47/70のまま。


## 76. M05ローカルEdgeRuntimeの90秒waitUntil完了（2026-09-28 JST）

ユーザー実行のWindows/Docker/ローカルSupabaseで、HTTP 202と同一runの開始callbackを受けた後、追加Function要求なしに15秒間隔のworker heartbeatを5回受信した。90,001ms時点のworker完了callbackをhost単調時計90,015msで観測し、worker/host両方の規定時間を満たした。Edge waitUntilの応答後90秒処理継続としてM05をpassedへ更新。試験用Functionと一時callback listenerはfinallyでcleanup。DB/Gemini/hosted Supabase/public URLの利用なし。正式合格は48/70（初回対象48/69、全体68.6%、初回対象69.6%）。[M05 machine evidence](test-evidence/v0.1.19/20260928-waituntil-observation.json)


## 77. D07 production handlerとPostgRESTの切断後参加（2026-09-28 JST）

ユーザー実行の全fixtureで、先行STARTへ202が返った後に開始側AbortSignalを切断し、production predictions handlerを通じて後続STARTが同じjobへ参加することを確認した。mock provider要求は1回、実local PostgREST上のbundleは1件で、worker完了後に後続側GETから同じ成功買い目・展開文を取得した。D02/G13/D16等の既存fixtureも全てPASSし、finally cleanup完了、Gemini/hosted Supabase未使用。[D07 handler/PostgREST evidence](test-evidence/v0.1.19/20260928-d07-postgrest-disconnect.json)

このrunnerはNode内でproduction handlerを呼び、`EdgeRuntime.waitUntil`を捕捉したpromiseで処理するため、実ブラウザーsocket切断やDeno EdgeRuntime内での後続GETをこのケース単独では示さない。M05の実EdgeRuntime 90秒継続は第76節で別に確認済み。実EdgeRuntimeの切断後・後続取得も一連で確認するため、waitUntil smokeへ後続GETを追加した。D07はその実測が終わるまで部分確認とし、正式合格48/70は維持する。


## 78. D07実Edge後続GETの初回観測不成立（2026-09-28 JST）

後続参加GETを追加したwaitUntil runnerの初回ユーザー実行は、開始callbackとHTTP 202を確認したが、約107秒の観測中heartbeat 0回・完了callbackなしで期限切れとなった。workerの停止/例外は確定できず、D07/M05の新たな実測は成功としない。runnerは202応答本文を読み終えた後にAbortControllerを発火しており、既に完了したPOSTへのabortはブラウザーを閉じる状況の再現として不適切で、Edge Runtimeへ影響した可能性がある。原因は未確定であり、製品動作のfailとは判定しない。[inconclusive run evidence](test-evidence/v0.1.19/20260928-d07-edge-first-attempt.json)

誤ったabort操作を除去した。開始POSTが202を返した後はクライアント要求を保持せず、Edge workerを追加要求なしに観測し、完了callback後に後続参加者として新しいGETを送り、markerと結果内容を照合する。M05の以前の成功証跡は有効だが、追加GETを含む変更runnerはまだ再実行待ち。D07は部分確認、正式合格48/70を維持する。


## 79. D07実Edge runnerの修正後もheartbeatなし（2026-09-28 JST）

abort操作を外したrunnerでも開始callbackと202応答後、約107秒間heartbeat 0回・完了callbackなしとなり、後続GETには到達しなかった。今回も実Edge継続は確認できず、D07は部分確認のまま。前回の人工的abortを原因とする仮説は支持されなかったが、Edge Runtime側のworker状態/例外は未特定で、製品の障害とは断定しない。既存のM05成功証跡（第76節）はその成功時のコード版に対する実測として保持する。

これ以上waitUntil試験を反復せず、`ai-edge-runtime-diagnostics.mjs`の読取専用出力（コンテナ状態と安全なログ分類・時刻のみ）を先に採取する。ログ本文・環境変数・credentialは採取/表示しない。診断後にworkerが開始していないか、例外/終了したか、観測経路だけが不調かを分け、原因に対応したrunner修正後に一度だけ再確認する。[second inconclusive run evidence](test-evidence/v0.1.19/20260928-d07-edge-second-attempt.json)


## 80. runtime分類に終了理由なし、worker開始callbackを追加（2026-09-28 JST）

ユーザーの読取専用診断は`CONFIG_PER_WORKER=true`、runtime running、OOMなし、exit code 0、過去30分のログ6行。完了/boot/shutdown/wall-clock/CPU/memory/exception/per-worker関連分類はいずれも0で、原因を特定できなかった。ログとcredentialの本文は表示していない。

次の一回ではwaitUntil task最初の命令からrun固有`worker_started` callbackを返すようにし、202後10秒以内に受信できない場合はそこで失敗として終了する。これで約2分待たずに、taskが開始されないケースと開始後のtimer/callback問題を分ける。開始markerを受信したときだけ従来どおり90秒観測し、完了後の後続GETを試す。


## 81. waitUntil開始marker後も最初のheartbeatなし（2026-09-28 JST）

worker開始callbackを加えたユーザー再試行は、HTTP 202後17msで開始markerを受信したが、その後約107秒間heartbeat 0回・完了callbackなしとなり、後続GETに未到達。task開始前ではなく、開始直後からtimer/heartbeatまでの間で停止/待機した可能性があるが、終了通知も分類ログもなく断定できない。D07は部分確認、正式合格48/70を維持。[worker-start observation](test-evidence/v0.1.19/20260928-d07-edge-worker-start.json)

次のrunnerはwaitUntil内で1秒timer後にcanary heartbeatを送り、5秒以内に来なければそこで停止してserve process出力/Dockerログの関連行をcredential/Bearer/JWT/API key等を伏せて安全に診断する。canaryが来た場合だけ従来の90秒試験を継続する。これにより次回は長時間待たずにtimer停止かcallback経路の問題かを切り分ける。


## 82. 1秒timer canaryも20秒以内に未着（2026-09-28 JST）

ユーザー実行は202応答後24msでworker開始callbackを受信したが、最初のheartbeatが20秒観測でも0回だった。runnerの安全診断行はEdge Runtime running状態とFunction route一覧のみで、例外/終了理由を含まなかった。後続GETは未到達。D07部分確認、正式合格48/70を維持。M05第76節の過去成功とはruntimeまたはコード条件が異なる可能性があり、原因は未確定。[edge worker-start observation](test-evidence/v0.1.19/20260928-d07-edge-worker-start.json)

heartbeatが一度も来ないため、90秒試験は繰り返さず、次は1秒timer後のcanaryと5秒fail-fastだけを行う形へ変更した。timeout時は現在のserve stdout/stderrからtoken類を伏せた関連行とDocker診断を提示する。canary到着までは後続GET/90秒継続を実行しない。


## 83. 1秒canary後の15秒timer待機で停止（2026-09-28 JST）

1秒timer canaryは約1,014msで届いた。続く15秒timerの最初のheartbeatは届かず、worker開始17ms後から約108秒観測して完了callbackなし、後続GETにも未到達となった。これは同じworker内で1秒timerが一度進み、より長い15秒の待機後に進捗しなかった結果である。原因は未特定、D07部分確認、合格48/70を維持。[timer canary evidence](test-evidence/v0.1.19/20260928-d07-edge-timer-canary.json)

次の診断では90秒条件を維持したままtimer/heartbeat間隔を1秒にして、短い継続yieldなら完了できるかを一度確認する。約1回/秒のローカルcallbackは試験用受信口のみであり、Gemini/DB/hosted URLは使用しない。これが通っても、長いidle待機が未検証である限界は記録する。


## 84. 1秒周期でも2回目heartbeatなし（2026-09-28 JST）

1秒周期版を実行したが、worker開始19ms後、timer canaryが1,021msに1回だけ届いた。後続の1秒timer/heartbeatは進まず、約108秒後も完了callbackなし・後続GET未到達。したがって15秒待機だけの問題とは確認できず、最初の非同期callback後にtaskが停止/中断した可能性が残る。原因は未確定、D07部分確認、正式合格48/70を維持。[1-second heartbeat evidence](test-evidence/v0.1.19/20260928-d07-edge-timer-canary-success.json)

次回はcanary後の2回目heartbeatだけを5秒待ち、来なければそこで停止して安全なrunner/Docker診断を出すよう短縮した。繰り返し90秒を待つ試験は、2回目heartbeatを確認するまで行わない。


## 85. 再帰setTimeoutでも2回目heartbeatなし（2026-09-28 JST）

1秒間隔の再帰setTimeout版をユーザーが再実行。waitUntil開始14ms後、timer canaryが1,025msに到着したが、5秒以内の2回目heartbeatは未着。安全診断はruntime running状態とroute一覧だけで、完了/終了/例外理由なし。後続GET未到達。この再試行はすぐ停止したため90秒は待っていない。callback単体テストはPowerShellコマンド列の順序が逆で、Edge smoke失敗後にthrowしたため実行されていない。D07部分確認、合格48/70を維持。

同じ1秒setTimeout待ちを続けてもheartbeatが再開しないため、次は単一のsetIntervalから周期通知する診断へ変更した。callback単体テストを先に実行する順序も1行のPowerShellコマンドで明確化する。


## 86. setInterval診断でも2回目heartbeatなし（2026-09-28 JST）

ユーザー再実行はHTTP 202、waitUntil開始marker（14ms）、timer canary（1,025ms）まで確認したが、その後5秒以内に2回目heartbeatは届かずrunnerがfail-fastした。EdgeRuntimeはrunning、診断出力はroute一覧のみで終了/例外理由なし。後続GETおよび90秒継続試験には到達していない。補助callback単体テストはPowerShellコマンド列の順序により今回も未実行（Edge smokeを先に起動し、失敗時throw後に単体テストを記述していた）。D07は部分確認、正式合格48/70を維持。原因は未特定。

次はWindows PowerShellでcallback単体テストを先に独立実行し、成功後にsetInterval版Edge smokeを実行する。試験対象はローカルEdgeRuntimeと一時callback受信口のみ。


## 87. PowerShellの複数行貼り付けで補助テスト未実行（2026-09-28 JST）

ユーザーの再試行ではEdge smoke/単体テストの出力がなく、表示された最初の実行文はEdge smoke後の終了コード判定で、前回の`$LASTEXITCODE=1`を参照してthrowした。したがって今回もcallback単体テストとEdge smokeは実行されていない。試験結果・正式合格数48/70に変更なし。複数行貼り付けの順序が環境で逆になる可能性があるため、次はcallback単体テストを一行の独立コマンドとして実行する。


## 88. callback補助テスト合格（2026-09-28 JST）

ユーザー実行の`ai-edge-callback.test.mjs`は5件すべてpass。run marker照合、worker開始/完了の順序、重複・不正値拒否、終了理由許可リスト、単調heartbeat、ローカルHTTP受信口の正常/不正要求を確認した。これは試験補助コードの単体確認で、D07の正式受入項目を合格にはしない。正式合格48/70を維持。次にsingle setInterval版の実EdgeRuntime smokeを単独実行する。


## 89. setInterval後続停止の切り分けログを追加（2026-09-28 JST）

ユーザー実行のsetInterval版はwaitUntil開始callbackと1回目heartbeatを受けたが、5秒以内に2回目がなく停止した。`waitUntil`内のタイマーが進まないのか、後続callbackのHTTP通知だけ失敗するのかは未確定。次回用の一時smoke Functionに、タイマー発火時の経過msとcallback受理後を示す汎用ログmarkerを追加し、timeout時の診断行に含める。callback本文、race data、credentialは記録しない。補助callback単体テスト5件は既に合格。次は修正版の実EdgeRuntime smokeを再実行する。D07部分確認、正式合格48/70を維持。


## 90. timer canary未着、登録位置の確認を追加（2026-09-28 JST）

修正版のユーザー実行ではHTTP 202と`worker_started`（18ms）を確認したが、最初の1秒timer heartbeatは5秒以内に届かなかった。今回の診断出力にはtimer tick markerがなく、runtimeはrunning、例外/終了理由も得られなかった。タイマー発火とcallback送信のどちらで止まったかは、登録位置のログがなかったため未確定。後続GETと90秒完了観測は実行していない。D07部分確認、正式合格48/70を維持。

次の一回では`worker_started`の後と`setInterval`登録直後にsanitized markerを追加し、waitUntil taskがtimer登録まで進んだかとtickが発火したかを分けて診断する。タイマー発火後のmarkerも引き続き採取する。


## 91. setInterval後続heartbeatなし、console marker未取得（2026-09-28 JST）

ユーザー実行はHTTP 202、worker-start callback（15ms）、最初のtimer heartbeat（1,022ms）を確認したが、5秒以内に2回目heartbeatは届かずfail-fastした。EdgeRuntimeはrunning/exit 0で、診断出力にはruntime route一覧だけがあり、追加したconsole markerは確認できなかった。従って前回の「最初のtimer未着」とは異なる進捗だが、2回目timer停止か後続callback不成立かをconsole出力から分離できなかった。後続GET・90秒完了は未実施。D07部分確認、正式合格48/70を維持。[latest timer evidence](test-evidence/v0.1.19/20260928-d07-edge-second-heartbeat-timeout.json)

次の補助runnerはtimer setup開始/登録を別callbackで通知し、各timer tickとheartbeat HTTP受理を個別に数えるよう変更した。heartbeatは直前のtick callbackが受理された後だけ受け付ける。callback helper単体テストを変更したため、修正版Edge smokeの前に単体テストを再実行する。


## 92. timer phase callback補助テスト合格（2026-09-28 JST）

更新後の`ai-edge-callback.test.mjs`は5件すべてpass。timer setup開始、登録、単調増加tick、tick受理後のheartbeatという新しいcallback状態遷移を含めて確認した。これは補助コードの単体試験でありD07の正式受入項目は部分確認のまま、正式合格48/70。次に修正版の実EdgeRuntime smokeを実行する。


## 93. timer登録・1回目tick後にinterval進捗が止まる（2026-09-28 JST）

ユーザー実行のinstrumented smokeはHTTP 202、worker start（18ms）、timer setup/register、timer tick 1回、heartbeat 1回（1,044ms）を直接callbackで確認した。その後5秒以内に2回目heartbeatはなく、runtimeはrunning/exit 0。従ってtimer登録と最初のtick、HTTP callbackは機能したが、以降の周期進捗が観測されなかった。`inFlight`中にintervalが再発火しても既存計測がreturn前に隠す可能性を除くため、次runではguardより前に独立した`timer_wakeup` callbackをfire-and-forgetで送る。これでtimer event loop自体が止まったか、先行非同期処理がinFlightのままかを分離する。D07部分確認、正式合格48/70を維持。[second heartbeat evidence](test-evidence/v0.1.19/20260928-d07-edge-second-heartbeat-timeout.json)

callback helperを更新したため単体試験を再実行してからEdge smokeを行う。


## 94. timer wakeup計測callback補助テスト合格（2026-09-28 JST）

更新後の`ai-edge-callback.test.mjs`は5件すべてpass。timer setup/register、timer wakeup、dispatch tick、heartbeat受理の状態遷移を含む補助コードの検証であり、正式D07受入項目は未完了。正式合格48/70を維持。次に実EdgeRuntime smokeを実行し、timer wakeup数とtick/heartbeat数を比較する。


## 95. timer wakeupも1回だけ観測（2026-09-28 JST）

ユーザー実行はworker start（57ms）、timer setup/register、timer wakeup 1回、dispatch tick 1回、heartbeat受理1回（1,064ms）を確認した。5秒以内に2回目heartbeatはなく、診断snapshotも`timerWakeups:1,timerTicks:1,heartbeats:1`。よって最初のtickが`inFlight`を理由に抑制されたのではなく、少なくともホスト側callback receiverには2回目のinterval wakeupが届かなかった。Edge runtimeはrunning/exit 0で、別の終了理由なし。90秒完了と後続GETは未実施。D07部分確認、正式合格48/70を維持。[timer wakeup evidence](test-evidence/v0.1.19/20260928-d07-edge-second-heartbeat-timeout.json)

単体試験は今回の計測変更を含む状態でpass済み。次に続ける際は、今回の追加計測を含むEdge smokeから再開する。


## 96. HTTP callbackを外したwaitUntil log観測runner

第95節ではtimer wakeup 1回・tick 1回・heartbeat 1回を受信後、2回目のwakeupが観測されなかった。複数callback通知がwaitUntil実行に影響する可能性を分離するため、次のrunnerではworker-start通知以外の背景中HTTP callbackを外し、15秒のawaited timer後にrun固有のheartbeat/completion markerをruntime logへ出す方式に変更した。host側はCLI stdoutとDocker logsから一致するmarkerだけを抽出し、追加Function要求なしで進捗を観測し、完了後に後続GETする。過去のM05成功時と同系統のlog観測を使う。変更runnerの実行結果は未確認。D07 partial、正式合格48/70を維持。


## 97. HTTP callbackを外しても30秒でruntime heartbeatなし（2026-09-28 JST）

ユーザー実行はHTTP 202とworker-start callback（37ms）を確認したが、15秒/30秒の進捗確認でruntime log heartbeatは0件。30秒でrunnerが安全に停止した。EdgeRuntimeはrunning/exit 0、取得できた診断行はroute一覧のみ。よって背景中callback通信だけを原因とする説明は支持されず、現行ローカルruntimeではwaitUntil task開始後の継続を確認できていない。D07は部分確認のまま、正式合格48/70を維持。

Supabase公式の[Background Tasks](https://supabase.com/docs/guides/functions/background-tasks)は、ローカルCLIでrequest完了後にinstanceが自動終了する制約を記載し、`edge_runtime.policy = "per_worker"`を推奨する。config.tomlは同設定で、スタック再起動後にも再試験済み。現時点で設定値以外のruntime原因は未特定。同一試験の反復は止め、次は独立項目M01の実Gemini 1リクエストを行う。


## 98. M01実行前にWSL起動timeout（2026-09-28 JST）

PowerShellからUbuntuでNodeと保存済みGemini keyを読み込んでM01 smokeを起動しようとしたが、`Wsl/Service/0x8007274c`でWSL起動がtimeoutし、Linuxコマンドへ到達しなかった。GEMINI_API_KEYの読込・表示、Gemini API通信は発生していない。M01は未実行で、正式合格48/70のまま。MicrosoftのWSL troubleshootingは、wsl.exeによる起動失敗ではWSL起動ログを採取して原因を調べるよう案内している ([Microsoft Learn](https://learn.microsoft.com/en-us/windows/wsl/troubleshooting))。まず読み取り専用の`wsl.exe -l -v`でdistro状態を確認する。


## 99. M01実Gemini呼出しがHTTP 503（2026-09-28 JST）

Ubuntuを`wsl.exe --shutdown`後に起動する確認は`EXIT=0`となり、M01 smokeを1回実行した。スクリプトはGemini要求の失敗を`provider_http_503`（HTTP 503）として報告し、成功応答・生成文は得られなかった。APIキーおよび応答本文はログへ出していない。実モデル利用が成功していないためM01は未合格で、正式合格48/70を維持する。503の原因（サービス一時障害、利用枠、その他）はこの応答だけでは特定できない。M02の実入力比較を開始せず、枠/サービス状態を確認できるまで追加の実モデル要求を控える。mock・ローカル試験など実Gemini要求を伴わない独立項目は続行する。[M01 evidence](test-evidence/v0.1.19/20260928-m01-gemini-http-503.json)


## 100. 予測単体/mock回帰217件合格（2026-09-28 JST）

Node.js v24.21.0で`race-prediction/*.test.mjs`と`tools/local-integration/ai-edge-callback.test.mjs`を実行し、217件すべてpass、失敗0。T09の実時間50秒/70秒待機を含み、全体所要は約123秒。Gemini APIは呼び出していない。サンドボックス内の初回実行ではローカルcallback receiverが`listen EPERM`になったため、許可されたテスト環境でローカル待受を行い再実行した。試験は単体/mock回帰であり、正式受入数48/70は変わらない。[unit evidence](test-evidence/v0.1.19/20260928-unit-regression-217.json)


## 101. Supabase PostgreSQL隔離DB smoke再合格（2026-09-28 JST）

`AI_DB_SMOKE_CONTAINER=supabase_db_project-012 bash tools/local-integration/ai-bundle-db-smoke.sh`を実行。Supabaseの既存PostgreSQLコンテナ内に作成した一時テストDBで、migration、入力フィルタ、権限、attempt fence、無効出力rollback、成功保存、owner期限切れ/stale worker、retryable/nonretryable失敗、20同時STARTがすべてpass。スクリプト終了時に一時DBを削除し、既存レースDBは使用していない。Gemini/Hosted Supabaseへの通信なし。正式受入数48/70に変更なし。[DB smoke evidence](test-evidence/v0.1.19/20260928-ai-bundle-db-smoke.json)


## 102. Supabase Edge Function型検査合格（2026-09-28 JST）

`tools/local-integration/ai-edge-typecheck.sh`を実行し、Deno `deno check --no-config supabase/functions/predictions/index.ts`がエラーなしで完了。コンテナはコードをread-only mountし、Gemini/Hosted Supabase要求やプロジェクトファイル変更なし。形式検査であり正式受入数48/70は変わらない。


## 103. Edge readiness/completion補助テスト8件合格（2026-09-28 JST）

`ai-edge-completion.test.mjs`と`ai-edge-readiness.test.mjs`をNode.js v24.21.0で個別に実行し、各4件、合計8件pass。503待機、認証失敗時の即時停止、completion marker照合、Docker log fallbackなど補助ロジックを確認。HTTP接続・Docker操作・Gemini通信なし。正式合格48/70に変更なし。


## 104. 実Edge HTTP smokeはreadiness timeout（2026-09-28 JST）

`ai-edge-local-smoke.mjs`は30秒以内にpredictions routeのreadiness（GETが401を返す状態）を確認できず失敗。readiness GET probeは行われたが、APIキー付きPOSTは送信されず、DB RPC/Gemini/Hosted projectも未使用。Edge Runtime containerは作成後runningだったが、read-only診断ではログ5行・boot/error marker 0件で原因を特定できなかった。試験前に存在しなかったEdge Runtime containerを停止して環境を戻した。HTTP smokeは未確認で正式合格48/70を維持する。[local Edge smoke evidence](test-evidence/v0.1.19/20260928-ai-edge-local-smoke-timeout.json)


## 105. Edge HTTP smokeのWSL host経路を切り分け（2026-09-28 JST）

上記timeoutの原因調査用に、試験補助runnerを更新した。readiness timeout時はresponse bodyを出さず、最後のHTTP状態/error codeと伏字済みCLI起動出力を示す。初回の起動出力でCLIが`SUPABASE_*`カスタムenv値を予約名として無視していたため、env-fileから該当2値を除き、CLIの標準`SUPABASE_ANON_KEY`注入と独自の`PREDICTION_MODE`だけを使用するよう修正。Node構文検査は合格。

修正版smokeもreadinessで`UND_ERR_SOCKET`となった。安全な起動出力は`predictions` route登録とEdge Runtime 1.74.3の起動案内まで確認。Docker内では`edge_runtime:8081/predictions`が401、Kong内の`127.0.0.1:8000/functions/v1/predictions`も401を返した。一方、WSL hostから公開port `127.0.0.1:54321`へのGETはconnection reset/status 000。したがってHTTP handler/内部gateway経路は応答し、WSLからDocker公開portまでの接続経路で失敗することを確認した。Windows hostから同portへ到達できるかは未確認であり、根本原因全体は未特定。未認証readiness GETだけを使用し、API-key付きPOST、DB RPC、Gemini、Hosted projectは未使用。Edge RuntimeはWindows側疎通確認のため起動状態を保持。正式合格48/70。[route boundary evidence](test-evidence/v0.1.19/20260928-edge-route-boundary.json)

追試としてWindows PowerShellの`curl.exe`でも`127.0.0.1:54321/functions/v1/predictions`を照会し、curl error 52 `Empty reply from server`、HTTP 000となった。WSLからは`/rest/v1/`と`/auth/v1/health`もHTTP 000。WSL hostでは複数gateway routeに接続できず、Windows側はFunctions routeのみ確認済み。公開port全体の問題が疑われるが、Windows側REST routeは未照会であり確定していない。


## 106. Windows REST routeもEmpty reply（2026-09-28 JST）

Windows PowerShellから認証なしGETで`/rest/v1/`を照会した結果もcurl error 52、HTTP 000。Functions route固有ではなく、Windowsから公開port `127.0.0.1:54321`を通る複数gateway routeでHTTP応答が返っていない。Kong containerはhealthyでport mapping `0.0.0.0:54321->8000/tcp`、Kong内部routeは401を返すため、次にWindows側port listenerのPID/processを確認する。API key、応答body、DB/Gemini requestは使用していない。正式合格48/70。[route boundary evidence](test-evidence/v0.1.19/20260928-edge-route-boundary.json)

PowerShellの`Get-NetTCPConnection`では`::1:54321`を`wslrelay`、`[::]:54321`を`com.docker.backend`がlisten。IPv4 loopbackがどちらのlistenerを経由するかはこの一覧だけでは確定できない。次はIPv6 loopbackでHTTP statusを比較する。


## 107. IPv6 loopbackでもgateway応答なし（2026-09-28 JST）

PowerShellから`http://[::1]:54321/rest/v1/`をcurlした結果もEmpty reply/HTTP 000。IPv4/IPv6両方で同様だが、curl proxy設定の影響をまだ排除していない。次に`--noproxy "*"`で同じREST routeを照会する。キーなしGETであり、DB/Gemini/Hosted projectは未使用。正式合格48/70。[route boundary evidence](test-evidence/v0.1.19/20260928-edge-route-boundary.json)

## 108. WSL直接経路と認証選択の確認、Edge HTTP再合格（2026-09-28 JST）

利用者のWindows loopbackはproxyを迂回してもEmpty reply/HTTP 000。一方、WindowsからWSL IP `172.23.70.147:54321/rest/v1/`はHTTP 200、CodexからWSL loopback/同IPのRESTもHTTP 200、Function未認証GETは401。Windows loopback経路の不調は残るが、試験可能な経路を確保した。

ローカルFunctionに同一の範囲外selectorを与えた認証比較でanon keyは401、local publishable keyは400。HTTP smokeのクライアントキーをpublishable優先へ戻し、CLIで無視される予約env値はenv-fileに加えず実行した。`ai-edge-local-smoke.mjs`は終了コード0、CORS、認証拒否、selector/job ID検証、X-Request-ID、runtimeログ相関がPASS。DB RPC/Gemini/ホスト環境は未使用。正式合格48/70は不変。

## 109. 自律試験用の環境一括診断（2026-09-28 JST）

基本/詳細設計へ一括診断を追加し、`ai-environment-snapshot.mjs`を実装。構文確認とLinux実行が終了コード0。Node 24.21.0、Git 2.53.0、Docker client/server 29.8.0、Supabase CLI 2.117.0、GitHub CLI 2.46.0を確認。GitHub認証とSupabase管理APIの既存認証は終了コード0。Windows EdgeとPlaywrightの実体あり。Vectorコンテナはrestartingであり、その他の対象コンテナはrunning。

別の無通信確認で保存済みGeminiファイルを試験プロセスへ読み込み、非空の`GEMINI_ENV=loaded`だけを確認。キー値/一部/長さは表示していない。これはGemini認証成功やモデル利用可能性の確認ではなく、M01の503未合格は維持。新しい秘密情報の送付は現時点では不要。情報採取だけでは継続稼働を保証できず、PCの稼働/スリープ回避とDocker起動を前提とする。[Linux環境証跡](test-evidence/v0.1.19/environment-snapshot-linux.json)

Windows版も利用者が実行完了し、共有JSONをCodexが読取。Node 24.19.0、PowerShell 5.1.19041、Git 2.55.0、Docker/Supabase CLI/Ubuntu起動を確認。Windowsの`gh`はPATHにないが、WSLで認証済みCLIを利用可能。Ubuntuの非対話login shellではNodeがPATHにないため、確認済み絶対パスまたはnvm初期化を使う。最新のWindows Node HTTP確認はlocalhost/WSL IPともREST 200、Function未認証401となり、採取時点ではlocalhost経路も復旧。過去のcurl失敗との原因差は未確定。アカウントのパスワード提供は不要。[Windows環境証跡](test-evidence/v0.1.19/environment-snapshot-win32.json)

続いてCodexから`ai-edge-postgrest-smoke.mjs`を自律実行し終了コード0。最新migration 20260927000000を確認し、実ローカルEdgeからinput/read RPCの双方へ到達。レースfixture投入/生成job/実Gemini/ホストDB利用なし。正式合格48/70は維持。D07の背景継続、M01のモデル503など既知の未合格項目は環境準備完了と分けて扱う。

## 110. I04 API内集計値を保持し過去履歴を追加検索しない（2026-09-28 JST）

成績書I04の従来文言は「過去DB結果を用意して生成」と読め、基本設計R05（過去日の履歴検索を追加しない）と利用者合意に反していたため修正。実ローカルPostgREST input fixtureを更新し、全国/当地勝率・モーター2連率を6艇分取得できることをassert。全国/当地集計とsource raw fieldsはAPI由来の現在レース事実として保持し、過去結果/既存予想はAI入力から除外する。実入力RPCは選択レースの当日published batchだけを参照し、選手履歴の過去日検索はない。fixtureはfinallyで削除し、runner終了コード0、Gemini/hosted未使用。I04 passedへ更新、正式合格49/70（初回対象49/69）。全API原始payloadとの項目完全一致は別途I01に残る。[I04 evidence](test-evidence/v0.1.19/20260928-i04-api-aggregates-no-history.json)

## 111. G12 対応Geminiモデルを設定で切替（2026-09-28 JST）

対応モデル`gemini-3.1-flash-lite`を設定で与え、同じGemini adapterから選択モデルのgenerateContent URLが構成され、通常の有効bundle応答として受理されることをNode内のmockで確認。未対応provider/推論設定は通信前に拒否。実UIはAPI model設定を選ばず共通bundle契約を消費し、本試験で画面/DB/生成の変更はない。Gemini生成API要求は0回で、対象モデルのlive利用可能性や文章品質は評価していない。G12 passed、正式合格50/70（初回対象50/69）。異なる外部providerの実装・交換は本設計の初期対象外。[G12 evidence](test-evidence/v0.1.19/20260928-g12-config-swap.json)

## 112. M01再試行もHTTP 503（2026-09-28 JST）

Gemini `models.list`を一度読み取り、HTTP 200と3.8 Flashの一覧存在・`generateContent`対応を確認した。続けてM01 live smokeを一度だけ再試行したところ、provider_http_503/HTTP 503となり、生成成功・出力検証には至らなかった。runnerは合成fixtureに対し1要求で停止し、生成文/APIキーを出力せず、DB/hosted Supabaseへ接続しない。モデルIDの登録とキーによる一覧読取は確認済みだが、generateContentの利用可否、レート枠/費用、503原因は不明。M01未合格、正式合格50/70のまま。同条件の追加実モデル呼出しは停止し、ローカルmock試験を継続する。[models.list evidence](test-evidence/v0.1.19/20260928-gemini-models-list.json) [M01 retry evidence](test-evidence/v0.1.19/20260928-m01-gemini-retry-503.json)

## 113. I01 公開API sampleからAI入力のfield保持を部分確認（2026-09-28 JST）

既存調査で記録済みの2026-01-01公開snapshotを1回読み、HTTP 200、1,407,507 bytes、保存済み調査hashとの一致を確認。156レースをnormalizer/records経由で処理し、6艇を含む1レースについて、全entry fieldのうち出走前の値がbuildAiInput後も変わらないことを比較。embedded preview/resultsはprogram factsから除去された。API payload本体・氏名等の値は保存/表示していない。現在のローカルDBにrace rowsは0で、実PostgREST試験は別途synthetic fixtureであるため、実source sampleを専用input RPCへ通した比較は未完了。I01は部分確認のまま、正式合格50/70。[I01 evidence](test-evidence/v0.1.19/20260928-i01-source-to-input-partial.json)

## 114. 生成/PostgREST統合fixtureをCodex実行環境から再確認（2026-09-28 JST）

`ai-generation-postgrest-fixture.mjs`を隔離ローカルSupabaseで実行し、終了コード0。保存失敗時の原子性、凍結設定、D16のsave/read race、D07の先行client切断後のmock worker継続、PostgREST経由のclaim/attempt/save/read/reuse、同時・時差START、期限、source/model変更、provider error、repair、attempt fenceなどrunnerが列挙する全シナリオがPASSした。finallyのcleanupもrunnerが確認。Gemini要求0回、Hosted Supabase要求0回。これは既存fixtureの再確認であり正式70ケースの合格数は50/70のまま。D07の切断試験はmock EdgeRuntimeのwaitUntilであり、実ローカルEdgeRuntimeの背景継続を確認したものではないためD07は部分確認を維持する。[統合fixture evidence](test-evidence/v0.1.19/20260928-generation-postgrest-fixture-self-run.json)

## 115. AI module unit/mock regression（2026-09-28 JST）

`node --test race-prediction/ai-*.test.mjs`をNode.js v24.21.0で実行し、9/9 passed、終了コード0。AI client、contract、diagnostics、Edge handler、generation、migration静的条件、P2 input/rate-limit等のmodule回帰。約123秒。Gemini/Hosted Supabase要求なし。補助unit/mock結果であり正式70ケースの合格数には加算しない。[AI module regression evidence](test-evidence/v0.1.19/20260928-ai-module-regression.json)

## 116. I01 公開APIの実データを専用RPCへ通して照合（2026-09-29 JST）

2026-01-01公開snapshot（既存確認hashと一致、156レース）から6艇分のデータがある1レースを選び、公開sampleを含む一時fixtureをローカルPostgresへ作成。`race_prediction_get_ai_input`経由で取得したprogram/previewとsource sampleを照合し、result field除去後の全事前データ値が一致することを確認。`buildAiInput` assembly後も事前項目が保持され、resultは含まれない。終了コード0、finally cleanup、生成job/Gemini/Hosted Supabase要求なし。I01をpassedへ更新し、正式合格51/70（初回公開対象51/69）。[I01実RPC証跡](test-evidence/v0.1.19/20260929-i01-source-postgrest.json)

## 117. I01後のinput RPC fixtureを再実行（2026-09-29 JST）

I01の実source fixture終了後、`ai-input-postgrest-fixture.mjs`を再実行し終了コード0。I02〜I04相当の結果/予想除外、presence variant、古い/不明fetchedAt保持が既存合成fixtureで再度PASSし、runnerがfinally cleanupを完了。これによりI01仮fixture cleanup後も同selectorを使う既存fixtureが正常に作成・読取できることを確認。生成job/Gemini/Hosted Supabase要求なし。正式合格数は変更なし。[再確認証跡](test-evidence/v0.1.19/20260929-post-source-input-rpc-recheck.json)

## 118. Release regressionの補助確認（2026-09-29 JST）

`node --test race-prediction/release-regression.test.mjs`を実行し1/1 passed、終了コード0。静的release回帰の補助証跡であり、v0.1.18への実DB/関数切り戻しを検証するM04には加算しない。Gemini/Hosted Supabase要求なし。[補助証跡](test-evidence/v0.1.19/20260929-release-regression.json)

## 119. U02/U03 roulette timingをfast/slow browser mockで測定（2026-09-29 JST）

Windows bundled Node.js/Playwright/Microsoft Edgeで新しいlocal-only runnerを実行し終了コード0。START直後の全slot回転、fast resultでの3秒最小待機、slow resultでの待機、3着→2着→1着の順を確認。次の停止開始は直前の停止完了から約6秒/9秒。最終停止後の買い目・展開文は同時に約500msで表示。fast/slowの初回停止は3,039ms/5,842ms。Supabase/Gemini/コメントの通信は遮断し、実API/実機スマートフォン条件には拡張しない。U02/U03 passedへ更新。正式合格53/70、初回公開対象53/69。[browser timing evidence](test-evidence/v0.1.19/20260929-ui-animation-timings.json)

## 120. U01待機表示・選択状態とU02/U03 timingを再確認（2026-09-29 JST）

Windows bundled Node.js/Playwright/Microsoft Edgeでlocal-only runnerを終了コード0で完了。初期リール表示1-2-3、会場だけではSTART無効、レース選択後に有効、START前の予想POST 0回、START直後の3リール回転を確認。fast/5.5秒遅延mockの最初の停止は3,041/5,821ms、次の停止間隔は前停止完了から6,018/9,016msおよび6,016/9,016ms、最終停止から買い目/展開表示は500/499ms。U01をpassedへ更新し、正式合格54/70、初回公開対象54/69、failed 1、未完了15。Gemini/Supabase/コメント通信は遮断。実API、スマートフォン、公開URLは対象外。[UI timing evidence](test-evidence/v0.1.19/20260929-ui-animation-timings.json)

## 121. U05画面の失敗経路をlocal mockで確認（2026-09-29 JST）

Windows Edge/Playwrightのlocal-only browser runnerを終了コード0で実行。成功bundle表示後、HTTP 503、通信切断、形式不正bundle、保存失敗相当のHTTP 500を順番に返し、各失敗で同じ再試行案内、以前の買い目/展開のクリア、待機1-2-3復帰、START再有効化を確認。320/390/430/1280pxの横幅確認も再実行した。保存前失敗のDB側はD02実PostgREST試験を参照する。U05の全受入条件を満たしたためpassedへ更新。画面応答はmockであり、本番API/端末試験ではない。[UI failure evidence](test-evidence/v0.1.19/20260929-ui-failure-paths.json)

## 122. ローカル実Edge/PostgRESTのread RPC再確認（2026-09-29 JST）

`ai-edge-postgrest-smoke.mjs`をWindows bundled Node.jsで終了コード0にて実行。既に適用済みのmigration `20260927000000`を読み取り確認し、実ローカルEdge Function/PostgREST経由のinput RPCとjob read RPCがそれぞれ期待する未存在データ応答を返すことを確認。ローカルloopbackの代わりに確認済みのRFC1918 WSL gatewayを使用できるようrunnerに接続先設定を追加し、loopback/RFC1918・port 54321以外を拒否するガードを実装。今回migration変更なし、fixture 0、generation job 0、Gemini/Hosted Supabase要求なし。一時function serving processとenv fileはrunnerがcleanup。[RPC evidence](test-evidence/v0.1.19/20260929-edge-postgrest-rpc-smoke.json)

## 123. U07長文展開文の表示条件を確認（2026-09-29 JST）

Windows Edge/Playwright local mockの再実行を終了コード0で完了。1000文字超の展開文全文、ブラウザー表示上の改行保持、`<img>`等をDOM要素にせずtextとして描画すること、予想画面に取得時刻やモデル情報を追加しないことを確認。外部API通信なし。U07をpassedへ更新。正式合格56/70、初回対象56/69、failed 1、未完了13。[U07 evidence](test-evidence/v0.1.19/20260929-ui-narrative-display.json)

## 124. U08同一画面のtimeout後新runと遅延旧応答（2026-09-29 JST）

画面遷移ケースに加え、同じ画面で初回START要求をtimeoutさせ、再有効化したSTARTから新結果を表示した後、旧要求の応答を遅れて解放するケースをWindows Edge/Playwrightで実行し終了コード0。新runの展開文・買い目・START状態が維持されることを確認。timeout用短縮は当該ページの最初の90秒timer 1件だけ250msにし、次の成功runの演出timerは通常のまま実行。全service通信mock、実API/DB/Geminiなし。U08をpassedへ更新。正式合格57/70、初回対象57/69、failed 1、未完了12。[U08 evidence](test-evidence/v0.1.19/20260929-ui-stale-response.json)

## 125. AI・コメント回帰を自律再実行（2026-09-29 JST）

Node.js v24.21.0で`node --test race-prediction/ai-*.test.mjs race-prediction/release-regression.test.mjs`を実行し10/10 passed、終了コード0（約123秒）。続けて`node --test supabase/functions/comments/*.test.mjs`を実行し、コメント関連の5テストファイルすべてが終了コード0で完了した。Gemini/Hosted Supabaseへの要求なし。補助回帰であり、正式70ケースの合格数には加算しない。U09のブラウザー実投稿・一覧・旧予想連携は未確認のため部分確認のまま。M04の実切り戻しも未確認。[rerun evidence](test-evidence/v0.1.19/20260929-autonomous-regression-rerun.json)

## 126. 隔離DBおよびU04/U06/U11のlocal-only再試験（2026-09-29 JST）

一時PostgreSQL containerで`ai-bundle-db-smoke.sh`を再実行し終了コード0。移行、入力/result filtering、RPC権限、制約、無効保存rollback、stale owner、retry状態、20同時STARTがPASSし、終了後に一時containerが残っていないことを確認した。既存Supabase DBは使用していない。

Windows同梱Node.js v24.19.0とEdge/PlaywrightでU04/U06を再実行。当初runnerの`fastForward`では5分更新要求のassertionに失敗し、画面コードを変えず、仮想周期timerを通常進行させる`page.clock.runFor`へrunnerを修正した後に両条件がPASS。締切後の選択解除、JST日付切替、定期取得、および実行中に締切を跨いだ際の閉鎖案内/再試行非表示を確認した。同じWindows Node環境でU11のlocal-only混在runnerも終了コード0となり、旧v0.1.18形式POSTの安全な拒否、新v0.1.19 mock契約での再読込を確認。いずれもGemini/Hosted Supabase/公開URLへの通信なし。補助証跡であり、実Edge/API条件が残るためU04/U06/U11の正式成績は部分確認のまま、正式受入57/70は変更なし。[follow-up evidence](test-evidence/v0.1.19/20260929-autonomous-ui-db-followup.json)

## 127. D07実EdgeRuntime切断後継続の再確認（2026-09-29 JST）

ローカルEdgeRuntimeに一時Functionを配信し、HTTP 202後に開始要求を閉じてwaitUntilの継続を観測した。worker開始callbackは27msで到着したが、30秒以内に最初の15秒heartbeat logが観測されず、runnerは終了コード1で停止。EdgeRuntime containerはrunningでroute一覧以外の終了・例外理由は得られず、後続GETには到達していない。runnerのfinally処理で一時Functionを削除し、race DB/Gemini/Hosted Supabaseは使用していない。M05の90秒成功は接続中の別条件なのでD07を合格にしない。同条件を繰り返さず、D07部分確認・正式合格57/70を維持する。[D07 recheck evidence](test-evidence/v0.1.19/20260929-d07-edge-disconnect-recheck.json)

## 128. M07 handler mode切替のPostgREST部分確認（2026-09-29 JST）

生成/PostgREST fixtureへmode-switchシナリオを追加し実行。実PostgREST上でAI jobを開始してprovider応答を保留した後、`PREDICTION_MODE=legacy`でhandler moduleを再読込。legacy handlerから開始済みjobのgenerating GETが成功し、旧形式POSTはlegacyのrace read経路へ進んでno-match応答となり、追加AI job/provider requestは作られないことを確認。元のAI jobはmode切替後にmock provider結果で成功保存され、legacy handlerでの完了GETと再読で同一bundle IDを返した。fixture runnerはfinally cleanupを報告し、Gemini/Hosted Supabase requestなし。これは実EdgeRuntimeの再デプロイを行わないhandler/PostgREST試験であるため、M07は部分確認に留め、v0.1.18復帰/実runtime切替を含む正式合格数57/70は変更しない。[M07 evidence](test-evidence/v0.1.19/20260929-m07-handler-mode-switch.json)

## 129. U09 comments handler integration stub試験（2026-09-29 JST）

既存の`supabase/functions/comments/index.integration.test.ts`をDenoコンテナで確認。通常の型検査付き起動は既存コードのTypeScript型エラー15件でtest実行前に停止した。`DENO_TESTING=1`、テスト専用ダミー環境変数、`--no-check`、Docker `--network none`で再実行し、handler統合stub 9件が全件passed。テスト入力に対するcomment handlerの投稿応答、レース/予想経路、fallback、rate limit、入力検証、PII/injection処理を確認し、実ネットワーク・Supabase DB・Geminiは使用していない。実DBへの投稿/一覧・実ブラウザーと旧予想連携は未確認のためU09は部分確認、正式受入数57/70は変更しない。[U09 evidence](test-evidence/v0.1.19/20260929-u09-deno-handler-integration.json)

## 130. v0.1.18タグの旧予想module回帰（2026-09-29 JST）

詳細設計で指定された切戻しタグ`v0.1.18`（commit `e6c263456a5999b10181fda4eae32e9f6bdfa578`）を一時`/tmp`へ展開し、`race-prediction/*.test.mjs`をNode.js v24.21.0で実行。6 test filesがすべてpassedし、temporary sourceはrunner終了時に削除された。Gemini/Hosted Supabase/ローカルDB/Edge Runtime/画面配信には接続していない。これは旧ソースのmodule回帰確認であり、追加migration後のDB互換、旧Function/frontendの切替、M04の切戻し合格には数えない。正式合格57/70は変更しない。[v0.1.18 evidence](test-evidence/v0.1.19/20260929-v018-tag-regression.json)

## 131. M04 v0.1.18 handlerのmigration後ローカルDB部分確認（2026-09-29 JST）

確認済み切戻しタグ`v0.1.18`を一時`/tmp`へ展開し、旧predictions handlerをテストshim経由で実行。既存の識別済みsynthetic race fixtureを現行migration適用済みローカルDBへ投入し、旧handlerから実PostgREST RPCを使って旧採点結果と旧snapshot/narrative attemptを作成した。Gemini APIは呼ばず、旧narrative応答だけをmock化した。最後にlegacy prediction lease・snapshot/narrative attempt・race fixtureをcleanupし、fixture件数0、AI job/bundle/attemptおよびcommentsの件数が試験前と一致することを確認。証跡に秘密値・選手fixture値・生応答は含めない。

この試験は旧handlerと追加migration後DBの局所互換を示すが、Supabase EdgeRuntimeへの旧Function再配信、v0.1.18 frontend公開、実効Secrets/設定の復元、旧クライアントからのブラウザー操作、既存コメント/ingestionデータ全体の比較は行っていない。したがってM04は部分確認のまま、正式受入数57/70は変更しない。[M04 evidence](test-evidence/v0.1.19/20260929-m04-v018-handler-postgrest.json)

## 132. U09 実ローカルPostgRESTコメント投稿/一覧（2026-09-29 JST）

一意なsynthetic bodyとrate keyを使い、現在のcomments handlerからローカルPostgRESTへコメントを1件投稿。Gemini応答はdirect planのmockで固定し、実DB上のrate-limit claimと`create_comment_with_reply` RPCを通過した。続けて同じhandlerのGET一覧から作成行・AIタカシ返信を確認。finallyで返却されたIDに一致するコメント行と使い捨てrate keyだけを削除し、両方0件であることを再照会した。Hosted Supabase・Gemini・ブラウザーは使用していない。U09の実ローカルDB部分を確認したが、ブラウザーUI表示と旧予想へのコメント連携は未確認のため部分確認を維持し、正式合格57/70は変更しない。[U09 evidence](test-evidence/v0.1.19/20260929-u09-deno-handler-integration.json)

## 133. ローカルEdge診断smoke再実行（2026-09-29 JST）

Windows PowerShellから`node tools/local-integration/ai-edge-local-smoke.mjs`を再実行し、request ID header、CORS exposure、sanitized runtime log correlation、Edge HTTP route、公開鍵拒否、selector検証、job ID検証がすべてPASS。前回の409は、readiness probeが認証なしGETの401だけで旧legacy handlerを起動済みと誤認した試験runnerの問題だった。runnerのreadiness条件をAI mode固有の範囲外selector POSTが400になることへ変更し、AI handler起動を確認してからHTTP検証するよう修正した。今回DB RPC/Gemini要求/DB変更/deployなし。補助試験のため正式受入数57/70は変更しない。[local Edge diagnostics evidence](test-evidence/v0.1.19/20260929-local-edge-diagnostics-rerun.json)

## 134. U09コメント画面のlocal browser mock確認（2026-09-29 JST）

新規`tools/local-integration/ai-comments-ui-smoke.cjs`をWindows同梱Node.js/Playwright/Edgeで実行し終了コード0。既存コメントとAI返信表示、コメント本文をHTMLとして実行しないこと、入力dialogのfocus、メールアドレスの送信前マスキング、投稿1回と返却コメント/AI返信表示、投稿後のform reset、予想会場/レース選択が利用可能なことを確認。初回はテストrunner側の文字数期待値が不正で失敗し、入力文字数を再計算して修正後に成功した。画面/APIコードは変更していない。全APIはmockされ、DB/Gemini/hosted/public URL/実機スマートフォンは不使用。U09のブラウザー表示を部分確認したが、実DB再読、旧予想との連携、実機条件は未確認のためU09部分確認・正式受入57/70を維持する。[U09 browser evidence](test-evidence/v0.1.19/20260929-u09-comments-ui-smoke.json)

## 135. M07実Edge legacy境界と公開優先方針（2026-09-29 JST）

利用者のPowerShell出力で `ai-edge-legacy-mode-smoke.mjs` の3行のPASS/INFOを受領。実ローカルEdge Runtimeのlegacy設定で、新AI形式POST拒否、不正な旧形式selector拒否、OPTIONS、公開鍵検証が成功した。DB RPC/Gemini/Hosted/deployは行っていない旨の出力あり。終了コードの提示はなく、進行中jobを伴う切替・旧版再配信は対象外なのでM07は部分確認を維持する。[証跡](test-evidence/v0.1.19/20260929-m07-edge-legacy-mode-boundary.json)

利用者指示により公開前必須と公開後の追加試験を分離した。[公開判定計画](AI-PREDICTION-REFRESH-RELEASE-GATES.md)を現在の実行優先順とする。70項目の期待結果・個別成績は維持し、延期をpassedとしない。正式成績は57 passed / 1 failed / 12未完了。公開必須条件は別集計で、現時点では未充足。

## 136. 公開URLの現行版ベースライン（PUB00、2026-09-29 JST）

GitHub Pagesの公開HTMLをGETしHTTP 200、9,602 byteを受信。ページ本文の版表示はv0.1.18が1箇所、v0.1.19が0箇所。公開HTML SHA-256は b54765e6d6f5d5962e5e78d49fd18c9746cf6dc835a232ddd0d1b541c333f537。静的ページ取得のみで投稿、Function、DB、Gemini要求なし。これは公開前の比較基準であり、v0.1.19の受入試験や本番backendの実効状態確認ではない。[PUB00 evidence](test-evidence/v0.1.19/20260929-pub00-current-site.json)

## 137. M01 利用枠確認後のGemini疎通（2026-09-29 JST）

利用者から受領したAI Studio表示はGemini 3.8 Flash: 1/5 RPM、478/250K TPM、2/20 RPD（7日表示）。この情報を受けて疎通runnerを1要求だけ実行し、HTTP 503/provider_http_503、終了コード1。生成文は返らず、キー・レスポンス本文を証跡へ含めない。画面値は実行前の観測で、API response本文は未収録。Gemini公式エラー説明は429をレート/日次制限、503をサービス一時的過負荷/停止として区別するが、この要求の503原因は未特定である [API errors](https://ai.google.dev/gemini-api/docs/api-errors)。今回の情報でも正常生成を確認できなかったためM01 failed、M02実生成比較は開始しない。原因/新しい有効枠状態が判明するまで同条件の追加生成要求を停止。[証跡](test-evidence/v0.1.19/20260929-m01-gemini-503-with-quota.json)

## 138. Node予想モジュール回帰再実行（2026-09-29 JST）

`race-prediction/*.test.mjs` と `tools/local-integration/ai-edge-callback.test.mjs` をLinux Node.js v24.21.0で実行し、217/217 passed、終了コード0、約123秒。最初のsandbox実行ではcallback receiverのloopback bindが`listen EPERM`となったため、同一コマンドをローカル通信許可付きで再実行し全件合格した。外部通信・Gemini・Hosted Supabase・永続データ変更なし。回帰確認であり正式受入数57/70は変更しない。[証跡](test-evidence/v0.1.19/20260929-node-regression-217.json)

## 139. M04 v0.1.18ソース復元リハーサル（2026-09-29 JST）

汚れた作業ツリーを変更せず、確認済みtag `v0.1.18`を新しい`/tmp`一時領域へ`git archive`で展開。index.htmlのv0.1.18表示、旧script.js、旧predictions handlerの存在を確認し、そのタグ内の`race-prediction/*.test.mjs`をNode.js v24.21.0で実行して6/6 passed、終了コード0。一時領域は実行後に削除した。公開環境、DB、Geminiは使用していない。

これはタグから旧版資材を取り出せることと旧予想module回帰を示す。旧handlerの現行migration後ローカルPostgREST動作は第131節、v0.1.19 legacy modeのEdge境界は第135節に記録済み。ただし実Edge Runtimeをv0.1.18 handlerへ差し替え、実効設定を戻し、旧画面から一連動作させる切り戻し確認ではない。M04/M07は部分確認のまま、正式合格数57/70は変更しない。[証跡](test-evidence/v0.1.19/20260929-m04-v018-source-rehearsal.json)

## 140. 切り戻し追加確認の終了（2026-09-29 JST）

ユーザー判断により、ここまでの部分確認をもって切り戻し確認を終了する。実Edge Runtime上のv0.1.18再配信、実効設定復元、旧画面からの一連動作は未確認のままとし、M04/M07をpassedへ変更しない。公開判定計画にもこの扱いを反映した。正式合格数57/70は変更しない。


## 2026-09-29 公開反映と直後の障害

利用者の明示指示により追加試験を広げず公開へ進んだ。2 migration適用、predictions配信、main a8e4f44のPages配信が成功し、HTML/script/clientの公開内容一致を確認。AIモードへ切替後、実当日レース（15場7R）のSTARTはHTTP 404。jobは作成されずGemini呼出しにも到達しなかった。本番の当日144レースでprogram_component_idとprogram_projection_idの参照先component.kindがresultであり、AI入力読込が拒否した。PREDICTION_MODEをlegacyへ戻し、v0.1.19画面で従来の予想経路を維持した。画面更新は完了、AI方式への公開切替は未完了。既存の試験未完了を合格へ変更しない。証跡: test-evidence/v0.1.19/20260929-publication.json。

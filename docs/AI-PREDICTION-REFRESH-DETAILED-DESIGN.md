# v0.1.19 AI予想刷新 詳細設計書

- 作成日: 2026-09-26 JST
- 文書版: 2.0（2026-09-30 公開確認とv0.1.19確定を記録）
- 製品版: v0.1.19。切り戻し先はv0.1.18。
- 関連: [基本設計書](AI-PREDICTION-REFRESH-BASIC-DESIGN.md)、[試験仕様兼試験成績書](AI-PREDICTION-REFRESH-TEST-REPORT.md)
- 前提: 利用者要件は基本設計R01〜R20。以下の内部構造はその実現方法であり、追加の予想誘導を行わない。

## 1. 現行調査で確認した変更理由

### 試験補助: `ai-environment-snapshot.mjs`（2026-09-28追加）

Windows Nodeから一回起動する。Linuxからも同じ補助を実行可能とする。固定コマンドだけを子プロセスとして呼び、各実行に15秒のtimeoutを設定する。stdout/stderrはメモリ内のみで受け、許可済みのversion、exit code、boolean、コンテナ名/状態、ローカルIP/HTTP statusへ変換する。WindowsではPowerShell版、54321のlistener process名、Ubuntuの実コマンド起動可否を追加する。WSL内のキー保存ファイルは読み取り可否/非空のbooleanのみ確認し、内容を読まない。Node/Git/Docker/GitHub CLI/Supabase CLIとブラウザー実体の存在を確認する。GitHub認証は`gh auth status --hostname github.com`の終了コードのみ採用する（アカウント/トークン出力は破棄）。

HTTP経路確認はキーなしのローカルREST/Function GETだけを使う。Windows loopbackとWSLのprivate IPv4を比較し、各要求5秒で打ち切る。追加のアカウント状態確認はSupabase CLIの`projects list --output json`の終了状態のみ採用し、一覧/名前/認証情報を記録しない。外部生成APIやホストDBのデータAPIは呼ばない。採取結果を`docs/test-evidence/v0.1.19/environment-snapshot-<platform>.json`へ保存する。同じOSでの再実行はこの診断ファイルだけ更新する。秘密ファイル、設定、DB、HISTORYは変更しない。検証では構文検査と実行結果の固定schema確認、Windows側の実行結果を用いる。環境診断は70項目の合格数へ加算しない。

| 現行箇所 | 確認した挙動 | 対応 |
|---|---|---|
| predictions/index.ts | calculatePredictionで採点後、snapshot保存、文章生成 | 新しい一括生成サービスへ分岐 |
| input-contract.mjs | 採点に使える項目だけで入力・ハッシュを作る | 別モジュールで全事前データを組み立てる |
| search_current_races | 整備・部品等のraw全体を返していない | 予想専用の読取RPCを追加 |
| normalize.mjs | program.rawに元のraceオブジェクトを保持。preview/resultも内包する | program.rawをそのままAIへ渡さず、結果と重複previewを除去 |
| client.mjs | 最大5要求・60秒。POSTを繰り返して確認 | 開始POSTとジョブ読取GETを分離し、絶対期限まで確認 |
| 既存lease | 45秒で再取得可能、既存snapshotは文章未成功でも存在 | 新経路は90秒のジョブと成功一括保存で管理 |
| comments/prediction-context.mjs | scoring.mjsを直接利用 | 旧共有モジュールは変更・削除しない |

調査時のローカルHEADは `5cc946f`。作業ツリーに既存変更が多数あるため、HEADだけを現在のファイル内容と同一視しない。この文書作成時に既存変更を上書き・破棄していない。親のAGENTS.mdを適用し、プロジェクト内のAGENTS.mdは現在削除状態だったため復元していない。

## 2. モジュール構成（実装予定）

| ファイル | 責務 |
|---|---|
| race-prediction/ai-input.mjs（新規） | 事前情報の分離、全項目保持、入力正規化・ハッシュ |
| race-prediction/ai-config.mjs（新規） | モデル・プロンプト・技術設定の検証と設定ハッシュ |
| race-prediction/ai-prompt.mjs（新規） | 必要最小限の依頼文、修正時の機械的エラー説明 |
| race-prediction/ai-output.mjs（新規） | JSON契約と決定的な形式検証 |
| race-prediction/providers/gemini.mjs（新規） | Gemini通信、タイムアウト、結果と使用量の抽出 |
| race-prediction/ai-generation.mjs（新規） | 最大2回の一括生成、期限管理、原子的な保存の呼出 |
| race-prediction/ai-contract.test.mjs、ai-generation.test.mjs、ai-client.test.mjs | 固定入力・模擬通信・模擬保存・時計による単体試験。再試行上限、期限、保存失敗、クライアントの結果採用を確認 |
| race-prediction/release-regression.test.mjs、prediction-static.test.mjs | 既存回帰試験をv0.1.19の製品版・90秒待機・共通失敗文言に合わせる。演出順序・部分表示禁止・締切の期待値は維持 |
| supabase/functions/predictions/index.ts | 既存開催情報GET維持、生成開始・ジョブ照会・公開応答 |
| race-prediction/client.mjs、script.js | ジョブ待機、90秒、部分結果を出さない描画 |
| index.htmlの製品版表示とscript参照、script.jsのmodule参照 | 製品版v0.1.19。同じ配信版識別によるキャッシュ混在防止。画面構造は変更しない |
| supabase/migrations/新規migration | 新規テーブル・専用RPC・権限 |
| tools/local-integration/新規試験用ファイル | 隔離DBでのfixture、整合・同時実行試験 |

外部提供元が増えた場合はproviderアダプターを追加する。同じAPI互換性・能力を持つ対応モデル間の変更は設定だけで行う。任意のモデル名への無検証交換は保証しない。旧narrative.mjs・scoring.mjs・input-contract.mjsの契約はコメント・切り戻し用に維持する。

## 3. 全データの取得と入力契約

### 3.1 専用読取

`public.race_data_get_ai_prediction_input(p_race_date date, p_stadium_code smallint, p_race_number smallint)` を追加し、service_roleのみ実行可能にする。

1回のSQL文のスナップショットで次を結合する。

`day_heads.current_batch_id → normalization_batches → snapshot_races → races → program/previewのrace_components`

- `day_heads`の採用済みヘッドを正とし、ready/published状態を許容する。最新attemptが失敗していても採用済みヘッドを使用する。
- 別batchの出走表と展示を混ぜない。過去の良い展示を現在の欠損へ補完しない。
- race_components.raw_jsonを利用し、出走表・展示の全API項目を保持する。既存検索RPCの列リストだけで全データ取得済みとしない。
- program側のrawはrace全体なので、トップレベルのpreviewを分離し、result・payouts・refunds等の結果領域を除外する。分離したpreviewは同じbatchのpreview componentと照合する。
- 既知の結果経路を入力から除外し、未知の新規キーはスキーマ差分として記録する。出走表/展示の新しい事実項目は保持する。未知キーが事後情報を含む可能性は検証課題とし、予想用の全データと結果排除をfixtureで確認する。
- 元のnull、空配列、キー欠落、F.03等の文字列を区別する。`_source`も保持し、変換値だけに縮約しない。

取得時刻は、採用ヘッドに対応するrun/observationのfetched_atを取得する。last_success_atやpublished_atは別名で管理し、取得時刻と偽って使わない。不明ならnullとする。取得時刻不明だけで拒否しない。

### 3.2 内部オブジェクト

```text
InputBundle
  identity: { raceDate, stadiumCode, raceNumber }
  facts:
    program: 対象レースの出走表raw（結果・previewを除いた全項目）
    preview: 対象レースの直前情報raw、またはnull
    presence: { program, preview }（missing/null/empty/value等）
  provenance:
    sourceCode, fetchedAt, lastConfirmedAt, batchId,
    programComponentId, previewComponentId, readAt
  closedAt: 検証済みJST締切をISO日時で保持
```

AIへはidentity、facts、sourceCode、fetchedAt、事実項目の単位・定義を渡す。batchId・componentId・Secret・採点・内部エラーは渡さない。欠損の評価方針は指示しない。

締切や時刻の正規化は制御用の値として分離し、元値を上書きしない。展示コースがない場合に艇番をコースとして埋めない。6艇の順序は艇番で安定化し、事実の優劣の順には並べない。

### 3.3 開始条件

- 日本時間の当日、場コード1〜24、レース番号1〜12。
- 出走表のracersに艇番1〜6のエントリーオブジェクトが重複なく存在する。キーとentry_numberが両方ある場合は一致が必要。艇番が識別できない・矛盾する・エントリー自体がnull等の破損は拒否する。選手名・登録番号は取得済みの値をそのまま渡し、それらの欠損だけで追加の生成停止条件にしない。欠けた選手情報は別DB検索や推測で補わない。
- 締切時刻が有効で、DBでジョブ取得が確定する時点にも締切前である。
- APIのrace identityと要求identityが一致する。
- 展示・モーター成績などは任意。古さ・欠損数・取得件数に基づく品質スコアや拒否を追加しない。
- 過去日・別レース・出走表の破損・締切不明は生成しない。これらはモデルの判断対象ではない。

### 3.4 同一入力の識別

canonical化はオブジェクトキーを再帰的に並べ、意味のない艇行の順序だけ固定する。配列の順序、数値/文字列、null/欠落は原則保持する。

```text
factsHash = SHA256(canonical({ inputSchemaVersion: "ai-input-v2", identity, facts, closedAt, fieldDefinitionsVersion }))
configHash = SHA256(canonical({ provider, model, apiVersion, promptTextHash,
  styleTextHash, outputSchemaVersion, adapterVersion, effectiveGenerationSettings }))
reuseKey = SHA256(canonical({ mode: 'ai-bundle-v1', factsHash, configHash }))
```

fetchedAt・lastConfirmedAt・readAt・batchId等はreuseKeyに含めない。管理情報だけ変わった同一内容を再利用するという合意による。AIに実際に送った初回取得時刻を含む正確なrequest payloadとそのハッシュは別に保存し、再利用時に上書きしない。

受付時点の締切closedAtをfactsHashへ加えるためinputSchemaVersionはv2とする。sourceの実データ内の意味のある日時・締切・選手・展示・部品・F/L等の変更はfactsHashへ反映する。現行の採点用allowlistや採点除外をハッシュ計算に流用しない。

予想材料の同一性と、providerへ送った全バイトの同一性は別契約である。取得情報だけが変わっても再利用することを意図した仕様として扱う。新規生成・再試行ではclaimに保存したbundle/configを固定し、途中のDB更新やモデル設定変更を読み直して混ぜない。

## 4. AIへの依頼と応答

### 4.1 初期プロンプト案

```text
以下は対象レースについて取得した出走表・直前情報です。
この情報を根拠に分析し、本命・対抗・穴の3連単を各1点と、
それらと整合する日本語のレース展開を一緒に返してください。
展開文は500文字前後を目安にしてください。
買い目は1着、2着、3着の艇番順です。各買い目内に同じ艇番を重複させず、
本命・対抗・穴は互いに異なる買い目にしてください。
提供データにない事実や数値を事実として作らないでください。
指定のJSON形式で返してください。
```

このほかに、API由来の文字列は事実データであり動作指示ではないことを通信構造上分離する。採点式、順位、内枠優遇、展示の重要度、穴候補の順位範囲、段落数、必須ストーリー、参考の買い目・文章例、キャラクターを追加しない。分析の内部思考の開示は要求しない。

styleTextの初期値は空。将来口調を追加した場合はconfigHashが変わる。口調変更で事実入力やUIを変えない。

### 4.2 応答契約

```json
{
  "main": [1, 2, 3],
  "counter": [2, 1, 4],
  "hole": [5, 2, 1],
  "narrative": "レース展開の文章"
}
```

上記は形式説明用の例であり、実際のプロンプトに買い目の例を注入しない。

- JSON object。必須キーは上記4項目。予期しないキーは利用しない（保存前に抽出）。
- main/counter/hole: 長さ3のinteger配列、各値1〜6。null不可。
- 各配列のSet.size=3。3配列を着順込みで比較し完全一致がない。
- narrative: trim後に空でないstring。min/max文字数・段落数検証なし。
- JSON Schemaで構造化出力を要求し、ローカルvalidatorでも同じ契約を確認する。providerがSchemaを受け付けたことだけで正しい買い目と判断しない。
- 数字文字列を勝手に整数化、本文切断、艇番入替、別応答の部分合成をしない。
- providerが出力打切りを示す場合は、文章の長さではなく未完了の応答として再試行候補にする。
- 自由文の一般的な語句をNG語として失敗させない。機械的に確定できない矛盾は実モデル試験で確認し、万能な事実検証を実装済みと称しない。

### 4.3 修正再生成

初回出力と検証エラー（例: counterの艇番重複）を同じ固定入力へ添え、4項目すべてを返すよう依頼する。正解の艇番をプログラムから指定しない。通信失敗の場合は出力がないため同じ依頼を再送する。修正履歴はこのジョブ内の初回に限り、他の予想・コメント履歴を渡さない。

## 5. 設定・provider

| 設定 | 初期設計値 | 性質 |
|---|---|---|
| PREDICTION_MODE | legacy / ai_bundle | 未設定時legacy。公開切替でai_bundleを指定 |
| RACE_AI_PROVIDER | gemini | 初回実装のprovider |
| RACE_AI_MODEL | gemini-3.5-flash-lite | 2026-09-29の10レース比較で採用。環境変数指定時はその値を優先 |
| RACE_AI_PROMPT_VERSION | ai-bundle-prompt-1 | 本文ハッシュも保存 |
| RACE_AI_STYLE_VERSION | none-1 | styleTextは空 |
| RACE_AI_TOTAL_TIMEOUT_MS | 90000 | 合意済み上限 |
| RACE_AI_MAX_ATTEMPTS | 2 | 合意済み上限 |
| RACE_AI_ATTEMPT_TIMEOUT_MS | 残時間−保存予約 | 初回も残時間を利用し、任意の42秒では打ち切らない |
| RACE_AI_SAVE_RESERVE_MS | 5000 | 保存・完了通知のための初期予約時間 |
| RACE_AI_MAX_OUTPUT_TOKENS | 8192 | 思考分を含むprovider仕様に照らし実測調整する技術上限 |
| RACE_AI_THINKING_LEVEL | medium | 対応が確認された設定のみ送信。比較試験で調整する初期案 |
| GEMINI_API_KEY | 既存サーバーSecret | 本文・ブラウザー・ログへ出さない |

temperature等は初期はprovider既定値。設定の実効値・既定値依存を保存する。能力表でモデルのSchema・thinking設定を確認し、未対応パラメーターをそのまま送らない。3.8 Flashのminimal thinkingは使用しない。

providerインターフェース: `generate({ model, input, prompt, schema, settings, signal })` → `{ parsedCandidate, completionState, usage, providerRequestId, modelVersion }` または安全な分類エラー。

初期は既存と同様にサーバーからGemini REST generateContent系を呼ぶ方針。API版とSchemaパラメーターは対応ドキュメント・隔離試験で固定する。モデルの列挙だけを見て接続成功としない。接続方式が変わる場合はadapterに閉じ込める。外部検索・Maps・コード実行等のtoolsは付けない。

## 6. DB構成（追加方式）

既存のrace_dataテーブルと旧prediction_snapshots/narrative_attemptsは保持し、新しいrace_prediction配下に次を追加する。全テーブルでanon/authenticatedへ直接権限を与えず、RLSとservice_role限定RPCで扱う。

### 6.1 ai_generation_keys

| 列 | 意味 |
|---|---|
| reuse_key text PK | 入力・設定の識別 |
| current_job_id uuid nullable | 現在の生成（失敗した過去ジョブは別に保持） |
| completed_prediction_id uuid nullable | 成功した一組 |

行ロックによる同時実行の仲裁点。利用者の追加要求でジョブ期限を更新しない。

### 6.2 ai_generation_jobs

| 列 | 意味 |
|---|---|
| id uuid PK / reuse_key text FK | ジョブ・共有キー |
| race_id uuid / identity jsonb | 対象レース |
| state text | generating / succeeded / failed / expired |
| owner_token uuid | 実行者だけが保持する書込み用フェンストークン |
| admitted_at / expires_at timestamptz | DB基準の開始受付時刻と上限（90秒以下） |
| closed_at_at_admission timestamptz | 開始判定に使用した締切 |
| facts_hash / config_hash text | 再利用識別 |
| input_bundle / config_snapshot jsonb | 固定した事実・取得情報・実効設定 |
| attempt_count smallint | 0〜2。各provider要求の開始前に原子的加算 |
| prediction_id uuid nullable | 成功した保存結果 |
| finished_at / error_code | 終了日時・安全な内部原因 |

当日・締切前・6艇の条件は取得時とclaimのトランザクション内で確認する。JSON内のブラウザー値を信用せず、サーバーで読み出したbundleのみ受け付ける。

### 6.3 ai_prediction_bundles

| 列 | 意味 |
|---|---|
| id uuid PK / reuse_key text UNIQUE | 一組の予想。成功値だけ保存 |
| job_id uuid UNIQUE / race_id uuid | 元ジョブと対象 |
| main / counter / hole smallint[] | 必須の3点 |
| narrative text | 空でない文章 |
| generated_at / saved_at timestamptz | 生成・保存日時 |
| provider / model / provider_model_version | モデル識別。返却されない実版はnull |
| input_bundle / config_snapshot jsonb | 予想の再確認に必要な入力・設定 |
| facts_hash / config_hash / request_hash | 材料・設定・実送信内容のハッシュ |
| winning_attempt smallint / usage jsonb nullable | 採用試行とproviderが返した使用量 |

DB CHECKでも配列長・整数範囲・各配列内重複・買い目相互重複・文章非空を検証する。列NOT NULL、配列要素のnull禁止、1次元・下限1・要素数3も明示し、SQLのCHECKがnullで通る抜け道を作らない。narrativeの文字数制約は設けない。全文をtrim以外で書換えない。

### 6.4 ai_generation_attempts

`(job_id, sequence)` UNIQUE。開始・終了・状態、model、prompt_hash、request_hash、実際のrequest payload（Secret除去済み）、応答候補、validation_codes、HTTP status、usage、duration_msを保持する。生の認証情報、HTTPヘッダー、providerのエラー全文、内部思考は保存しない。

使用量が返らない場合はnull。失敗時0と決めつけない。試行ログが保存できない場合も無制限にAIを再実行しない。成功結果と成功試行・ジョブ完了は同じ保存トランザクションで確定する。

### 6.5 DB整合・作成順

キー→ジョブ→bundle→attemptの順でテーブルを作成し、keyからjob/bundle、jobからbundleへの逆参照FKは全テーブル作成後に追加する。逆参照は生成中nullを許容する。id/reuse_keyの組を参照する複合制約またはRPC内の同等の検査で、他レース・他キーのbundleを関連付けない。削除はRESTRICTとし、今回データ削除や保存期限の自動掃除を実装しない。

ジョブはsucceededのときだけprediction_idとfinished_atを必須とし、failed/expiredに成功IDを付けない。attempt_countはNOT NULLかつ0〜2。試行sequenceは1〜2。試行状態はstarted/succeeded/failed/unknownとし、通信断で完了不明の場合を成功や課金0に見せない。

## 7. 原子的なRPCと状態遷移

public wrapperはservice_roleだけが実行できる。固定search_path、明示schema、公開入力の型・範囲確認を行う。

| RPC（新規名案） | 契約 |
|---|---|
| race_data_get_ai_prediction_input | 採用済みの同一batchから対象レースの事前rawを返す |
| race_data_claim_ai_prediction | キー行をINSERT ON CONFLICT→FOR UPDATE。成功再利用／進行中合流／新ジョブ作成を仲裁 |
| race_data_begin_ai_attempt | owner・generating・期限・回数を確認し試行開始を原子的記録 |
| race_data_finish_ai_attempt | 不成功試行の終了・不備・使用量を冪等に記録。ジョブ自体はgeneratingのままにできる |
| race_data_finish_ai_prediction | ownerとcurrent_job一致・期限内を再確認しbundle＋試行＋job＋keyを同一TXで保存 |
| race_data_fail_ai_prediction | 対象ownerのジョブだけをfailedへ。後続ジョブを変更しない |
| race_data_read_ai_job | 状態と公開結果だけを返す。期限切れgeneratingをexpiredへ確定可能。AI起動はしない |

状態遷移: `generating → succeeded / failed / expired`。失敗・期限切れのジョブをgeneratingへ戻さない。手動STARTは締切前に限り新job_idで開始できる。進行中または成功結果があれば再利用を優先する。

関連RPCのロック順はkey→job→attempt/bundleに統一する。begin_ai_attemptはsequenceによる冪等性を持ち、初めてstartedを作成した応答だけにsend_authorized=trueを返す。再呼出でattempt_countを二重加算したり、同じ試行を再送したりしない。RPC応答が失われて送信権を確認できない場合はproviderへ送らず終了する。

初回不成功はfinish_ai_attemptで記録してから次のsequenceを開始する。初回成功はfinish_ai_predictionで成功試行と一括commitする。不成功試行の記録に失敗した場合も、別ownerへ引継いで無制限に送信せずジョブを終了する。read_ai_jobの期限切れ更新はgeneratingの行だけを対象とし、ロック取得後にsucceededとなっていたら成功を返す。

期限切れ回収は状態読取／次のSTART時に行い、今回Schedulerを追加しない。期限切れの旧workerが遅れて返ってもowner_tokenとcurrent_job_id、expires_atの検証で保存を拒否する。

成功保存RPCは冪等にする。同じjob/ownerでcommit後に応答が失われた場合は、同じ保存済みIDを返せる。DB応答が曖昧なときは残り期限内に読取で確認し、保存未確認の結果を画面へ渡さない。保存エラーを理由に別の買い目をAIで作り直さない。

行ロック待機後の期限確認にはトランザクション開始時刻で固定されるnow()だけを使わず、clock_timestamp()を用いる。保存RPCのstatement/lock timeoutも残時間に制限する。実際のcommit・ネットワーク配送時刻をミリ秒単位で保証できるとはしない。クライアントは自身の期限後に届いた新しい結果を描画しない。

## 8. Edge Functionと共有処理

### 8.1 実行方式

新規ジョブを確保した1リクエストだけが `EdgeRuntime.waitUntil(runGeneration(job))` を登録し、即座に202を返す。後続は同じjob_idに合流する。ブラウザーの切断を共有workerのAbortSignalに結び付けない。

これは耐久キューではない。runtime終了・deploy中断等でworkerが消えた場合は、90秒の期限切れとして扱い、利用者の次のSTARTまで自動で新規生成しない。今回、追加の常駐workerやSchedulerは導入しない。

Supabaseのbackground tasksは実行時間・CPU・メモリ制約を受ける。契約環境で90秒内の処理が実行できることを試験で確認する。ローカルはbackground taskが応答直後に終了しないper_worker設定を試験用構成へ適用する。本番の設定変更は別途明示指示の対象。

### 8.2 新規開始と状態照会の分離

| HTTP | 用途 | 応答 |
|---|---|---|
| GET action=races | 現行の開催情報 | 現行契約維持 |
| POST action=generate, contractVersion=ai-bundle-v1, raceDate, stadiumCode, raceNumber | 新規START・保存結果再利用・生成中合流 | 200 success、202 generating、または失敗 |
| GET action=prediction-job, jobId | 開始済み処理の確認 | 200 success、202 generating、または失敗 |

新クライアントは明示actionとcontractVersionを送る。GET action=racesに追加のpredictionModeとpredictionContractVersionを返し、新クライアントは採用モードに合う経路を使う。旧クライアントは追加フィールドを無視できる。公開success/generating応答にもmode/contractVersionを付けて識別し、画面には表示しない。

旧クライアントは5回/60秒のPOST方式でjob GETに対応していないため、ai_bundleモードで旧selectorのみPOSTを新生成へ無条件に対応付けない。契約不一致はAI未呼出の409＋安全なfailed応答にする。legacyモードでは旧POST契約を維持する。新フロント配信を先に済ませ、切替前に再読込と版確認を行う。開いたままの旧画面は再読込が必要となる制約をリリース時に伝える。ai_bundleモードでは旧narrative-retryを新bundleへ作用させず拒否する。

```json
{"status":"generating","mode":"ai_bundle","contractVersion":"ai-bundle-v1","jobId":"uuid","retryAfterMs":2000,"remainingMs":58000}
```

```json
{"status":"success","mode":"ai_bundle","contractVersion":"ai-bundle-v1","main":[1,2,3],"counter":[2,1,4],"hole":[5,2,1],
 "narrative":"文章","narrativeStatus":"success","snapshotId":"uuid","reused":false}
```

```json
{"status":"failed","retryable":true}
```

- 上記成功JSONの値は形式例。state名の内部succeededと互換用HTTP status=successを混同しない。
- 正常な保存済み結果のみ200 success。新経路にpartial success、文章だけの成功/失敗は設けない。
- 失敗のHTTP分類は400/401/404/422/503等を内部で維持できるが、画面は基本設計の文言へ統一する。provider本文や例外文字列を返さない。
- 締切済みの新規POSTは保存結果があってもclosedとして扱い、新しいSTARTを受け付けない。
- 開始済みjobのGETは締切後も結果を返す。GETで別入力の取得や生成開始をしない。
- API公開キーは既存の公開クライアント確認を維持。job_idは推測困難なUUID。返却は公開してよい予想だけで、raw入力・owner_token・Secret・試行詳細は返さない。
- Cache-Control: no-store。再利用はブラウザーHTTPキャッシュでなくDBで管理する。
- retryableは即時の手動再試行案内に使う。締切・契約不一致・設定不備・確認済みの日次枠超過ではfalse。内部原因別の長い説明を画面へ出さない。締切前でも必ず再試行案内を出すわけではない。

## 9. 期限・再試行・上限

サーバー入口で単調増加時計を開始し、入力読取・claim前までの経過時間を残り90秒から差し引く。claim RPCは関数入口・行ロック取得前のclock_timestamp()をadmitted_atとして記録し、expires_atを「そのDB入口時刻＋サーバーから渡された残時間（0〜90000ms）」に固定する。ロック待機後にclock_timestamp()で失効を確認し、既に期限に達していればジョブを作らない。DBとEdgeの壁時計差を加算しない。claim/行ロックの待機時間もstatement timeoutと経過時間検査で残時間に算入し、待機後に90秒を再開しない。厳密なネットワーク往復誤差の保証はしない。

claim前に締切に達した場合は開始しない。ブラウザーもSTARTから単調増加時計で最大90秒で待機を終了する。生成workerはDBから確認した残時間と自身の受付時からの残時間の短い方を上限にする。初期通信遅延で各残時間が異なる場合も期限を延長しない。

時間配分の初期案:

1. 初回AIは `残時間−保存予約5秒` まで待つ。42秒等の任意の中間時刻で正常進行中の要求を打ち切らない。例えば50〜70秒で完了する初回も採用できる。
2. 出力不備、通信例外、要求タイムアウト、HTTP 408/429/5xx等は残時間内で1回だけ再試行候補。
3. 429はRetry-Afterを尊重。日次枠超過と判明した場合や待機が残時間に収まらない場合は再試行しない。401/403、未対応モデル/設定等も即時終了。
4. 再試行前の待機も90秒に含む。バックオフの初期値は1秒、provider指定があれば優先する。
5. 2回目AIは残時間から保存予約を引いた時間まで。残時間がなければ2回目を呼ばない。
6. どちらかで出力が有効ならAIを追加で呼ばず保存する。期限後の保存確定を拒否する。

「最大2回」は必ず2回の時間を確保する意味ではない。初回が生成用の残時間を使い切った場合は1回で終了する。初回の不備・通信失敗が早く判明したときに、残時間を使って2回目を行う。

90秒はAIを90秒動かした後に保存を無制限に待つ意味ではない。外部ネットワークへ送った要求の計算をprovider側で必ず止められる保証もないが、期限後の結果採用・三度目の送信・別モデルへの逃避は行わない。

クライアントは202のremainingMsと、自身の残時間の小さい方を期限として使う。以後、期限を延長する応答を採用しない。ポーリング間隔は原則2秒、残時間以下。現行maxRequests=5は新経路では廃止し、時間で打ち切る。GETの一時通信失敗は残時間内で次の読取を行えるが、POSTの自動再送で新規ジョブを増やさない。失敗状態を受け取ったら自動でSTARTし直さない。

remainingMsはサーバー側算出時点の値なので、受信時からそのまま加算しない。クライアントは要求送信時のperformance.now()＋remainingMsを保守的な期限候補とし、既存期限と短い方を保持する。状態GET自体にも残時間内のAbortSignalを付け、1本ずつ実行する。期限を迎えるまでsleepして最終確認が一度も送れないケースを避け、最後のGETを残時間内で送れるよう待機を短縮する。それでも通信が間に合わなければ成功保存済みでも画面では失敗し得ることを試験で区別する。

## 10. フロントエンド

- UI状態: idle / waiting / stopping / displayed / failed。内部状態名を画面に出さない。
- START時のrunIdと対象selectorを固定する。90秒待機中の開催情報更新・JST日付切替で実行対象を差し替えない。
- 200 successでも3買い目と文章の契約を確認する。旧形式・欠落した応答を部分表示しない。
- 結果が早く返ってもSTARTから3秒の初期待機を守る。全停止後0.5秒で対抗・穴・展開を同時表示。
- 「レース展開を生成できませんでした」だけを買い目と併記する旧partial経路は新モードでは使用しない。
- narrativeはtextContentで描画する。HTMLを解釈せず、AIの改行を保持する。固定の3段落へ変換しない。
- 取得時刻、モデル名、エラーコード等の技術情報は画面へ追加しない。
- 失敗時は待機表示へ戻す。有効な選択は維持し、締切なら既存の選択解除・START無効化を適用する。
- 表示済み結果は定期更新だけでは消さない。別選択・次のSTARTで消す。
- 離脱・タイムアウト後の遅延応答や旧finallyが、新しいrunIdの画面を変更しない。

## 11. ログと費用

request_id/job_id、工程、attempt、HTTP status、validation code、時間、model、ハッシュ、providerのusageを内部記録する。画面に技術情報を出さない。原始入力・成功候補・request payloadはアクセス制御された専用DBだけに置き、一般ログに全文を流さない。

実モデル試験は初期6ケース程度を各モデルで比較する案とし、最大2回ならモデルごと最大12要求となる。実施直前に当日の既存使用量と無料枠を確認して件数を調整する。コメントと同一プロジェクトの同一モデル枠を消費し得る。429を品質不良と混ぜない。有料課金・本番POST・Secrets変更はこの設計書作成には含めない。

当初は3.8 Flashを候補としていたが、複数回HTTP 503となったため、10レースの比較結果から3.5 Flash Liteを実装既定モデルに採用した。比較は直接生成と出力形式検証までで、保存・画面表示の受入試験は別途行う。各試験は既存使用量を含むRPM/TPM/RPDの枠を守って間隔を空ける。異なるレースの同時要求では各ジョブが最大2回でもプロジェクト全体でレート上限を超え得るため、429動作を別に検証する。

## 12. 変更対象・移行・切り戻し

1. 入力fixtureと新モジュール、追加migrationを作る。既存migrationを書き換えない。
2. 隔離DBで追加構造・権限・同時実行・一括保存を試験する。
3. predictionsにモード分岐と専用ジョブAPIを実装し、初期legacyのまま互換を確認する。
4. 新クライアントは開催情報のmode/contractから旧経路と新経路を選び、応答の版を検証する。ai_bundleではpartialを表示しない。index.htmlのscript URLと動的importのclient.mjs URLに同じ配信識別を付け、混在を確認する。実装時に製品版表示をv0.1.19へ更新する。
5. 実モデル・画面試験と成績書更新を行う。コメント公開時の扱いO01、公開/切り戻し手順O04を解消する。
6. 明示指示後、追加migration→対応backend→対応frontend→モード切替の順序をリリース手順として具体化する。
7. 通常の切り戻しは、まず新規ai_bundle開始を止めlegacyへ変更する。既に発行したjob GETはモードにかかわらず対応backendに残し、開始済みworkerの設定も固定する。最大90秒の完了/期限切れを確認後に旧backend/frontendへ戻す。緊急に旧backendへ戻す場合は進行中処理が失敗し得ることを記録する。既存・新規の予想データは削除しない。

### 12.4 ローカル実装・試験状況（1.4）

入力/設定/プロンプト/出力検証/Gemini adapter/共有生成制御、predictionsのai_bundle分岐、job開始・状態取得、追加migration、client polling、v0.1.19表示を作業ツリーへ追加した。`PREDICTION_MODE`未設定では従来のlegacy経路を使う。

試験成績書1.14時点で、Node単体・mock回帰150件、Deno型検査、ローカルSupabase PostgreSQLコンテナ内の一時DB migration/RPC権限/保存/競合スモーク、ローカルEdge HTTP境界、および既定ローカルDBへのmigration適用と実PostgREST経由のinput/read RPC smokeが合格した。一時DBは終了時に削除した。PostgREST試験はfixture/job/予想を作成せず、GeminiとホストSupabaseへ接続しない。

PostgREST input/read RPC以外のEdge `waitUntil`上でのSupabase RPCとAI生成を含む実統合、Gemini実キー、90秒実効時間、実ブラウザー、切り戻しは未確認。Gemini APIは呼び出していない。試験成績書の70受入ケースは受入条件全体の実施が未完了であり、公開可能とは判定しない。

旧scoring等の共用ファイル、comments、race-ingest、Scheduler、HISTORY.md、READMEの包括的整理、旧固定統計コード削除は本設計の変更対象外。必要な追加変更が判明したら設計書へ反映してから行う。

### 12.1 切り戻し基準と準備状況（2026-09-26 JST確認）

| 対象 | 基準・状況 | 準備判定 |
|---|---|---|
| ローカルannotated tag | v0.1.18、tag object `7c9df4ab77ca6f8b483e3ea39dc7691a1717e2c7` | 確認済み |
| タグの対象commit | `e6c263456a5999b10181fda4eae32e9f6bdfa578`。index.htmlの表示もv0.1.18 | 確認済み |
| GitHubタグ | origin上のtag object/peeled commitがローカルと一致 | 確認済み |
| GitHub main | `5cc946f937cff7ba34a498659436b4cecd3aa831`。タグからのcommit差分はHISTORY.mdのみ | 確認済み |
| ローカル実装ファイル | 改行末差分を除くタグとの差分はAGENTS.md削除と履歴を除きなし。新設計書・既存の未追跡ファイルは別 | 読取確認済み。作業変更を破棄しない |
| 旧フロント/予想ソース | v0.1.18にHTML/JS/CSS、predictions、race-prediction、migrationが保存されている | ソース復元可能 |
| 本番predictionsの稼働版・コード照合 | 現在の管理APIによる照合は未実施。過去のfunctions-after-predictions-deploy.jsonは古いため現状証明に使用しない | 要確認 |
| 旧モデル/指示文/環境設定 | 本番実効値、公開認証設定、Secretの復元可能性を未確認 | 要確認 |
| DBの適用済みmigration/追加変更の互換性 | 追加migrationはローカル作成済み。適用履歴の確認・migration適用・旧経路試験は未実施 | 要確認 |
| PREDICTION_MODE=legacy切替 | v0.1.19ローカルコードへ追加済み。未設定はlegacy。v0.1.18に新スイッチはない | WindowsローカルEdgeRuntimeでAI形式拒否/旧selector拒否を補助確認。進行jobと本番設定は未確認 |
| v0.1.19→v0.1.18切り戻し試験 | 試験成績書M04/M07 | 未実施 |

GitHub確認は`git ls-remote origin refs/tags/v0.1.18 'refs/tags/v0.1.18^{}' refs/heads/main`で実施。ローカルのタグ解決・git show・git diffでも照合した。これはソース復元点の検証であり、本番の再デプロイや切り戻し動作試験ではない。

### 12.2 本番変更前に保存・確認する情報

- predictionsのFunction識別子・稼働版・デプロイ時刻・公開認証設定・ソース/依存ファイルのハッシュを控え、タグのソースと対応を確認する。不一致なら実際の稼働コードを別の復元基準として保全してから進む。
- RACE_NARRATIVE_MODEL、指示文版、タイムアウト、出力設定等の非機密の実効値を控える。APIキー等は文書/一般ログ/Gitへ出さず、安全な既存管理場所で保持・再利用できることを確認する。
- 今回は旧RACE_NARRATIVE_*設定を新RACE_AI_*で上書きせず、旧モデルへ戻す設定を残す。共有GEMINI_API_KEYを刷新のためだけに交換しない。
- 本番migration適用履歴を控え、v0.1.19の追加構造を残してもv0.1.18の検索・採点・文章生成が動くことを隔離DBで確認する。古いdown.sqlやDB全体復元を通常の切り戻しとして使わない。
- comments/race-ingestの稼働版・Scheduler状態も比較用に控え、切り戻し後も変更されていないことを確認する。

### 12.3 実行時の切り戻し順序

通常経路は、新backendのlegacy切替→開始済みai jobの完了/失効確認→確認済みv0.1.18のpredictionsソース・依存ファイルと旧実効設定の再デプロイ→v0.1.18フロントの再公開→版・旧予想動作・コメント/収集の確認とする。フロントだけを戻して旧POSTを新ai_bundleへ送らない。

ソースは既存の汚れた作業ツリーへreset/checkoutして復元せず、タグを基にした別の作業場所で準備する。Gitの復元は通常の履歴を保つ復元commitと公開手順を用い、force push・タグ移動は行わない。具体的なcommit/push/DB変更/deploy/本番試験は実行前の明示指示が必要であり、この確認では行っていない。

切り戻し後も、新規予想テーブルの成功結果・試行記録と既存のコメント/レースデータを保持する。画面の製品版表示はv0.1.18へ戻す。緊急停止で進行中要求が失敗した場合は、公開影響と復旧結果を成績欄に記録する。

## 13. 技術確認事項

- raw_jsonが本番で必要範囲を保持していること、採用ヘッドからfetched_atを特定できることは未確認。
- 3.8 Flashの実キー利用と90秒内の応答、推論設定・出力トークンの初期値は実測前。
- background taskは終了保証のあるキューではない。終了時のexpired復帰を試験し、契約環境で不十分なら実装前に実行方式を改訂する。
- ローカル作業ツリーの既存変更が多い。実装開始時に対象差分を再確認し、今回以外の変更を取り込んだcommitにしない。
- 本番コメントの連携・旧予想との差異は公開前の判断事項。保留を「変更許可」と扱わない。

## 14. 参照資料

- [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash): モデル名、対応機能、thinking設定。
- [Gemini Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output): JSON Schemaを使う応答契約。
- [Supabase Background Tasks](https://supabase.com/docs/guides/functions/background-tasks): waitUntilによる応答後処理とローカルper_worker設定。
- [Supabase Limits](https://supabase.com/docs/guides/functions/limits): 実行環境の制約。プロジェクトの適用条件は実装時に確認する。

参照日: 2026-09-26。公開仕様の記載と、本プロジェクトの稼働確認を区別する。

## 14. ローカル試験反映（2026-09-26）

試験成績書1.5の失敗を受け、Retry-Afterの欠落・不正値を既定1秒として扱い、未完了応答の修正理由を必ず配列にする。workerとクライアントは応答後にも期限・中止を検査する。クライアントはAbortSignalを無視する通信でも待機を終了する。仕様の再試行上限・90秒期限は変更しない。単体・回帰134件は合格、DB・実モデル・実ブラウザー試験は未確認。


## 15. DB試験環境の接続状態（2026-09-26）

Node.js上のmigration静的契約試験6件を追加し、刷新・回帰を含む140件が合格した。Docker Desktop CLIはWSL integration無効を報告し、PostgreSQL/Supabase/Deno runtimeも見つからずmigrationを実行していない。静的照合はSQL構文・権限・原子性の実試験ではない。隔離DBが使える環境でD01〜D16/M05を実施する。詳細は試験成績書1.6。


## 16. 隔離DBスモーク試験の起動経路（2026-09-26）

ユーザーのUbuntuではDocker Serverへ接続可能。エージェント実行環境はDocker socketのアクセスを拒否するため、ユーザー端末から実行する使い捨てPostgreSQL試験スクリプトを用意した。対象・確認範囲と未検証項目は試験成績書1.7を参照。


## 17. 成功保存の試行記録要件（2026-09-26）

finish RPCはp_sequenceがjobの現在attempt_countと一致し、同sequenceのattempt行がstarted状態の場合に限り成功保存する。attempt開始前のfinish呼出を拒否するDBスモークassertionを追加した。ローカルNode試験は140件合格。PostgreSQLでの修正適用・確認は次回ユーザー実行待ち。


## 18. 修正版DBスモーク結果（2026-09-26）

ユーザーのUbuntuでPostgreSQL 17の隔離スモークを再実行し、attempt開始要件修正後もmigration、入力、権限、失敗時rollback、原子的成功保存、20同時claim（owner一つ・joiner十九）が通過した。成績書1.14に記録。広いSupabase環境・Edge・実モデル・本番切戻し試験は別途。


## 19. DB期限・再利用・冪等性確認の追加（2026-09-26）

隔離DB試験スクリプトに、保存の冪等再呼出、同一keyキャッシュ再利用、締切後の保存キャッシュ拒否、期限切れ後のjob置換、旧owner fencingを追加した。既に合格した20件同時claim試験と併せ再実行し、結果が出るまでは追加ケース未確認とする。


## 20. attempt上限と失敗状態のDB確認追加（2026-09-26）

2回目attemptだけを許し3回目を拒否すること、同sequence二重開始を拒否すること、retryable/nonretryableのfailed stateをread RPCが適切に返すことをスモークへ追加した。結果は成績書1.16。


## 21. Edge FunctionのDeno型検査手順（2026-09-26）

UbuntuのDockerから公式`denoland/deno:alpine`で`supabase/functions/predictions/index.ts`を型検査するスクリプトを用意。read-onlyのworkspace mount、コンテナnetwork none、repository/configの書換なし。これはcompile/typecheckのみでEdgeRuntime.waitUntilの実行試験を代替しない。試験成績書1.17参照。


## 22. Deno型検査修正（2026-09-26）

最初のDeno型検査で重複hash関数とcatch値の型エラーが判明。hash関数を一つへ統合し、Error判定後にlegacyエラーmessageを返す形に調整。Node試験140件は再合格。Denoの再検査結果は未取得。


## 23. 障害切り分けログの詳細（2026-09-27、実装前追記）

### 23.1 モジュールと接続

- `race-prediction/ai-diagnostics.mjs`: 共通logger、項目allowlist、通信例外分類、上限処理、読み取り用サニタイズ。
- `providers/gemini.mjs`: fetch/本文受信/JSON解析/HTTP/provider状態を区別してdiagnosticsを返す。既存のerrorCode/retryableの契約は維持。
- `ai-generation.mjs`: request/job/attemptの関連付け、開始・検証・保存・再試行/終了・例外を記録。予想結果・payloadはloggerへ渡さない。
- `supabase/functions/predictions/index.ts`: AI専用RPCの安全なエラー、入口/応答とGETの相関、waitUntilの例外を捕捉。legacy処理は維持する。
- `tools/local-integration/ai-diagnostics-summary.mjs`: docker logs等のstdinから指定schemaだけを抽出・再検証して出力。job/requestで絞り込み可能。秘密を含み得る原文ログは標準出力へ転送しない。

### 23.2 記録契約

schema=`race-ai-diagnostic-v1`。時刻はISO形式、eventはコードに定義した固定名のみ。requestId/jobId/runIdはUUIDのみ、caseIdは既存受入ID/L01〜L06形式のみ。runId/caseIdは試験環境変数RACE_AI_DIAGNOSTIC_RUN_ID/RACE_AI_DIAGNOSTIC_CASE_IDから取得し、利用者のrequestヘッダーを採用しない。

モデル名はgeminiの限定形式、factsHash/configHash/promptHash/requestHash/providerRequestIdHashは64桁hexのみ。HTTP状態は100〜599、試行1〜2、時間/usage値は有限の非負数で上限を設ける。未知の値・任意文字列は捨てる。validationCodesは実validatorの固定集合、errorName/transportCode/providerStatus/finishReasonも固定集合とする。

イベント: request.started/finished/failed、input.validated/rejected、job.claimed/read、rpc.started/finished/failed、worker.started/finished/failed、attempt.started/blocked、provider.finished、output.validated、save.started/finished、retry.scheduled/stopped、diagnostic.limit。工程名とRPC名も固定集合とする。

通信はdns/connection/tls/timeout/aborted/invalid_argument/permission/unknownへ分類し、メッセージ文字列の推測解析は行わない。安全なname/cause.codeだけを利用する。HTTPエラーではステータスとGoogleの固定status列挙値を保持し、error.message/detailsを捨てる。provider IDが取得できた場合は最大256文字をSHA-256化する。ハッシュ採取の失敗で生成を失敗にしない。

AI専用RPCの失敗はHTTP状態付きの固定エラーに変換する。bodyにはDB原文が含まれ得るため一般ログ/公開応答へ出さない。保存結果が不明なら予想状態を追加更新せず、既存の読取/期限切れ処理に委ねる。

### 23.3 出力の隔離と上限

loggerのchildは相関情報を追加し、64行の予算を親と共有する。63行の後は上限到達1行を出して抑止。JSONを2048byte以内に収め、可変診断項目が多い場合は基本情報だけへ縮退する。出力先の同期例外とPromise拒否を捕捉し、Promiseの完了を待たない。同期console呼出の時間を完全にゼロと保証するものではない。

workerのloggerはAPIキー等を出力しない項目設計を用いる。既知の秘密値は、誤ってモデル名/ID等の許可項目へ渡された場合にも除外する。ログの生データを公開するAPIは作らない。返却ヘッダーX-Request-IDはサーバー生成UUIDとし、CORS exposeに追加してネットワーク証跡と関連づける。

出力スイッチはRACE_AI_DIAGNOSTICS（offのみ無効）。stdout採取と既存DBログを保存先とし、新テーブル・新しい常駐サービスは作らない。summaryツールは1入力行16KiBまで受理し、超過行/JSON以外/別schemaを捨て、フィルタに一致する安全なレコードだけをストリーム出力する。

### 23.4 補助試験

L01 正常生成/保存とjob GETの相関。L02 DNS/接続/TLS/期限/中止の分類。L03 401/403/429/503・JSON不正・出力打切り・買い目不備。L04 各store/RPC例外とloggerの同期/非同期例外でも追加送信が起きないこと。L05 任意例外/本文/ヘッダー/候補/owner/ダミー秘密をログ・公開応答に出さないこと。L06 64行/2048byte、同時job、遅延拒否、上限/収集フィルタ。

Nodeのモック結合で故障を注入し、Deno型検査と既存回帰を行う。実ローカルEdgeの無効入力/ログ採取も確認する。実Gemini呼出やDB障害注入は不要な段階なので行わない。試験で実装の不足があればこの節を更新して修正する。

### 23.5 ローカル採取手順

`ai-edge-local-smoke.mjs`は無効入力3要求のX-Request-IDと応答状態を確認し、Docker標準出力・標準エラーの両方をメモリ内で受けてschema/IDで絞る。任意の原文は表示・保存せず、安全なレコードだけを`tools/audit-v019/diagnostics-20260927/local-edge.ndjson`へ保存する。ファイルは再実行で更新されるため、受入証跡として固定する場合は別run IDへ退避する。

Function readiness timeoutではHTTP bodyを記録せず、直近のHTTP statusまたは通信error codeと、既存の秘密値伏字を通したCLI起動出力だけを表示する。`supabase functions serve --env-file`が予約済みの`SUPABASE_*` env名を無視するため、試験env fileには`PREDICTION_MODE`等の独自名だけを指定し、Supabase標準keyはCLI注入値を用いる。クライアントにはローカル環境の`SUPABASE_INTERNAL_PUBLISHABLE_KEY`を優先し、存在しない旧環境でだけanon keyを使用する。2026-09-28の同一範囲外selectorへの認証比較でanonは401、publishableは400となったことを根拠とする。製品の認証判定は変更しない。

手動の採取はUbuntuで次のように行う（UUIDは調査対象のX-Request-IDへ置換）。`--job-id`も使用可能。絞り込みは完全一致。収集ツールの出力だけを証跡ファイルへ保存する。

```bash
docker logs --since 10m supabase_edge_runtime_project-012 2>&1 | node tools/local-integration/ai-diagnostics-summary.mjs --request-id <UUID>
```

認証情報が存在するプラットフォーム全体の原文ログは共有しない。収集ツールは自前の固定schemaのみを対象とし、他のアプリ/旧方式のログを汎用的に無害化するものではない。

診断ログ補強は2026-09-27に実装・確認完了。補助L01〜L06、関連回帰184件、Deno型検査、実ローカルEdge相関採取が合格。範囲と残事項は試験成績書第37節を参照。

2026-09-27 P2確認でclosedAtをfactsHashへ含める要件と再帰的な既知結果/予想項目の除外を明文化・修正。details/resultsは試験成績書第38節。

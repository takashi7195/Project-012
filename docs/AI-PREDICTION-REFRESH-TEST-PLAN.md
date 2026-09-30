# v0.1.19 AI予想刷新 試験計画書

> 2026-09-29 利用者指示により、公開前必須と公開後の追加確認を[公開判定計画](AI-PREDICTION-REFRESH-RELEASE-GATES.md)で区分する。従来の70項目の期待結果・合否は維持し、初回69項目すべての完了を公開の一律条件とする記述は同計画に置き換える。

> 2026-09-29 モデル選定追記：Gemini 3.5 Flash Liteを実装既定モデルに採用した。10レースの4モデル比較では同モデルが9/10成功、成功応答の平均は約3.9秒。これは直接生成・形式検証の補助試験であり、正式70ケースの合格数や生成からDB保存までの受入確認には加算しない。初期候補3.8 FlashのHTTP 503はそのモデルを対象とした過去の結果として保持する。詳細は試験成績書第142節。

- 文書版: 3.9
- 作成日: 2026-09-27 JST
- 対象: v0.1.19。切り戻し先: v0.1.18
- 状態: P1完了、P2のunit/mock・隔離DB確認完了。P3実DB結合とP5画面mockを部分実施。正式合格58/70、初回対象58/69。現行基準でfailed 0件、未完了12件。M01は採用したGemini 3.5 Flash Liteで通常/展示欠損の両入力をproduction handler→実PostgREST→実Gemini→DB保存/GETまで確認。初期候補3.8 FlashのHTTP 503は履歴として保持。I01の実公開sample→PostgREST→AI input照合、U01〜U03/U05/U07/U08の画面条件、I04の集計値保持、G12の設定変更も確認。D07はproduction handler＋実PostgRESTで部分確認済み。実Edge waitUntil切断継続は未確認で同条件の反復を停止。
- 基準: [基本設計書](AI-PREDICTION-REFRESH-BASIC-DESIGN.md)、[詳細設計書](AI-PREDICTION-REFRESH-DETAILED-DESIGN.md)、[試験仕様兼試験成績書](AI-PREDICTION-REFRESH-TEST-REPORT.md)
- 環境の実測: [環境確認結果](AI-PREDICTION-REFRESH-TEST-ENVIRONMENT.md)
- 個別の実施方法: [70項目の試験対応表](AI-PREDICTION-REFRESH-TEST-MATRIX.md)

## 1. 目的と今回の作業範囲

利用者不在時の実行順序・障害対応・停止条件は[自律試験の簡易設計・実行手順](AUTONOMOUS-TEST-RUNBOOK-v0.1.19.md)を参照する。合否条件は試験仕様兼成績書を正とし、この手順書によって変更しない。

試験条件、担当、実行順序、必要な環境、証跡、失敗時の対応を定め、利用者が70項目を手作業で実施する必要がない形にする。期待結果は既存の試験仕様を正とし、本書の作成によって仕様を緩和しない。

合意した順序は「本計画の作成 → 障害切り分け用ログの設計・補強とその確認 → 一つずつ本試験」である。計画作成時には計画書、対応表、環境確認結果、対象ソースの識別情報を作成した。環境点検にはツール起動、読み取りAPI、ローカルHTTP、一時ブラウザー、一時Denoコンテナを使用した。その段階では製品機能の変更、ログ機能実装、生成API呼び出し、DB構造変更、公開は実施していない。続くP1ではログを設計・実装し、補助試験を完了した（成績書第37節）。

## 2. 試験対象・識別

### 2.1 対象

- ルーレット側のAI入力、買い目3点と展開文の一括生成、形式検証、再試行、DB保存、再利用、同時実行、画面表示。
- Supabase Edgeの応答後処理、期限、権限、v0.1.18との互換と切り戻し。
- コメント・レース収集は変更影響の回帰確認。機能刷新は対象外。
- 的中率の改善証明、安価なモデルへの最適化は初回公開の対象外。M03のモデル比較は後続。

### 2.2 実装の固定方法

調査時のHEADは `5cc946f937cff7ba34a498659436b4cecd3aa831`。v0.1.19は未コミットのため、HEADだけでは試験対象を識別できない。

[ソース基準情報](test-evidence/v0.1.19/20260927-source-baseline.json)に、関連する製品・試験ファイル124個の生バイトSHA-256を記録した。未追跡のソースも含み、ドキュメントと秘密情報は含まない。これはバックアップや合格証明ではない。

- 集約SHA-256: `f414056295ac36ee3ecf81e79673ccb87d66ad1161786f22f8b2b4874959cba1`
- ログ補強・不具合修正後は新しいrun IDとソース識別を採取する。
- 改行コード差分と機能差分を区別し、既存の無関係な変更をまとめて修正・コミットしない。
- 各成績にソース識別、設定/指示文/入力ハッシュ、実行環境を対応づける。

## 3. 件数と進捗の扱い

| 区分 | ID | 件数 | 主な方式 |
|---|---|---:|---|
| 入力 | I01〜I11 | 11 | 自動: 単体＋実DB/RPC |
| 生成・出力・再利用識別 | G01〜G13 | 13 | 自動: 単体＋応答を制御した結合 |
| 時間・通信 | T01〜T11 | 11 | 自動: 仮想時刻＋実時間/実通信の必要箇所 |
| DB・共有・締切 | D01〜D16 | 16 | 自動: 実DB＋実Edge＋障害注入 |
| 画面・既存機能 | U01〜U11 | 11 | ブラウザー自動操作＋利用者の見た目/実機確認 |
| 実モデル・移行・運用 | M01〜M08 | 8 | 自動実行＋内容レビュー/運用判断 |
| 合計 | 上記すべて | 70 | 初回69、後続比較M03が1 |

現在の正式受入合格は58件。初回公開の合格確定率は58/69、全計画では58/70である。単体・部分結合の成功実績は既にあり、「これまで試験をしていない」という意味ではない。Windows EdgeのローカルmockでU01〜U08、U10、U11を部分確認し、U01〜U03/U05/U07/U08は画面条件を確認してpassへ更新した。U09はNode回帰の部分確認を記録した。詳細は成績書第40節、第64〜67節、第119〜124節を参照。

- 一つの受入項目に複数条件がある場合、全条件の証跡がそろって初めてpassedとする。
- 既存結果は対象ソースと条件が一致し、必要な証跡が残っていれば採用する。証拠の不足分だけ追加確認する。
- 成績は `未実施 / 実施中 / passed / failed / blocked / 後続` を区別する。部分確認は備考へ記す。
- 初回の合格確定率は `passed / 69`。実施率は全条件を実行したpassed＋failedを分子とし、blockedや部分確認を含めない。
- 環境点検とログ機能の補助試験は別集計。テストファイル数、個別アサーション数、70受入項目を合算しない。
- 成績書のケース行は、受入条件を満たす証跡が揃った場合に更新する。

## 4. 担当と利用者の作業

| 担当 | 作業 |
|---|---|
| Codex | 証跡照合、試験データ/不足する自動試験の準備、実行、原因調査、設計に沿う修正、再試験、成績記録 |
| 利用者 | 必要時のPC/Docker起動・認証操作、実機での表示確認、文章の好みの確認、コメント運用と公開判断 |
| 共同 | 自動検査で決められない文章の根拠・矛盾確認、未解決事項の公開影響判断 |

現在確認できたWSL経由の実行方法を使い、通常のコマンド実行とログ採取はCodexが担当する。利用者に環境確認コマンドを一つずつ転記してもらう方式を標準にしない。操作依頼が必要な場合は、その理由、実行場所（PowerShell/Ubuntu）、一つの操作、返してほしい結果を明示する。キー入力は利用者の端末だけで行う。

利用者の主な操作は、環境・認証の補助が必要なら15〜30分、PC/スマートフォンの実機確認30〜60分、内容・公開判断15〜30分を目安とする。合計1〜2時間を目標とし、70項目の手動実施を依頼する計画ではない。障害や認証状態によって増える可能性がある。

## 5. 使用環境

| 環境 | 用途 | 使用条件 |
|---|---|---|
| Linux Node.js / WSL Ubuntu | 単体・モック、各種runner | 非対話シェルでもLinux版Node/npmを明示する |
| ローカルSupabase + PostgreSQL | DB、実RPC、Edge、障害注入 | 試験データの識別・終了時の後片付け。既存DB全体をresetしない |
| Windows同梱Node + Playwright + Edge | ブラウザー自動操作・画像取得 | 起動済みの個人ブラウザーではなく、一時コンテキストを使用 |
| Gemini実API | M01/M02の実モデル確認 | 保存済みキーをプロセスに注入。現在の利用枠を確認する |
| Supabase検証プロジェクト | 契約環境での背景処理・公開前通し確認 | 本番との識別と使用先の確定が必要。管理認証成功だけで検証先と断定しない |
| 本番・公開URL | 公開反映後の最終確認 | 公開作業の指示後に実施 |

ローカルSupabaseは既に `project-012` が稼働している。今回確認したAPIは `http://127.0.0.1:54321`。本番接続情報を試験用fixtureの投入先として使わない。別のローカル一式が必要になった場合は、project ID・ポート・volumeを別にし、既存データを消さずに準備する。

詳細なバージョン、実行経路、不足事項は[環境確認結果](AI-PREDICTION-REFRESH-TEST-ENVIRONMENT.md)を正とする。新しいPC、Codespaces、Linux版Supabase CLI、Linux版ブラウザーの追加は現時点で必須ではない。

## 6. 実施順序と開始・終了条件

| 段階 | 作業 | 主な対象 | 終了条件 |
|---|---|---|---|
| P0 今回 | 計画・環境点検・ソース識別 | 環境チェック | 実行可能な経路と未解決事項を記録。本試験準備完了とは区別する |
| P1 完了 | 診断ログの詳細設計、補強、ログ確認 | L01〜L06（補助項目） | 第8節の追跡・秘匿・ログ障害の条件を満たす |
| P2 unit/mock・隔離DB | 既存証跡照合、入力/出力/期限の不足試験 | I/G/T中心、M08 | 完了。単体209件と隔離DBの結果は成績書第38節。実時間・実モデル条件はP3/P4に残る |
| P3 実施中 | 実DB・実Edge handler・模擬AIの結合試験 | IのDB条件、D01〜D16、Tの実通信、M05のローカル確認 | Edge handler＋実PostgRESTでclaim/attempt/save/read/reuse、重複出力後の修復、2回不正後の部分保存なしを確認。Deno EdgeRuntimeの`waitUntil`実動作、実Edge runtime障害注入/競合は未完了 |
| P4 一部実施 | 実Geminiの疎通と6種類の入力確認 | M01/M02 | M01は採用モデル3.5 Flash Liteで通常/展示欠損の両条件を実handlerからDB保存/GETまで確認しpassed。M02の6種類固定入力を使った根拠・整合性・多様性・使用量評価は未完了。10レース4モデル比較と内容確認は補助結果として第142節に記録 |
| P5 部分実施 | ローカル画面の自動試験と実機確認 | U01〜U11 | U01〜U08、U09、U10、U11の一部をmock browser/unitで確認。U01〜U03、U05、U07、U08の画面受入条件はpassed。実スマートフォン、実コメント投稿、実Edge/API/DB連携は未完了 |
| P6 | 本番相当環境の背景処理、互換/切り戻し、公開判定 | M04/M05/M06/M07 | 初回69件の成績と未決事項を確認し、復元手順が成立 |
| P7 | 公開反映後の確認 | PUB01〜PUB05（別集計） | 公開URLと本番の版・実動作・既存機能を確認 |

P3の開始前に、ログ収集コンテナの問題、背景処理設定、実DB用fixtureと障害注入方法を準備する。P5の開始前に画面用fixtureと自動操作runnerを用意する。計画書の存在やツール起動だけを準備完了としない。

通常は対応表のID順に一つずつ「実行→判定→必要なら修正→再試験→記録」する。同一fixtureで複数項目を確認できる場合は一回の実行結果を各IDへ対応づける。一つの障害が別項目を妨げる場合はblockedとし、依存しない項目は継続する。

概算は、計画/照合1〜2時間、ログ補強と確認1〜3時間、不足試験と結合/画面/修正4〜10時間、公開準備と最終確認1〜2時間。最初の目安は1〜3作業日で、Gemini枠・503・不具合による待ち時間を含まない。各段階終了時に実績で見積もり直す。

## 7. 自動試験・データ準備

### 7.1 既存資産

| 資産 | 確認範囲 | 補足 |
|---|---|---|
| `race-prediction/ai-contract.test.mjs` | 入力、形式、プロンプト、基本polling | DB経路の証明にはしない |
| `ai-generation.test.mjs` / `ai-client.test.mjs` | 最大回数、期限、遅延、中止、HTTP異常 | 仮想時刻/モック中心。実Edgeの生存時間とは別 |
| `ai-edge-handler.test.mjs` | handlerとRPC adapterの分岐 | 実PostgRESTを使う試験とは別 |
| `ai-migration-static.test.mjs` | SQL/権限定義の静的確認 | DB実動作の代用にしない |
| `tools/local-integration/ai-bundle-db-smoke.sh` | 隔離DB、保存、フェンス、20同時claim | AI実送信回数、全経路の競合まで合格とはしない |
| `ai-edge-local-smoke.mjs` | Edge HTTP境界 | 無効入力中心、AI未使用 |
| `ai-edge-postgrest-smoke.mjs` | ローカルmigrationとinput/read RPC | 未存在データの読取中心。生成・保存の通し試験ではない |
| `ai-input-postgrest-fixture.mjs` / `ai-input-edge-fixture.mjs` | 実PostgREST入力と締切済みfixtureの実Edge検証 | 合成fixture限定。生成claim/providerは行わない |
| `ai-generation-postgrest-fixture.mjs` | production handler、実PostgREST、模擬providerのclaim/save/read/reuse | handlerはNode内で動作し、`waitUntil`は捕捉promise。Deno EdgeRuntimeの実継続を証明しない |
| `ai-ui-animation-smoke.cjs` | Windows Playwright + Edge、ローカル静的UIとmock API | U01/U02/U03の待機表示/開始/時間要件。実スマートフォン、コメント/本番URL、全11項目の受入とは区別 |
| `ai-ui-browser-smoke.cjs` | Windows Playwright + Edge、ローカル静的UIとmock API | U01/U02/U03/U05/U07/U10の一部。実スマートフォン、コメント/本番URL、全11項目の受入とは区別 |
| `ai-edge-typecheck.sh` | Deno型確認 | 現行は可変タグをpullする。再現試験時は検証したdigestを使う手順へ整える |
| `ai-gemini-live-smoke.mjs` | 合成データで1回の実生成 | 日付固定・DB未使用。6種類/保存/画面試験は追加が必要 |

### 7.2 不足する試験用プログラム（今後作成・拡張）

環境一括診断は`ai-environment-snapshot.mjs`を使用する。Windowsで一度起動し、共有フォルダーの`docs/test-evidence/v0.1.19/environment-snapshot-win32.json`をCodexが読む。個別のコマンド転記や秘密情報のチャット送信を不要にする。既存キーは保存ファイルから試験プロセスだけへ読み込み、実モデル呼出しは従来の回数/枠制限を維持する。環境レポートは受入試験合格に加算しない。

1. ケースID、実行ID、対象環境、結果、ログ位置を一つにまとめる全ケース実行・集計runner。P3の主要なDB fixture runnerは部分整備済み。
2. 既存F01〜F12を実DBへ投入・識別・後片付けできるfixture管理。日付/締切はJSTの試験時刻に合わせる。
3. 本物のEdge/RPC/DBと、応答や遅延を制御できる試験専用AIをつなぐrunner。mockの切替が本番で有効にならない構造を設計する。
4. 保存前障害、保存後の応答消失、worker停止、ロック待ち、旧ownerの遅延、成功/期限切れ競合を制御する試験。
5. Playwrightで会場選択、START、表示、再試行、離脱、複数画面幅を操作するrunner。既存サイトのスクリプトを不用意に本番APIへ接続しないよう試験先を固定する。
6. 6種類の実モデル入力、検証、時間/試行/使用量/保存結果を記録するrunner。呼出上限を設ける。

fixtureは合成データを基本にし、開催日・実レース残数に依存させない。API項目の忠実性を確認する箇所は出典と採取時刻を記録したAPIサンプルを使う。予想時点より後の結果を混ぜない。

## 8. 障害切り分け用ログの要件

以下の要件を基本設計第17節・詳細設計第23節へ反映して実装済み。L01〜L06の結果は成績書第37節を参照。

### 8.1 記録と採取

- 実行ID/試験ID、request ID、job ID、試行番号、処理段階、開始/終了、所要時間、期限残量、結果。
- モデル、入力/設定/指示文の識別、HTTP状態、内部エラー分類、通信例外の安全な種別・cause code、再試行判断。
- Google側request IDは取得できた場合だけSHA-256を記録。不明は項目省略とし推測しない。
- DB入力取得、claim、AI送信、出力検証、保存、結果GET、画面反映を同じIDで追えるようにする。
- DB保存自体の失敗や背景処理の予期しない終了は、DBに依存しない構造化ログにも残す。記録失敗でAIの再送を増やさない。
- キー、Authorization、Cookie、接続文字列を出力しない。任意の例外文字列やprovider本文をそのまま一般ログへ流さず、許可した項目のみ記録する。
- 入力全文・生成候補は既存設計に従う専用DB/保護した証跡へ保存し、公開画面と通常ログへ出さない。
- 実行runnerはstdout/stderr、終了コード、DBの必要な状態、ブラウザーconsole/pageerror/通信失敗、画像/traceを採取する。traceにも秘密が入り得るため共有前に確認する。

### 8.2 ログ自体の確認（70件とは別）

| ID | 条件 | 合格条件 |
|---|---|---|
| L01 | 正常な生成と保存 | 同じIDで工程と結果を追跡できる |
| L02 | DNS/接続/TLS/中止・期限の模擬障害 | 安全な原因分類が残り、利用者向け表示は簡潔なまま |
| L03 | 401/403/429/503・不正JSON | HTTP状態/検証コード/再試行判断を区別できる |
| L04 | DB読取・保存・ログ書込の失敗 | 診断情報を採取でき、追加のAI送信や予想結果の改変を起こさない |
| L05 | ダミーキー/認証ヘッダーを含む例外 | stdout、ファイル、公開応答に秘密値が残らない |
| L06 | worker終了・同時要求・旧応答 | 実行を取り違えず、64行/2048byteの上限内で、非同期sinkを待たない |

ログ上限はrequest/worker共有64行、1行2048byte。非同期sinkの完了を待たず、失敗を予想へ伝播させない。保存期間は公開判断/不具合解消後30日を整理目安とし、自動削除は行わない。試験証跡は公開判定と不具合解消まで保持し、削除は対象を確認して行う。

## 9. 実モデルと外部障害

現在のキーは認証成功、設定モデルの一覧掲載とgenerateContent対応を確認済み。実生成は合計3要求がHTTP 503で失敗し、成功した生成結果は未確認。モデルが一覧にあることは生成品質/可用性の合格ではない。

- この計画作成中の生成要求は0回。モデル一覧の読み取り確認のみ実施。
- P4は疎通1回と6入力×最大2試行で、最初の実施枠は最大13生成要求を計画する。既存の合格結果を採用できれば重複を省く。
- 実施直前の残枠、同じプロジェクトの他用途、RPM/TPM/RPDを確認し、残枠が少なければ分割する。過去画面の5 RPM/20 RPDを現在の残枠と扱わない。
- 一つのjobの初回を含む最大2回・90秒の仕様を守る。試験runnerから無限に新jobを作らない。
- 503の継続、日次枠不足、認証異常時は実モデル群を止めて原因を記録し、モック/画面試験を進める。失敗要求の費用/使用量が不明なら0と断定しない。
- 不正な買い目・入力にない具体的事実・明白な文章矛盾を確認する。的中率の評価や、文章の好みと形式不備を混同しない。

## 10. 失敗時の進め方

1. 実行ID・時刻・対象コード・入力・環境と、期待結果/実際の差を保存する。
2. 環境（権限/DNS/ツール）、試験プログラム、製品コード、外部API、仕様のいずれかへ切り分ける。不明は不明とする。
3. 最小の再現条件で確認する。環境確認を繰り返す前に、過去の成功経路とログを照合する。
4. 修正は設計との整合を確認して行う。対象外の変更が必要なら設計へ反映する。
5. 失敗項目と影響する回帰項目を再試験する。新しい理由なしに全体試験を繰り返さない。
6. 原因・修正・再試験の成績と証跡を記録する。外部待ち/環境未整備を製品の合格にしない。

既知のレース収集acceptance-harnessの失敗は、権限拡張後も429確認がAbortへ変わった事象として残す。100msの試験側期限等も調べ、製品の不具合か試験の不安定性かをまだ断定しない。AI刷新とは分けて管理し、必要な回帰の扱いを決める。

## 11. 証跡と再開方法

各実行は `v019-YYYYMMDD-HHMMSS-<case>` を例とする一意なrun IDを持つ。再開時は最後の成績と未解決事項を読み、同じ手順を最初から繰り返さない。

- 一般公開できる要約は成績書へ保存。
- 生ログ/画面trace/入力出力はGit対象外の `tools/audit-v019/<run-id>/` を候補にし、書込前にignoreとアクセス権を確認する。
- 共通項目: case ID、runner、ソース識別、fixture、時刻、実行経路、終了コード、判定、ログ位置、修正との対応。
- 手動確認も端末/ブラウザー/画面幅、手順、観察結果を記録する。
- 今回の環境情報は機密を含まないallowlistの要約だけを[証跡JSON](test-evidence/v0.1.19/20260927-environment.json)に保存した。

## 12. 公開前後の条件

初回対象69件の結果と証跡、ログ機能の確認、コメント運用O01、公開/切り戻しO04、重大な未解決障害の扱いがそろったら公開判断へ進む。M03のモデル比較は後続のままでよい。

GitHubへの書込権限、公開先、Supabase本番/検証先の区別、現行Function/Secrets設定の復元可能性は公開前に確認する。管理APIへのログイン成功だけで本番変更の許可・切り戻しの成立と扱わない。

公開作業は指示後に、追加DB構造→対応backend→対応frontend→新方式切替の順序を具体化して行う。公開URLでの確認は次の別項目として記録し、事前受入の0/70等に混ぜない。

| ID | 公開後の確認 |
|---|---|
| PUB01 | URL到達、v0.1.19表示、配信ファイル/APIの版一致 |
| PUB02 | 締切前レースでStart→買い目・展開表示→DB保存 |
| PUB03 | 同じ入力の再利用と追加AI呼出の有無 |
| PUB04 | 簡潔な失敗表示/再試行案内、コメント・収集の影響確認（故障注入は検証環境） |
| PUB05 | PC/実機の最終表示、ログ確認、必要時の確認済み切り戻し |

本番に試験用レースやコメントを無断投入しない。公開後に対象レースがない場合はPUB02を保留と明記し、架空の結果で本番確認済みにしない。

## 13. 次に着手する作業

P1の診断ログ補強と補助確認、P2のunit/mock・隔離DB確認は完了。P3では実PostgRESTの合成入力fixture、締切済みfixtureを通したEdge入力検証、Edge handlerからの実claim/attempt/save/read/reuse、重複出力の修復、2回の不正出力後に部分保存しないこと、隔離DBスモークを確認した。provider応答は模擬で、Edge handlerはNode内で実行しており、Deno EdgeRuntimeの`waitUntil`実動作とは区別する。P5はPlaywright/Edgeのローカルmockで選択、表示、失敗クリア、締切/日付切替、遅延応答、版混在の部分確認、320/390/430/1280pxを確認した。コメント関連unit 52件も合格したが実投稿は未確認。ローカルDBに既存レースデータがないため実API資料との全項目比較は保留。`per_worker`はローカルconfigに設定したが、一時Function routeの404/503でM05の90秒`waitUntil`完了を確認できなかった。実Edge runtime障害注入/競合も未完了。P4のGemini live smokeは1要求がHTTP 503で失敗したため、利用枠を再確認するまで追加要求は行わない。実スマートフォンも未確認。Vector集約ログは未解決だが、直接docker logsの安全な採取は確認済み。

P1完了時のソース識別: [ログ補強後baseline](test-evidence/v0.1.19/20260927-diagnostics-source-baseline.json)。計画作成時のbaselineは履歴として維持する。


## 14. 最新進捗（2026-09-28 JST）

D12、I02/I03/I05/I06/I10/I11/G01〜G08/T01〜T07/T10を正式passedへ更新した。2026-09-28再確認では`race-prediction/*.test.mjs`とEdge callback unit/mockの合計217件がpass。これら以外の試験結果は個別の受入条件が揃うまでpartial/unverifiedのままとする。P3実入力・生成handler統合、P5画面mockの成功と、M05 EdgeRuntime 503・P4 Gemini 503・実機/公開環境未確認は[最新成績書](AI-PREDICTION-REFRESH-TEST-REPORT.md)を参照。


2026-09-28追記：I08は実ローカルPostgRESTで11分/31分/取得時刻不明を保持し、production handlerから11分前データをmock providerへ渡すところまで確認したためpassed。正式合格数は24/70。


2026-09-28追記：I07は過去日claim拒否、書式不正日付、締切欠落/不正/経過のclaim前拒否まで確認したためpassed。正式合格数は25/70。


2026-09-28追記：G09〜G11は同一入力の結果再利用、事実変更での再生成、モデル設定変更での再生成を実ローカルDB/mock providerで確認したためpassed。正式合格数は28/70。


2026-09-28追記：I09はday_heads切替中の120回同時RPC読取でbatch整合を確認しpassed。正式合格数は29/70。


2026-09-28追記：D04は20同時START→1 job/worker/provider要求、D13はlocal role/HTTP/public response境界を確認しpassed。正式合格数は31/70。


2026-09-28追記：D08/D09は期限切れ後GETの非再起動、手動STARTによる置換job、旧workerの保存拒否を確認しpassed。正式合格数は33/70。


2026-09-28追記：D01成功保存のjob/key/attempt/bundle整合、D06の進行中入力固定を実DB連携で確認しpassed。正式合格数は36/70。


2026-09-28追記：D03はDB commit後のfinish応答消失を模擬し、job GETによる一件保存結果の回復を確認してpassed。正式合格数36/70。


2026-09-28追記：T08は±24h時計ずれ、残時間延長拒否、GET一時障害復帰を単調時計で確認しpassed。正式合格数は37/70。


2026-09-28追記：D11/D14は締切後の新規開始拒否・既存job読取、取得時刻のみ更新した場合の同一bundle再利用/初回時刻保持を確認しpassed。正式合格数は39/70。


2026-09-28追記：D05は実時間+0/+30/+60秒の同時利用シナリオをローカル実DB/mock providerで完了しpassed。正式合格数は40/70。


2026-09-28追記：D10は締切前にadmitしたjobの初回不正応答と一回修正が締切後に完了し、開始時入力で保存されることを実DB連携で確認しpassed。正式合格数は41/70。


2026-09-28追記：T11は実DB claim lockの2秒停止/provider未呼出と、残2秒の最終GET・retryable=falseを確認しpassed。正式合格数は42/70。


2026-09-28追記：D15のbegin_ai_attempt応答消失を単体fixtureと実PostgREST fixtureで確認した。RPC commit後のHTTP応答消失時、provider未呼出・attempt unknown 1件・retryable job終了を検証し、D15をpassedへ更新。正式合格数は43/70（初回対象43/69）。


2026-09-28追記：D02は保存RPCがDBへ届く前に失敗した場合の非保存・provider再送なし・GET非成功を、G13は生成中の入力/model/style固定と変更後STARTの別jobを実PostgREST/mock providerで確認しpassed。正式合格数は45/70（初回対象45/69）。


2026-09-28追記：T09は実時間の50秒/70秒mock応答で各1回保存・90秒内完了を確認。D05の実PostgREST/handler 60秒完了と合わせてpassed。正式合格数は46/70（初回対象46/69）。


2026-09-28追記：D16の保存・期限切れGET競合を実PostgRESTで両順序とも確認。save先行なら成功維持、期限切れGET先行なら後続save拒否・bundleなしとなりpassed。正式合格数は47/70（初回対象47/69）。


2026-09-28追記：Windows EdgeのローカルmockでU04/U06の日付切替・締切後挙動、U08の遅延旧応答、U11の新旧画面/API契約混在を確認。前回のU01/U02/U03/U05/U07/U10も含めて画面11項目を部分確認したが、各受入条件を満たしていないため正式合格数は47/70のまま。D07/M05の一時Edge Function試験はWindowsパス不整合で起動前に停止したため、fileURLToPath()で修正した。再実行ではOPTIONS readinessが502、さらに503でPOST前に停止し、Nodeのlibuv assertionも出た。502/503双方で安全な診断を表示し、応答bodyを閉じ、Windows serve process treeを終了してcloseを待つ処理をrunnerへ追加した。実ランタイム確認は未実施で、次は修正版runnerを再実行する。


2026-09-28追記：Edgeコンテナcreated/未起動の段階で503を即時打切りしていたrunnerを修正。準備確認では404/502/503と接続失敗を最大60秒待機し、204確認後だけ90秒背景処理試験へ進む。補助処理の模擬試験4件合格、実環境での起動/背景継続は再実行待ち（成績書第70節）。


2026-09-28追記：起動待機修正後は一時Functionの202応答まで到達したが、Dockerログ取得で停止。完了証跡はCLI出力を優先し、Dockerログを失敗許容の補助手段へ変更。模擬試験4件合格。実環境での90秒継続確認は再実行待ち（成績書第71節）。


2026-09-28追記：M05は202応答後に120秒観測したが完了証跡未取得（Dockerログ取得自体は成功）。読取専用診断ではruntime running/OOMなし、理由となるログなし。Supabase公式手順は設定変更後の`supabase stop`→`supabase start`を要求するため通常stopで再起動したが、Studio health check unhealthyでstartが終了。データ削除optionは使用していない。CLIの`start -x studio`で他サービスを起動し、waitUntilを再試験する。公式docs: [config](https://supabase.com/docs/guides/local-development/cli/config)、[stop](https://supabase.com/docs/reference/cli/supabase-stop)、[start](https://supabase.com/docs/reference/cli/supabase-start)。正式合格47/70。


2026-09-28追加手順：Studio除外で再起動後も202応答後の完了ログなし。M05の一時Functionに開始/完了/終了理由のローカルHTTP通知を追加し、ホスト側一時受信口で実測する。Docker Desktop内からhost.docker.internalのランダムportへrun固有識別子を使って通知し、開始通知の受信を確認してから90秒処理を開始する。完了通知のFunction側時間とホスト側単調時計を照合する。背景処理中のFunctionへの追加要求は行わない。通知不能時は試験開始不可として区別し、cleanupで受信口と一時Functionを破棄する。製品API・DB・Geminiは対象外。


2026-09-28追記：完了markerが取得できなかったM05一時Functionに15秒heartbeatと終了通知を追加し、背景処理の生存期間を直接計測する。ローカル通知handlerは5件合格。次に同じ一時Functionを実行してheartbeat/完了/終了理由を受け取る。M05は実Edge結果が出るまでpartial。


2026-09-28追記：M05はローカルSupabase EdgeRuntimeで202応答後のworker継続を5回のheartbeatで観測し、90,001msに完了したことをhost単調時計90,015msで確認しpassed。正式合格48/70（初回対象48/69）。


2026-09-28追記：D07 handler/PostgREST fixtureで開始側切断後の同一job参加、mock provider 1回、bundle 1件、後続GETの同一成功を確認。全fixtureも最後までPASSしたが、Node内のwaitUntil捕捉のためD07は部分確認。実Edge後続GET試験の初回はheartbeat 0回で完了せず。202応答を消費した後にAbortSignalを発火する試験操作を取り除き、追加要求なしの継続観測後に後続GETするよう修正。D07実Edge確認は再実行待ち。正式合格数48/70を維持（成績書第77〜78節）。


2026-09-28追記：AbortSignalを除いたD07実Edge再試行も202応答後107秒間heartbeat 0回で完了せず。read-only診断はruntime running/OOMなし/exit 0で原因未特定。waitUntil内のworker_started callbackは17msで届いたが、その後のheartbeat 0回。最初のheartbeatを20秒待って失敗時にsanitized serve/Docker診断を表示し、成功時のみ90秒観測するようrunnerを更新した（成績書第79〜81節）。正式合格48/70を維持。


2026-09-28追記：worker_startedは24msで到着したが、初回heartbeatは20秒以内に0回。sanitized logはedge route一覧だけで、例外/終了理由なし。90秒を再実行せず、1秒timer canaryを5秒だけ観測するfail-fastへ変更した（成績書第82節）。


2026-09-28追記：1秒timer canaryは1,021msで1度到着したが、1秒周期でも後続heartbeatがなく約108秒で完了未確認。2回目heartbeatを5秒で判定し、通過するまで90秒待機を行わないrunnerへ変更した（成績書第83〜84節）。


2026-09-28追記：single setInterval最新試行ではtimer wakeup/tick/heartbeatが各1回のみ。その後のHTTP callbackを外したlog観測runnerでもworker start後30秒までheartbeat log 0件。`per_worker`適用後の同じruntime確認は反復せず、D07はpartialのまま管理。次はM01ライブGemini試験を1リクエスト実施する（成績書第95〜97節）。正式合格48/70。


2026-09-28追記：`wsl.exe --shutdown`後にUbuntuの`/bin/true`がEXIT=0で成功。M01 live smokeを1回実行したところprovider_http_503/HTTP 503。実生成成功は未確認、正式合格48/70のまま。503の理由は未特定なのでM02など追加実モデル要求は保留し、実モデルを使わない試験を続ける（成績書第98〜99節）。


2026-09-28追記：`race-prediction/*.test.mjs`と`tools/local-integration/ai-edge-callback.test.mjs`をNode.js v24.21.0で再実行し217/217 passed。T09の実時間50秒・70秒待機を含む約123秒の実行。Gemini API通信なし。正式合格48/70は維持（成績書第100節）。


2026-09-28追記：既存Supabase PostgreSQL container内の一時DBを用いて`ai-bundle-db-smoke.sh`を再実行し、migration/DB制約/権限/保存/失敗状態/20同時claimすべてPASS。テストDBはcleanupで削除。既存レースDB・Hosted Supabase・Geminiは未使用（成績書第101節）。


2026-09-28追記：`ai-edge-typecheck.sh`を再実行しDeno type check成功。読み取り専用bind mount、Gemini/Hosted Supabase要求なし。正式受入48/70は不変（成績書第102節）。


2026-09-28追記：Edge completion/readiness単体テストは4件ずつ、計8件PASS。実Edge HTTP smokeはreadiness GETが30秒で成立せず、POST前に停止。DB/Gemini/Hosted未使用。起動したruntime containerは診断後に停止。正式合格48/70を維持（成績書第103〜104節）。


2026-09-28追記：Windows→WSL IPのREST 200を利用者が確認し、続くWindows/Linux一括診断ではlocalhost/WSL IPともREST 200、Function未認証401を確認。ローカルEdge HTTP smokeはpublishable key選択修正後にログ相関まで合格、実Edge→PostgREST input/read RPC smokeも終了コード0。I04はR05に合わせ過去履歴を追加検索/送信せずAPI集計値の既知数値をreal PostgREST fixtureで6艇照合しpassed。G12はsupported Gemini modelの設定交換とunsupported設定拒否をmock確認しpassed。I01は実公開sample 156 raceをnormalizer/records/AI inputへ通したentry field比較が部分確認。source sampleを専用RPCへ流す照合は残る。GitHub/Supabase認証とGemini key読込を確認。Vector再起動、D07背景継続、M01の503は未解決。正式合格50/70（成績書第108〜113節）。

2026-09-28追記：Codex実行環境から`ai-generation-postgrest-fixture.mjs`を再実行し、保存/再利用/障害系/同時START等の全シナリオPASS、終了コード0、fixture cleanupを確認。Gemini/Hosted Supabase要求なし。D07はmock EdgeRuntime切断後継続であり実runtime継続条件は未確認。正式合格50/70を維持（成績書第114節）。

2026-09-28追記：`node --test race-prediction/ai-*.test.mjs`をCodexから実行し9/9 passed、終了コード0。Gemini/Hosted Supabase要求なし。これはmodule回帰であり70受入ケース数に加算しない（成績書第115節）。

2026-09-29追記：公開snapshotの6艇1レースを一時ローカルfixtureとして実際の`race_prediction_get_ai_input` RPCへ通し、AI input組立後の全事前fieldを照合。result除外・preview一致・fixture cleanupを確認、終了コード0。I01をpassedに変更（成績書第116節）。

2026-09-29追記：Playwright/EdgeでU01の待機表示1-2-3、選択とSTART状態、選択時POST 0回を確認しpassedへ更新。U02/U03のfast/slow応答では全slot即時回転、3秒初期待機、stop completion基準の6秒/9秒遅延、最終停止後約500ms一括表示を計測。U05は4失敗後の共通案内・結果消去・idle復帰、U07は長文/改行/HTML無害化/metadata非表示、U08はtimeout後同一画面新runへの旧応答干渉なしを確認してpassedへ更新。正式合格57/70、初回対象57/69。M01のHTTP 503 failedは継続、未完了12件（成績書第120〜124節）。


2026-09-29追記：利用者提供のGemini 3.8 Flash枠は1/5 RPM、478/250K TPM、2/20 RPD。疎通を1回だけ再実行したがHTTP 503/provider_http_503で失敗。503の原因は未特定。M01 failedを維持し、M02実生成は保留、同条件の追加要求を停止（成績書第137節）。

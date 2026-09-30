# v0.1.19 試験環境確認結果

- 確認日: 2026-09-27 JST
- 対応する計画: [試験計画書](AI-PREDICTION-REFRESH-TEST-PLAN.md)
- 証跡: [環境確認JSON](test-evidence/v0.1.19/20260927-environment.json)
- 判定: **主要ツールは利用可能。実行経路を固定すれば、このチャットからもDB・ブラウザー試験を進められる。機能試験の準備には残項目がある。**

## 1. 実測したツール・接続

「起動成功」「認証成功」「機能試験合格」は別の判定である。以下は今回の環境点検の結果で、70受入項目の合格数には含めない。

| 対象 | 実測結果 | 判定・制約 |
|---|---|---|
| Windows | Microsoft Windows 10 Pro、10.0.19045 | PowerShellからOS情報取得成功 |
| Windows PowerShell | 5.1.19041.6456 | 権限拡張実行で起動成功。通常sandboxではWSL interopエラー |
| WSL2 | Ubuntu / docker-desktopともRunning、VERSION 2 | `wsl.exe --list --verbose`で確認 |
| Ubuntu | 26.04.1 LTS、kernel 6.18.33.2-microsoft-standard-WSL2 | Bashコマンド実行成功 |
| Linux Node.js | 24.21.0 | 絶対パスで起動、node:test、fetchの存在、WebCrypto演算を確認 |
| Linux npm | 11.19.0 | Linux NodeのbinをPATHの先頭に指定すると起動成功 |
| 通常PATH | node未検出、npm/npxはWindows側を選ぶ | 未インストールではなくPATH混在。試験プロセス内で明示する |
| Linux Python | 3.14.4 | 起動成功。DB同時要求スクリプト等で必要 |
| Git | 2.53.0 | ローカル読取とリモート参照取得成功 |
| Codex CLI（UbuntuのNVM版） | 0.157.0 | 起動、login status成功。新たなエージェント処理は起動していない |
| Codexアプリ側の同梱CLI | 0.158.0-alpha.2 | 起動成功。NVM版とは別バイナリ。変更していない |
| Docker CLI / Engine | 29.8.0 / 29.8.0 | WindowsからUbuntuを起動する経路で接続成功 |
| このsandboxからLinux Docker直結 | 通常/権限拡張ともpermission denied | ホストWSL経由で解消。Dockerの再インストールやソケット全開放は不要 |
| ローカルSupabase | `project-012` 稼働、API `127.0.0.1:54321` | CLI status成功。DB/Auth/REST/Edgeの到達を確認 |
| PostgreSQL | 17.6 | コンテナ内psqlで読み取りトランザクション成功 |
| v0.1.19 migration | `20260926000000` 適用済み | ローカル履歴をSELECT。今回の適用操作なし |
| Supabase CLI | Windows版2.117.0 | `tools/supabase-cli/supabase.exe`の起動・status成功。Linux版CLIはPATHにない |
| Supabase管理認証 | projects list成功、リンク先プロジェクトが応答内に存在 | 本番/検証先の識別、DB管理・deploy権限の実行確認は別途 |
| Deno | 2.9.7、TypeScript 6.0.3 | 既存Docker imageで起動成功。ホストへの新規導入不要 |
| localhost HTTP | 一時HTTPサーバーへfetchし200 | 権限拡張実行で成功。通常sandboxはEPERM |
| ローカルAuth / REST | `/auth/v1/health` 200、`/rest/v1/` 200 | サービス到達確認。特定の受入RPC合格ではない |
| ローカルpredictions | 未認証GETで401 | Edgeルート応答あり。生成/保存の通し確認ではない |
| 外向きHTTPS | GitHub/npmは200、Google API/Supabase APIルートは404 | 権限拡張実行で応答あり。ルート404は通信成功で認証成功を意味しない |
| Geminiキー | 保護ファイルあり、mode 0600 | 値・長さ・部分文字列は採取していない |
| Gemini認証/設定モデル | 過去のmodels.listで`gemini-3.8-flash`の存在確認。2026-09-29の10レース比較で`gemini-3.5-flash-lite`は9/10直接生成に成功 | 採用モデルのDB保存・公開環境での実効設定は未確認。詳細は試験成績書第142節 |
| GitHubリポジトリ | `takashi7195/Project-012` のmain/tag参照を取得 | main `5cc946f…`、v0.1.18 `e6c2634…`。読取成功はpush権限の証明ではない |
| GitHub CLI | Linux版2.46.0、未認証。Windows版は未検出 | ローカル試験は継続可。GitHub書込/Actionsを使う前に認証経路を確認 |
| 既存公開URLのHTML | HTTP 200、v0.1.18表記あり、v0.1.19表記なし | HTMLの読み取りのみ。JavaScriptやStartは実行しておらず、v0.1.19公開試験ではない |
| Windows同梱Node | 24.19.0 | Windows interopの権限拡張実行で起動成功 |
| Playwright | Windows同梱1.62.1 | プロジェクト/Linux側からは未解決。Windowsの既存パッケージを利用可能 |
| ブラウザー | Edge 154.0.4258.37 | headless起動、390×844の試験ページ、クリックによる表示変更、画像取得を確認 |
| Chrome | 実行ファイル存在 | 起動・操作は今回未確認 |
| `@playwright/test` / Puppeteer | 今回の検索先では未検出 | Playwright本体＋既存Node test runnerで実行可能。必須の不足ではない |
| Edgeログ読取 | `docker logs`アクセス成功 | ログ内容そのものは一般証跡へ保存していない |
| Supabase Vector | restarting、restartCount=911（確認時点） | ログ集約の健全性は未確認。P1で原因調査/採取経路を確定する |

Vectorログの読み取りでは`connection refused`を含むことまで確認した。接続先や根本原因はまだ確定していない。原文ログを一般証跡へ保存せず、検出した分類だけを記録した。

Deno imageの確認済みdigest:

`denoland/deno@sha256:8ce780168429c4bf5962652e6cbea3fd45254ae902069e90585fb33f74c56968`

型検査の既存スクリプトは`alpine`をpullするため、再現性のある試験ではこのdigestとの照合または固定が必要。今回の点検では既存imageを`--pull=never --network none --rm`で一時起動し、終了時に削除した。

## 2. 成功した実行経路

### 2.1 Node/npm

このチャットの非対話シェルでは、プロセス内だけPATHを補う。

```bash
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
node --version
npm --version
```

シェルの永続設定、NVM、WindowsのPATHは今回変更していない。

### 2.2 Docker・DB

このチャットの権限拡張実行から、Windows側のWSL起動を経由する方法で成功した。

```bash
/mnt/c/Windows/system32/wsl.exe -d Ubuntu --exec /usr/bin/docker version
```

既存のBash/Nodeスクリプトも、必要ならこの経路のUbuntuで、作業ディレクトリとLinux NodeのPATHを指定して実行する。例えば環境確認だけなら次の形にする。

```bash
/mnt/c/Windows/system32/wsl.exe -d Ubuntu --exec bash -lc 'export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"; cd /mnt/c/codex/project-012/Project-012 && node --version && docker version'
```

これはUbuntuのBashから使う例であり、PowerShellにBash構文を直接貼らない。通常のUbuntu端末内のCodex CLIには過去のDocker成功実績もある。現チャットから実行できる範囲では、利用者に同じコマンドの代行を求めない。

### 2.3 Supabase CLI・ブラウザー

- Supabase CLI: `/mnt/c/codex/project-012/Project-012/tools/supabase-cli/supabase.exe`
- Windows Node: `/mnt/c/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`
- Windows Playwright: `C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`
- ブラウザー: Playwright `chromium.launch({ channel: "msedge", headless: true })`

Supabaseの`status -o json`はキーを含むため、その出力全文を表示・保存しない。API URLと必要なキーの存在だけを抽出した。Windows CLIへ渡すファイルはWindows側から見えるパスを使用する。

既存のEdge runnerはWindows CLI、`wslpath`、固定のローカル秘密ファイル位置を使っている。現在はファイルの存在を確認できるが、再起動で配置が変わった場合はCLIの機械可読出力から安全に取得する方法へ整理する。これは今後のrunner整備項目である。

## 3. 本試験までに残る準備

| 優先度 | 項目 | 対応 | 利用者の操作 |
|---|---|---|---|
| 高 | 背景処理のローカル設定 | configには`policy = "per_worker"`が明記済み。実runtimeが起動せずrouteが503となるため、runtime entrypoint/起動状態の診断と背景処理試験が残る | 原則Codex |
| 高 | ログ収集コンテナの再起動 | Vectorの原因調査。復旧するか、直接ログ＋DB記録で必要な証跡を確保する手順を検証 | 原則Codex。Desktop操作が必要な場合だけ依頼 |
| 高 | 結合用fixture・模擬AI・障害注入 | 実DB/Edgeと接続するrunnerを整備。既存のinput/read RPC smokeだけでは不足 | Codex |
| 高 | 画面用の自動操作runner | Playwright本体は利用可。対象画面のテストコード、試験先固定、画像/trace採取を追加 | Codex。実機の見た目は利用者 |
| 中 | 試験対象/証跡の固定 | 未追跡ソースを含むハッシュを作成済み。以後は変更後に更新 | Codex |
| 中 | Supabase検証先の識別 | 管理アクセスは成功。ホスト検証先、現在の契約制約、既存データ有無を確定 | 候補で確定できない場合は利用者に確認 |
| 中 | 実モデルの残枠 | models.listでは残りRPM/TPM/RPDを確認できない。実試験直前にAI Studio等で確認 | 必要時のみ利用者 |
| 公開前 | GitHub書込/Actions認証 | Linux ghは未認証。実際に採る公開手段と認証を確認する。今はpush不要 | 認証が必要な場合のみ利用者 |
| 公開前 | 本番DB/Function/設定と切り戻し | 稼働版・設定・復元方法を確認。本番の試験用初期化は行わない | Codex＋公開判断は利用者 |

Supabase公式は、ローカルの背景処理確認には`[edge_runtime] policy = "per_worker"`を設定する手順を示している。現在のconfigには`policy = "per_worker"`が明記されている。設定値だけでは実動作を証明しない。2026-09-27の再試験では一時Function routeがHTTP 503となり、背景処理の要求を送信できなかったため、Edge Runtimeの起動状態を環境課題として切り分けている。[公式Background Tasks](https://supabase.com/docs/guides/functions/background-tasks)

ツール起動時の権限は実行プロセスごとに異なる。Codex CLIの起動設定を変えても既存の別チャットへ自動で適用されたとは扱わない。[公式Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)

## 4. 今回実施しなかった確認

- Geminiの実生成、6入力の品質確認、生成結果のDB保存。
- 製品画面でのStart操作、実スマートフォン、公開URLでのv0.1.19受入。
- `EdgeRuntime.waitUntil`の90秒動作と実環境の中断・復帰。
- P3入力RPC確認ではfixtureを一時投入し、`finally`で削除。最新の追加migrationは前工程でローカル適用済み。既存DB初期化、Supabaseのdeploy/Secrets変更は未実施。
- GitHubへのpush・権限変更、公開、切り戻し実行。

今回のWindows/WSL/DB/ブラウザーの成功で、これまでの環境待ちの多くは避けられる。残る準備は主に試験用プログラム、背景処理/ログの確認、公開前の運用情報である。

## 5. P1ログ補強後の追加確認（2026-09-27）

ホストWSL経由で実ローカルEdgeの無効入力スモークを自律実行できた。Dockerログはstdout/stderr双方を収集し、固定schemaで安全な項目のみ抽出すると、3要求のX-Request-IDと開始/終了6行を照合できた。Vectorの集約基盤を復旧したことは意味しない。補助試験30件を含む関連回帰184件、Deno型検査も合格。次の本試験で利用者にログの転記を依頼する必要は現時点ではない。

2026-09-27のP3確認で、ローカルconfigに`[edge_runtime] policy = "per_worker"`があり、実PostgRESTの合成fixture読取・締切済みfixtureを通した実Edge入力検証/input/read RPC到達、両AI migrationを適用する隔離DBスモーク、現EdgeのDeno型検査が成功した。2026-09-29にはWindows bundled NodeからRFC1918 WSL gatewayを使ってread RPC smokeを再実行し、input/read RPC双方への到達を確認した。ローカルDBのrace/batch/day_head件数はすべて0。P3の全項目、Edge `waitUntil`の切断後90秒継続、実Edgeの成功保存経路は未確認。P4のGemini live smokeを2回行ったが両方HTTP 503となり、有効な生成結果は得られていない。

P3の追加runnerは実PostgRESTを使ってproduction handlerのclaim/attempt/save/read/reuse、修復再試行、最大2回失敗後の非保存をmock providerで確認し、試験後にfixture/job/bundle件数0を読み取り専用で確認した。隔離DB D12確認で不正買い目配列・空文に加え、不正reuse key形式、存在しないkey参照、job/reuse-key複合外部キー不一致を拒否し、部分bundleなしを確認した。M05の90秒waitUntil試験は一時Function routeが404/503となり、完了marker未確認。一時Functionは削除済み。Edge Runtimeコンテナは当初Createdで、手動起動はmain worker entrypoint不足で終了コード1、ローカルpredictions routeは503。これはローカル環境の起動問題として扱い、製品欠陥とは判定しない。P5はWindows同梱Playwright + Edgeをローカル静的serverで実施し、外部要求をroute mock/abortした。選択・生成・失敗復帰、締切/日付切替、画面遷移後の遅延応答、v0.1.18/v0.1.19版混在の部分確認、320/390/430/1280px表示を確認。コメント関連unit 52件も合格したが、実投稿や実Edge/API/DB連携、実端末、公開URLは未確認。

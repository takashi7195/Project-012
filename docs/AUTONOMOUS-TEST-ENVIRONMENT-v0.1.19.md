# v0.1.19 自律試験に必要な環境・権限の調査

調査日: 2026-09-27 JST。調査・提案書であり、以下の設定変更や権限付与はまだ実施していない。

## 1. 推奨構成

現在のWindows 10 + WSL2 Ubuntu + Docker Desktopを継続利用し、Codexの実行プロセス、Linux版Node/npm、Linux版Supabase CLI、ブラウザー自動試験を同じUbuntuへそろえる。ローカルSupabaseは試験専用のproject ID・ポート・volumeで隔離する。実ホストのEdge実行制約は、最後に本番と別のSupabase検証プロジェクトで確認する。

既存の作業ファイルには未commitの実装があるため、新しくcloneするだけでは現在の試験対象を移せない。移設する場合は、作業差分・未追跡ソース・切り戻し基準を保全してから行う。秘密情報やローカルDB実体はGitに含めない。

## 2. 実測した現状

| 対象 | 今回の結果 | 必要な対応 |
|---|---|---|
| 実行OS | Linux / WSL2、user01 | Codexの実行環境とユーザーのUbuntuを一致させる |
| Node | 通常のPATHでnodeを検出できない。Linux版v24.21.0を絶対パスで実行可能 | 非対話シェルでもLinux版node/npmが見つかる起動設定 |
| npm | PATHではWindows側npmが選ばれる | Linux版へ統一し、バージョン固定 |
| Docker | 通常実行・権限拡張実行ともソケットへのpermission denied | Codex実行プロセスからのDockerアクセスを解消する |
| ローカルHTTP | 通常実行はsocket作成拒否。権限拡張実行では127.0.0.1:54321から404応答 | ローカル通信の許可を継続利用できる設定。404は到達確認でありRPC合格ではない |
| Supabase CLI | Edge試験がtools/supabase-cli/supabase.exeとwslpathに依存 | Linux版CLI選択とOSに応じたパス処理 |
| ローカル鍵取得 | supabase/.temp配下の固定内部ファイルに依存 | CLIの機械可読出力等から取得し、秘密値を出力しない方法へ整理 |
| Gemini | 現CodexプロセスにはGEMINI_API_KEYなし | 試験プロセスへの秘密情報注入。ユーザーの別シェルへのexportだけでは継承しない |
| PostgREST試験 | ユーザー実行で期待404に対して502 | 応答・Edgeログ・RPC接続先/認証/関数定義を照合。原因は未特定 |
| 画面試験 | 今回のリポジトリ検索ではPlaywright設定を確認できない | 実ブラウザー試験、スクリーンショット、trace採取の準備 |

Dockerソケットはこの実行環境からnobody:nogroupとして見える。これだけではホスト側のグループ設定不足か、実行環境の隔離によるものかを断定できない。ユーザー端末でDockerが動く実績があるため、Docker再インストールやchmodによる全開放を最初の対応にしない。

## 3. 必須設定

1. **実行環境**: Dockerに到達するUbuntu内でCodexを動かす。現在のデスクトップ連携で解消しなければ、同じUbuntuからCodex CLIを起動する案を採る。切替後もエージェント自身のコマンドで接続確認する。
2. **依存ツール**: Linux版Node/npm、Supabase CLIを固定版で用意。Denoは既存のDocker方式でもよい。Docker imageも検証した版/digestを固定する。
3. **Docker**: Desktopを起動し、UbuntuのWSL Integrationを有効にする。試験コンテナの起動、ログ、exec、停止、後片付けが対話入力なしで動く状態にする。
4. **ネットワーク**: ローカルSupabase API/DB、ローカルWebサーバー、コンテナ内部のRPC通信を許可する。外向きは依存物配布先、必要なGitHub取得先、Gemini API、使用する場合のみSupabase検証先を許可する。現APIポートは54321、DBや専用試験ポートは実設定で確認する。
5. **試験データ**: 日付・締切を試験時点に合わせて作成できる専用fixtureと片付け手順を用意する。実レースの開催時間に依存させない。競艇API由来項目の忠実性確認には別途保存したサンプルを使う。
6. **ブラウザー**: Playwrightと対応Chromium、Linux依存ライブラリーを用意し、画面表示、START、待機、成功、失敗、複数画面幅を自動確認する。
7. **実モデル**: 試験用Geminiキーを環境変数またはGit対象外の保護ファイルから読み込ませる。モデルの利用可否を1回の小規模試験で確認後、回数・トークン・費用上限内で実施する。上限は試験runnerでも管理する。
8. **継続稼働**: Windows、Docker、WSL、Codexの作業セッションを維持し、試験中のスリープ/再起動を避ける。権限付与だけでチャット終了後の再開やPC停止中の実行が保証されるわけではない。

## 4. 提案する実行権限の範囲

以下は必要な能力の一覧であり、現在すべてが付与されているという意味ではない。

| 対象 | 自律試験に与える範囲 | 境界 |
|---|---|---|
| ファイル | 試験対象ソース・設計/成績書・ログ・一時ファイル・依存キャッシュの読書き | 無関係なユーザーファイルは対象外 |
| コマンド | Node、npm、固定CLI、Deno、ブラウザー、試験用サーバーの起動/終了 | OS管理権限は初回導入時に限定 |
| Docker | 試験用container/network/volumeの作成・起動・exec・ログ・停止・削除 | 他プロジェクトの削除や全体pruneは対象外 |
| ローカルDB | 専用DBのmigration、fixture投入、検証、初期化、削除 | 既存データを持つ開発DBの全消去は対象外 |
| ネットワーク | 試験ローカル通信と必要な外向きHTTPS | 公開ポートの外部開放は不要 |
| Gemini | 試験キー利用、合意した上限内の生成 | 有料枠の有効化・上限増額は別判断 |
| GitHub | ローカル試験だけなら接続不要。必要時は対象repoの読取 | push/PRは許可された作業ブランチに限定。mainへのmerge、設定変更は対象外 |
| GitHub Actions（任意） | 対象試験workflowの実行とログ/成果物の読取 | workflow追加には別途repoへの反映権限が必要 |
| Supabase検証環境 | 検証projectへのmigration、Function反映、試験データ操作、ログ参照 | 本番projectを含むアカウント全体権限は不要 |
| 本番公開 | 自律試験の範囲外 | 公開判定後に個別判断 |

Dockerソケットへの通常の直接アクセスは強い権限であり、コンテナ名の約束だけでは技術的なアクセス制限にならない。試験対象に限定した運用を確実にするには、専用Docker実行環境や隔離されたrunnerを用意する。一般的なLinux Docker Engineのdocker groupはroot相当の権限を与える。

Codexの「作業を許可する指示」、サンドボックス/ネットワーク設定、OS/Dockerのアクセス権、サービス資格情報は別々の条件である。承認を聞かない設定だけではアクセス拒否は解消しない。変更する設定名は使用するCodex版・管理ポリシーを確認して決める。

Supabaseのローカル試験には本番の管理トークンは不要。検証projectへデプロイする場合の管理認証、DB migrationの接続情報、Function内のservice role相当の資格情報は役割が異なる。秘密値はチャットや試験ログへ出さない。

## 5. 手持ち環境の使い分け

| 環境 | 推奨用途 | 追加条件 |
|---|---|---|
| WSL2 Ubuntu | 当面の主試験環境。修正から再試験まで実施 | 上記Dockerアクセス・Linuxツール統一 |
| PowerShell | Windows/Docker Desktop/WSLの初回設定と診断 | 日常試験はUbuntuに統一 |
| GitHub | ソースと試験成果の管理 | 現在の未commit差分を取り残さない |
| GitHub Actions | 一括試験が完成した後の定型回帰試験 | workflow、固定依存、Secrets、利用枠。通常の試験workflowだけではAIによる修正は行わない |
| Codespaces | Windowsとの混在を避けた別のLinux試験環境 | 現作業差分の移行、Docker対応、秘密情報、Codexをその環境で実行する接続/認証、利用枠・停止設定 |
| Supabase検証project | 実ホストの背景処理・デプロイ/切り戻し確認 | 本番と分離したprojectと資格情報 |

Codespacesがあるだけで現在のチャットがその端末を操作できるわけではない。接続経路とCodexの実行先を設定する必要がある。アイドル停止もあるため、単にブラウザーを閉じれば無期限に動く環境とは扱わない。

## 6. 環境以外に必要な試験整備

- 既存runnerのWindows実行ファイル、固定container名、固定ポート、内部鍵ファイルへの依存を設定可能にする。
- 専用Supabase stack、fixture、Edge、Webサーバーを起動し、終了時に自分が作成した資源だけ片付ける共通runnerを作る。
- 502時の診断に必要なHTTP結果・RPCエラー・runtimeログを秘密値除去後に自動保存する。
- 成功、遅延、429、壊れた出力、保存失敗を再現できる試験用providerを接続する。異常系すべてを実Geminiへ送る必要はない。
- 実ブラウザーからDB保存・結果表示までの確認、共有jobの同時要求、切り戻しを自動化する。
- 70受入ケースへ既存150件やDB/HTTP試験の証跡を対応付け、不足する条件だけ追加する。各ケースの証跡がそろった段階で合格にする。単体試験件数を受入件数へそのまま転記しない。
- 実モデルの文章品質・根拠の評価には評価記録を残し、公開承認はユーザーの判断として残す。

## 7. 自律実行可能と判断する条件

ユーザー端末だけでなく、Codexが使う同じ実行経路から次がすべて成功することを確認する。

1. Linux版node/npm/CLIの版確認と一時ファイルの作成・削除。
2. Docker Server情報取得と専用の使い捨てコンテナ作成・削除。
3. 専用Supabase起動、HTTP/RPC接続、fixture投入・読取・片付け。
4. ブラウザー起動、START操作、スクリーンショット/trace保存。
5. 上限管理下でのGemini実呼出と使用量記録。
6. エラーを起こしたときにログが残り、次の試験へ必要な初期状態を復元できる。

## 8. 公式資料

- WSLでのCodex実行とLinux側作業ディレクトリ: https://learn.chatgpt.com/docs/windows/wsl
- Codexの承認とセキュリティ: https://learn.chatgpt.com/docs/agent-approvals-security
- Windows 10のCodexネイティブ対応はbest effort: https://learn.chatgpt.com/docs/windows/windows-sandbox
- Docker DesktopのWSL Integration: https://docs.docker.com/desktop/features/wsl/
- Linux Docker groupの権限: https://docs.docker.com/engine/install/linux-postinstall/
- Supabase CLIのローカル実行: https://supabase.com/docs/guides/local-development/cli/getting-started
- Supabase検証/本番環境分離: https://supabase.com/docs/guides/deployment/managing-environments
- PlaywrightのCI環境準備: https://playwright.dev/docs/ci
- Codespacesの停止/タイムアウト: https://docs.github.com/en/codespaces/about-codespaces/understanding-the-codespace-lifecycle

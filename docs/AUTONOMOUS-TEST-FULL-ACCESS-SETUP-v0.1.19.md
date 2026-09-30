# 利便性を優先した自律試験の設定手順

作成日: 2026-09-27 JST

ユーザーの「広範囲な権限を与え、セキュリティより利便性を優先する」という方針に基づく設定案。現時点では設定変更や認証操作を実施していない。前提調査は[AUTONOMOUS-TEST-ENVIRONMENT-v0.1.19.md](AUTONOMOUS-TEST-ENVIRONMENT-v0.1.19.md)。

## 1. 採用する構成と権限

Windows 10上のWSL2 Ubuntuを主実行環境にする。Codex、Node/npm、Supabase CLI、PlaywrightをUbuntu側で実行し、Docker DesktopのWSL Integrationを利用する。

| 層 | 設定 | 実行できる操作 |
|---|---|---|
| Codex | danger-full-access + approval never | OSユーザーがアクセスできるファイル、コマンド、ネットワークをCodexのサンドボックス制限なしで扱う |
| Ubuntu | 通常はuser01。OS導入まで無人化する場合はuser01にpasswordless sudo | パッケージ導入、依存ライブラリー設定、権限修復 |
| Docker | user01の実行プロセスからDocker APIへ接続 | container/volume/networkの管理、DB操作、ログ採取 |
| GitHub | Ubuntuのghで認証。repoアクセスとworkflow更新に必要なscope | 対象repoの取得、push、PR操作、Actions試験 |
| Supabase | CLI管理認証 + 対象DB接続情報 | migration、Function反映、Secrets設定など。実行先は明示する |
| Gemini | GEMINI_API_KEYをCodex起動時に継承 | 実モデル試験。サービス側の割当・課金条件は別途有効である必要あり |

この構成では、アクセス可能なソース以外のファイルや認証情報にもCodexが到達し得る。passwordless sudoはUbuntuの管理操作も可能にする。技術的なアクセス範囲は広げるが、試験作業の指示が本番公開・データ全消去・課金変更を自動的に依頼したことになるわけではない。

## 2. ユーザーが最初に行う操作

1. Docker Desktopを起動し、UbuntuへのWSL Integrationを有効にする。
2. Windowsの電源接続時のスリープを試験中は無効にする。
3. Ubuntuの通常端末からCodexを起動するか、アプリの権限選択でFull access相当を選ぶ。
4. 必要な初回ログインを完了する。Ubuntuの管理操作も無人化する場合のみsudo設定を行う。
5. Geminiキーと、実Supabaseを試験する場合の認証情報をローカルに設定する。

チャットでの許可は作業上の承認として扱えるが、現在の実行プロセスのサンドボックス設定を変更するものではない。権限変更後に起動したセッションで接続確認する。

## 3. Codexの設定

この環境で確認したCLIは `0.158.0-alpha.2`。`--sandbox danger-full-access` と `--ask-for-approval never` の両方がCLI helpに存在した。

まずユーザー自身のUbuntu端末で `command -v codex` を確認する。アプリ内で見えていたCLIが通常端末のPATHにもあるとは限らない。見つからなければ[公式WSLガイド](https://learn.chatgpt.com/docs/windows/wsl)の方法でLinux版Codex CLIを導入してから、次を実行する。

```bash
cd /mnt/c/codex/project-012/Project-012
codex --sandbox danger-full-access --ask-for-approval never
```

これは新たに起動したCLIセッションの設定であり、現在開いているアプリのチャット設定を変更するコマンドではない。CLIの認証が未設定なら初回にCodexへログインする。既存チャットの履歴がCLIに自動共有されるとは限らないため、作業を引き継ぐ際は設計書、試験成績書、未解決502を引継ぎ対象にする。

毎回指定しない場合は、実際に使用するユーザー設定ファイルを編集する。通常はUbuntuの `~/.codex/config.toml` だが、`CODEX_HOME` が指定されていればその配下になる。

```bash
printf '%s\n' "${CODEX_HOME:-$HOME/.codex}/config.toml"
```

既存設定を保全し、同じキーやテーブルを重複させずに次を設定する。トップレベルの2項目はTOMLの別テーブル内に書かない。

```toml
approval_policy = "never"
sandbox_mode = "danger-full-access"

[shell_environment_policy]
inherit = "all"
ignore_default_excludes = true
```

既存の環境変数フィルターがあれば、必要なキーを除外していないか確認する。秘密値自体はこの設定ファイルへ直接書く必要はない。

アプリでは現在のチャット/プロジェクトの権限選択にFull access（フルアクセス）相当がある場合に選ぶ。表示名・場所はアプリ版により異なるため、未確認のメニュー階層は断定しない。管理ポリシーが制限している場合はユーザー設定だけでは解除できず、管理者が許可する設定が必要になる。

`approval_policy = "never"` だけではサンドボックスもOS権限も変わらない。Full accessでもWindows/Ubuntuの管理者権限が自動付与されるわけではない。

## 4. Ubuntu・Docker

PowerShellからUbuntuを開く。

```powershell
wsl -d Ubuntu
```

Docker Desktopで次を確認する。

- Settings → General → Use WSL 2 based engine
- Settings → Resources → WSL Integration → Ubuntuを有効化
- 適用後、Ubuntu端末で `docker version` と `docker ps` が成功すること

現在ユーザーのUbuntuではDocker実行成功の実績があるため、まずその端末からFull accessのCodexを起動する。これでCodex内部からもDocker接続が成功すれば、グループ変更は不要。

もし通常のUbuntu端末自体でもpermission deniedとなる場合は、ソケット所有者・グループとプロセスのグループを調べて修正する。現在のエージェント隔離内ではnobody:nogroupに見えたため、この表示だけを根拠にdocker group追加やソケットchmodを行わない。

OS依存ライブラリーの導入まで確認なしで任せる場合は、ユーザーが次を実行する。

```bash
sudo visudo -f /etc/sudoers.d/90-codex-user01
```

user01が実際のUbuntuユーザーであることを確認し、以下を設定する。

```sudoers
user01 ALL=(ALL:ALL) NOPASSWD: ALL
```

確認:

```bash
sudo -n true
```

解除する場合は同じvisudoでこの行を削除する。Codex自体はuser01として起動し、必要なOS管理コマンドだけsudoを使う。

## 5. Linuxツールと試験コード

現在のNodeを使う例:

```bash
source /home/user01/.nvm/nvm.sh
nvm use 24.21.0
command -v node npm
node --version
```

これをCodex起動前に行う。Codexの子プロセスでもLinux版が選択されることを確認する。

Supabase CLIはLinux版へそろえる。プロジェクト依存として導入する場合は採用版を固定し、`npx supabase`で実行する。導入の方式は公式に対応する方法を選び、既存Windows CLIの版との違いを確認する。Linux版CLIを導入するだけでは、現試験コードが参照する `tools/supabase-cli/supabase.exe` は切り替わらないため、runner側の変更も必要。

Playwright・対応Chromium・Linuxライブラリーの導入と、専用Supabase stack/fixture/一括実行runnerの作成は、権限設定後にエージェントが担当できる。既存の本番向け接続先を自動的に試験先へ流用しない。

## 6. GitHubの認証

Ubuntu側で一度認証する。

```bash
gh auth login --hostname github.com --git-protocol https --web --scopes repo,workflow
gh auth setup-git --hostname github.com
gh auth status
```

ブラウザーでの初回認証をユーザーが完了すると、そのUbuntuユーザーのgh/Git認証を後続の試験・開発操作に利用できる。scopeは利用者自身が持たないrepo権限や保護ブランチの権限を新たに作るものではない。組織のSSOや承認が必要ならその初回手続きも必要。

GitHub Actionsを利用する場合はworkflow、実行権限、必要なSecretsを別途設定する。Codespaces SecretsとActions Secretsは別物である。

## 7. Supabaseの認証

ローカルSupabaseだけならクラウド管理用ログインは不要。実Supabaseでの試験には、対象projectへの権限を持つアカウントのCLI認証を用意する。

```bash
npx supabase login
```

無人実行では `SUPABASE_ACCESS_TOKEN` を環境変数で渡す方法も使える。DB操作には別途DBパスワード/接続情報が必要で、CLIは `SUPABASE_DB_PASSWORD` を利用できる。

| 情報 | 用途 |
|---|---|
| Supabase Access Token | Management API、Function反映、Secrets管理など |
| 対象project ref | 実行先の特定 |
| DB password/接続情報 | migration等のDB管理 |
| project URLとAPI鍵 | HTTP/API経由の試験 |

API用service_roleキーとCLI管理トークンは代替関係ではない。ローカルSupabaseのAPI鍵はローカル環境から取得する。ホスト検証用の情報はローカル用と名前・保存先を分ける。

projectのlinkは既存の接続先を変更するため、試験先を確定した専用作業ディレクトリで行う。現作業ディレクトリに対して説明用project refをそのまま実行しない。

## 8. Gemini等の秘密情報を起動時に渡す

Ubuntu側にプロジェクト外のファイルを用意する。

```bash
mkdir -p ~/.config/project-012
chmod 700 ~/.config/project-012
touch ~/.config/project-012/test-secrets.env
chmod 600 ~/.config/project-012/test-secrets.env
nano ~/.config/project-012/test-secrets.env
```

ファイル内容は、例えば次の形でユーザーがローカル編集する。以下の説明用文字列を実値へ置き換える。

```bash
GEMINI_API_KEY='ここへ実際のキーを入力'
```

クラウドSupabase試験の管理認証も必要なら同ファイルに追加できる。対象projectやDB情報は試験先を確認してから設定する。

このファイルを読み込んだ同じ端末からCodexを起動する。

```bash
source /home/user01/.nvm/nvm.sh
nvm use 24.21.0
set -a
source ~/.config/project-012/test-secrets.env
set +a
cd /mnt/c/codex/project-012/Project-012
codex --sandbox danger-full-access --ask-for-approval never
```

別の端末でexportしただけでは、既に動いているCodexへは反映されない。デスクトップアプリを使う場合も、実際のツール実行プロセスへの注入を確認する。APIキーはチャットへ貼らず、設定確認は値を表示せず有無だけで行う。

GeminiのAPI利用枠、対応モデル、課金はCodexの権限とは別。試験runnerでは呼出回数・使用量を記録し、設定した上限で停止する。

## 9. Codespacesを使う場合

Windows側の設定を避ける代替として利用可能。ただし現在の未commitの実装・未追跡試験ソースを移す必要がある。

1. 現在の試験対象を作業ブランチ等へ保全し、Codespacesへ移す。
2. CodespaceにLinux版Node/Supabase CLI、Docker対応、Playwrightを用意する。
3. GitHub個人Settings → Codespaces → Codespaces secretsでGEMINI_API_KEY等を登録し、対象repoを許可する。
4. Secrets追加後にCodespaceを再起動する。
5. Codespace内でCodexへログインし、Full access設定で起動する。
6. 試験に必要なアイドルタイムアウト・利用枠を設定する。

現在のローカルチャットが自動的にCodespaceを操作できるようになるわけではない。Codespace内でエージェントを実行するか、明示した接続経路が必要。PC停止中の継続についても、Codespaceとエージェントプロセスが維持される構成を確認する。

## 10. 設定完了の判定

新しい実行セッションからエージェント自身が以下を確認し、成功すればユーザーのコマンド貼付を基本的に不要にできる。

- Linux版Node/npm/CLIの起動。
- Docker情報取得と使い捨てcontainerの作成・終了。
- 必要な場合の `sudo -n true`。
- ローカルSupabaseへのHTTP/RPCとDB fixture操作。
- ブラウザー起動・画面操作・結果保存。
- 秘密値を表示しないGeminiキー有無確認と、利用枠内の実リクエスト。
- GitHub/実Supabaseを使う場合の認証と対象project識別。

この設定で、試験の実行・ログ取得・修正・再試験を同じ作業セッション内で進められる。PCスリープ、サービス停止、API利用枠切れ、モデル利用不可、試験コードの不具合は別途対処が必要。

## 公式資料

- Codex full access / approval never: https://learn.chatgpt.com/docs/agent-approvals-security
- Codex設定ファイル・環境変数継承: https://learn.chatgpt.com/docs/config-file/config-reference
- Docker Desktop WSL Integration: https://docs.docker.com/desktop/features/wsl/
- GitHub CLI認証: https://cli.github.com/manual/gh_auth_login
- Supabase CLI認証・DB password: https://supabase.com/docs/reference/cli/supabase-login
- Codespaces Secrets: https://docs.github.com/en/codespaces/managing-your-codespaces/managing-your-account-specific-secrets-for-github-codespaces
- Codespaces timeout: https://docs.github.com/en/codespaces/setting-your-user-preferences/setting-your-timeout-period-for-github-codespaces

# Project-012 作業ルール

## 基本ワークフロー

原則として次の順序で進める。

1. ChatGPTで相談・方針整理
2. Codex CLIでread-only調査
3. 調査結果をChatGPTへ戻す
4. ChatGPTで修正方針を決定
5. Codexで実装・テスト
6. 結果をChatGPTへ戻す
7. 明示的な承認後にcommit・push・deploy等へ進む

原因が十分に確認できていない状態で、Codex CLIから直接実装へ進まない。

## 🟦 Codex CLIの役割

Codex CLIは原則として調査専用。主な用途はSupabase MCPによるログ調査、コード・Git状態のread-only確認、原因切り分け、本番diagnostic確認とする。

原則として、コード変更、commit、push、deploy、DB・Secrets・migration・Scheduler変更、main変更、本番POSTは禁止。ユーザーまたはChatGPTから明示的に指示された調査結果txtの保存等は実行してよい。

## 🟩 Codexの役割

Codexは実装・テストを担当し、コード修正、テスト追加・更新、ローカルテスト、git diff確認を行う。commit・push・deploy・本番E2Eは明示的に指示された場合だけ行う。調査だけを求められた場合はコードを変更しない。

## 誤送信防止

- `🟦【CODEX CLI専用】`の指示をCodex実装側で受け取った場合は、実行せず停止する。
- `🟩【CODEX専用】`の指示をCodex CLIで受け取った場合は、実行せず停止する。

## Git安全ルール

- mainは明示的な指示なしに変更しない。
- force push、`reset --hard`、stashを勝手に行わない。
- 既存変更や未追跡監査ファイルを勝手に破棄しない。
- 未追跡監査ファイルを勝手にstage・commitしない。
- commit前に対象ファイルを確認する。
- push後にlocal HEADとremote SHAを確認する。

## 本番安全ルール

deploy、本番POST、DB変更、migration、Secrets変更、Scheduler変更、Edge Function設定変更は、明示的な指示がある場合だけ実行する。

deploy時は対象Functionだけを変更し、他Functionのversionが変わっていないことを確認する。

## 調査ルール

調査結果では確定事項・未確定事項・推測・次の候補を区別する。ログやコードに証拠がないことを断定しない。本番障害では原因を推測して先に修正せず、可能な限りログやコードから失敗地点を確認する。

## 出力ルール

結果は簡潔にし、原則30〜100行以内とする。同じ説明を繰り返さず、コード全文を不要に貼らず、必要な行番号だけ示し、passed / failed件数を明示する。長くなる場合は詳細をtxtへ保存し、画面には結論・重要事項・保存先だけを示す。

## テストルール

comments変更では必要に応じて以下を確認する。

- comments関連Nodeテスト
- 全Node回帰テスト
- Deno integration test
- syntax check
- `git diff --check`

テスト失敗時は、テストを通すために仕様を勝手に変更しない。

## Project-012の重要な保護対象

明示的な変更指示がない限り、以下を不用意に変更しない。

- deterministic prediction scoring
- `race-prediction/scoring.mjs`
- narrative仕様
- Race DB RPC仕様
- venue / race UI
- DB schema
- Secrets
- Scheduler
- predictions function
- race-ingest function

commentsとpredictionの責務を混同しない。

## commentsの基本仕様

- 1コメントにつき1つの完結した回答とする。
- 会話履歴、venue / race selector stateを利用しない。
- 対象不足時に過去文脈を推測しない。
- predictionでは既存deterministic logicを利用し、Geminiが独自予想を作らない。
- DB no-matchはsystem failureとして扱わない。
- system/provider failureは安全なtemplate fallbackとする。
- Race DB RPCは最大3回とする。
- ユーザー向け返信に技術情報を漏らさない。

## 競艇表記

艇番は「1号艇」から「6号艇」と表記し、「1号車」等の不自然な表記を使わない。選手名と艇番を併記する場合は「1号艇 山田太郎」のように表記する。

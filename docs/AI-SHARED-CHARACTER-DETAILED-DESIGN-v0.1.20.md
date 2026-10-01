# v0.1.20 ルーレット・AIタカシ共通キャラクター 詳細設計書

- 作成日: 2026-10-01 JST
- 対応基本設計: [基本設計書](AI-SHARED-CHARACTER-BASIC-DESIGN-v0.1.20.md)
- 試験成績: [試験成績書](AI-SHARED-CHARACTER-TEST-REPORT-v0.1.20.md)

## 1. 共通指示

`race-prediction/ai-character.mjs` が両機能で使う不変のキャラクター指示をexportする。酔っ払いのように少し呂律がゆるく、とぼけた口調で、言葉遣いは乱暴でぞんざい。罵倒・脅し・差別・攻撃はさせず、意味と事実は正確に保つ。コメント返信の完結条件はキャラクター文と別の機能指示として維持する。予想文では与えられたデータと買い目との整合を優先し、キャラクターは文章表現だけに用いる。

## 2. ルーレット

- `DEFAULT_AI_CONFIG.styleText`へ共通指示を設定する。
- `styleVersion`を変更し、設定ハッシュが旧版と異なるようにする。
- 既存のJSON schema、買い目検証、データ入力、最大試行数、90秒総時間上限は維持する。
- `RACE_AI_STYLE_TEXT`と`RACE_AI_STYLE_VERSION`の明示設定がある場合は既存の環境設定優先規則を維持する。

## 3. AIタカシ

- direct返信を作る`reply-router.mjs`、通常/チップ候補を作る`ai-reply.mjs`、DB事実から最終返信を作る同モジュールのすべてに同一指示を入れる。
- `TEMPLATE_REPLIES`も共通キャラクターに合わせる。
- 判定、検索可否、DB問い合わせ、個人情報伏字、チップ判定、返信形式・検証は変更しない。
- 口調のためにユーザーの事実を改変したり、存在しない事実を補完したりしない。

## 4. 配布

GitHub Pagesは表示版をv0.1.20へ更新する。Supabase `predictions` と `comments` Edge Functionを対象版ソースから個別にdeployする。DB migrationおよびSecret更新は不要である。公開前に現行Function版とPagesのsourceを読み取り確認し、公開候補との差分を限定する。公開後はPages HTTP応答とFunction versionを読み取り確認する。

## 5. ロールバック

問題時はGitHub Pagesをv0.1.19のコミットへ戻す。DB migrationとSecret変更は行わないため、その切り戻しは不要。公開中FunctionのソースをSupabaseから事前取得できていないため、Functionsの完全な直前状態への切り戻しは公開前に保証できない。Function更新後は、直前版として保存したローカルv0.1.19ソースを使って復旧し、適用前後のFunction versionを記録する。force pushやタグ移動はしない。

## 6. 試験仕様

| ID | 内容 | 合格条件 |
|---|---|---|
| C01 | 共通指示の共有 | 2機能の生成プロンプトが同一の指示文を含む |
| C02 | roulette既定設定 | 空環境設定でも共通指示がstyleTextとなり、styleVersionが更新される |
| C03 | router direct | direct応答promptに共通指示と返信完結条件を含む |
| C04 | comments通常/チップ/DB返信 | 全ての生成経路に同一指示を含む |
| C05 | 定型返信 | すべての定型文が酔っ払い風・とぼけた調子を持つ |
| C06 | 予想出力契約 | 既存schema/買い目validation testsが合格 |
| C07 | comments回帰 | 既存コメント単体・Deno handler integration testsが合格 |
| C08 | Edge bundle | 両Functionの依存bundle/typecheckが成功 |
| C09 | 公開反映 | Pages v0.1.20および対象Functionの更新を読み取り確認 |
| C10 | public generation | 利用者による公開URLでの応答確認。ユーザーが実施する |

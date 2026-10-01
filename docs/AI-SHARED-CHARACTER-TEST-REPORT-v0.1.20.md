# v0.1.20 ルーレット・AIタカシ共通キャラクター 試験成績書

- 作成日: 2026-10-01 JST
- 対応設計: [基本設計書](AI-SHARED-CHARACTER-BASIC-DESIGN-v0.1.20.md)、[詳細設計書](AI-SHARED-CHARACTER-DETAILED-DESIGN-v0.1.20.md)
- 状態: 自動試験合格。公開反映前

| ID | 結果 | 根拠 |
|---|---|---|
| C01 | 合格 | 2機能が共有モジュールの定数をpromptへ含める試験 |
| C02 | 合格 | 既定styleText・styleVersion・環境変数未指定を単体試験 |
| C03 | 合格 | Router direct promptに共通指示と返信完結条件があることを確認 |
| C04 | 合格 | AI返信・事実返信promptに共通指示があることを確認 |
| C05 | 合格 | AIタカシとRouterの定型返信を確認 |
| C06 | 合格 | AI入力・provider契約のNode単体試験 |
| C07 | 合格 | Deno comments handler integration: 9 passed / 0 failed |
| C08 | 合格 | Deno typecheck: comments/index.ts と predictions/index.ts の両方が成功 |
| C09 | 公開後確認 | Pages v0.1.20とFunction版を反映後に読み取り確認 |
| C10 | 利用者試験 | 公開URLでの文章確認 |

APIキー、認証情報、コメント本文などの秘密情報は証跡に記録しない。公開URLで実生成するC10は利用者が実施する。

2026-10-01 JST: 対象Node試験 61 passed / 0 failed。comments Deno handler integration 9 passed / 0 failed。Deno typecheckはcommentsとpredictionsが成功。公開反映およびFunction版確認はC09として実施する。

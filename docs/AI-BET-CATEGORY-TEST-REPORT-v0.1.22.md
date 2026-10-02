# 本命・対抗・大穴 試験成績書 v0.1.22

状態: 実装・公開済み。ローカル自動試験合格。実レース生成・公開URLでの新規生成表示は未確認。

関連: [試験仕様](AI-BET-CATEGORY-TEST-SPEC-v0.1.22.md)

| ID | 内容 | 結果 |
|---|---|---|
| C01 | 初回・形式修正時の3定義と項目対応 | 合格。Node testsでプロンプト・修正指示の区分定義とJSON対応を確認。 |
| C02 | 新旧設定hash・再利用キー | 合格。promptVersion 4→5と基本プロンプト差分でhashが変わることを確認。 |
| C03 | 既存出力契約 | 合格。Node testsで重複等を拒否し、同じ3艇の着順違いを許容。 |
| C04 | 送信要求・既存設定 | 合格。モック送信試験で指示と事実データが別領域に送られ、モデル設定を維持。 |
| C05 | 実レース生成・データ整合性・区分の意味 | 未実施。今回、Gemini実APIは呼び出していない。 |
| C06 | 公開反映後の生成・表示 | 一部確認。Pages commit `060e6c3` built、予想Function v43 ACTIVE。無効な選択値による公開ルート確認で`ai_bundle`応答を確認。利用者は公開変更を確認し「非常によくなりました」と評価。対象レース・生成内容の証跡は未共有。 |
| C07 | 表示記号・名称・読み上げ・hole対応 | 合格。ブラウザーUI smokeでDOM表示・アクセシブルラベル・買い目行への反映を確認。 |
| C08 | スマートフォン・PCの表示 | 一部確認。Playwrightで320/375/390/430/768/1280pxを確認。360pxと実機端末は未確認。 |

## 実行記録

- 実施日: 2026-10-02 JST
- 対象: 作業中ワークツリー（コミット未作成）
- `node --test race-prediction/ai-contract.test.mjs race-prediction/ai-p2-input.test.mjs`: 30件合格、0件失敗。
- `tools/local-integration/ai-ui-browser-smoke.cjs`: 合格。Edge/PlaywrightでSTART・ポーリング・表示・失敗時クリア、および320/375/390/430/768/1280pxのレイアウトを確認。C08の360pxは未確認。
- `bash tools/local-integration/ai-edge-typecheck.sh`: 終了コード0。
- `git diff --check`（今回の変更対象ファイル）: 合格。
- Gemini API要求数: 0。公開Functionへ無効な選択値を1回送信し、`ai_bundle`応答を確認。実装経路上、DB・Geminiへ進まない入力。Supabase FunctionとGitHub Pagesは更新済み。
- 360pxを加えた再実行はWSL/Windows連携の起動エラー（`UtilAcceptVsock`）で試験開始前に失敗。過去に合格した幅だけを試験済みとして記録。
- 公開結果: commit `060e6c366a958af18bca97fc5e52bdb2c468d0e3`。GitHub Pages build status `built`。予想Function status `ACTIVE`, version `43`。

既存の「穴」比較試験は参考情報とし、この「大穴」変更の合格数には含めない。実装後に実施日時、対象コミット、試験環境、結果と証跡、実生成要求数、残事項を記入する。

# Spec-Driven Development with OpenSpec

このリポジトリは [OpenSpec](https://github.com/Fission-AI/OpenSpec)（CLI v1.9 系、schema: `spec-driven`）による仕様駆動開発で進める。
**仕様（spec）が先、実装が後。** 仕様に書かれていない振る舞いを実装しない。仕様と実装が食い違ったら、まず仕様側を直す。

## 基本原則

- 新機能・振る舞いの変更・破壊的変更は、必ず OpenSpec の change として提案してから実装する。
- タイポ修正、フォーマット、依存の軽微な更新など振る舞いを変えない作業は change 不要。
- 計画（propose / update）と実装（apply）は別ターンに分ける。propose を依頼された応答の中で実装を始めない。
- change ディレクトリは手で作らない。必ず `openspec new change "<name>"` を使う（`.openspec.yaml` などのメタデータが生成されるため）。
- 各アーティファクトの書き方は `openspec instructions <artifact-id> --change "<name>" --json` の `instruction` を正とする。

## ディレクトリ構成

```
openspec/
├── config.yaml          # プロジェクトコンテキストとアーティファクト別ルール（必読）
├── specs/               # 現行の正式仕様（source of truth）
│   └── <capability>/spec.md
└── changes/             # 進行中の変更提案
    ├── <change-name>/
    │   ├── proposal.md  # 何を・なぜ
    │   ├── design.md    # どう作るか（必要な場合のみ）
    │   ├── specs/<capability>/spec.md  # 差分仕様（delta）
    │   └── tasks.md     # 実装タスクのチェックリスト
    └── archive/         # 完了した change（YYYY-MM-DD-<name>）
```

## ワークフロー

ユーザーはスラッシュコマンドを使わず、自然言語で依頼する。依頼の意図から該当フェーズを判断し、対応する OpenSpec スキルを Skill ツールで呼び出して進めること。

| フェーズ | 依頼の例 | 使うスキル | 内容 |
| --- | --- | --- | --- |
| 探索 | 「〜について考えたい」「どう作るか相談したい」 | `openspec-explore` | 要件の整理・調査。コードは書かない |
| 提案 | 「〜を作りたい」「〜を追加して」「〜を直して」 | `openspec-propose` | change を作成し proposal / specs / design / tasks を一括生成 |
| 修正 | 「提案の〜を変えて」「この方針で計画を直して」 | `openspec-update-change` | 既存 change の計画アーティファクトを改訂し、相互の整合を保つ。コードは触らない |
| 実装 | 「実装して」「続きを進めて」 | `openspec-apply-change` | `tasks.md` を上から順に実装し、完了したら `- [x]` にする |
| 同期 | 「仕様に反映して」 | `openspec-sync-specs` | delta spec を `openspec/specs/` に反映（アーカイブはしない） |
| 完了 | 「アーカイブして」「完了にして」 | `openspec-archive-change` | 全タスク完了後、仕様を反映して `changes/archive/` へ移動 |

- 「〜を作って」のように実装まで求める依頼でも、対応する change がなければまず `openspec-propose` で計画だけ作り、ユーザーの確認を待ってから実装に入る。
- 対象の change が曖昧なときは `openspec list --json` で一覧を示し、どれを対象にするか確認する。
- 実装中に仕様の不備や前提の誤りに気づいたら、実装で吸収せず `openspec-update-change` で計画側を直してから再開する。

## よく使う CLI

```bash
openspec list --json                          # 進行中の change 一覧
openspec status --change "<name>" --json      # アーティファクトの進捗
openspec show <name>                          # change / spec の内容表示
openspec validate <name> --strict             # 仕様フォーマットの検証（提案後・アーカイブ前に必ず実行）
openspec instructions <artifact-id> --change "<name>" --json
openspec archive <name>                       # アーカイブ
```

## 記述ルール（`openspec/config.yaml` の要約）

詳細は [openspec/config.yaml](openspec/config.yaml) を参照。要点は以下。

- **アーティファクト本文はすべて日本語**で書く。思考は英語でもよい。
- ただし以下は英語のまま残す（OpenSpec パーサの構造マーカーのため、訳すと仕様として認識されない）:
  - `ADDED` / `MODIFIED` / `REMOVED` / `RENAMED` / `Requirement` / `Scenario`
  - Gherkin キーワード `GIVEN` / `WHEN` / `THEN` / `AND`
  - コード、識別子、ファイルパス、コマンド、ライブラリ名
- 要件は **EARS 記法の日本語形**で書き、見出しに EARS の型を括弧で添える:
  - ユビキタス（常時）: 「システムは <応答> すること」
  - イベント駆動: 「<トリガー> したとき、システムは <応答> すること」
  - 状態駆動: 「<状態> である間、システムは <応答> すること」
  - オプション: 「<機能> が有効な場合、システムは <応答> すること」
  - 望ましくない事象: 「<条件> の場合、システムは <応答> すること」
  - 複合: 上記を組み合わせ、条件を明示する
- 1 要件 = 1 つの検証可能な振る舞い。「適切に」「高速に」などの曖昧語を使わず、数値・閾値・状態で書く。主体を明示し能動態で書く。
- シナリオは観測可能な入力と出力で書き、内部実装の手順は書かない。
- 進捗報告・テスト結果・アーカイブ結果の要約も日本語で行う。

### delta spec の例

```markdown
## ADDED Requirements

### Requirement: 作業時間の記録（イベント駆動）
ユーザーが作業時間を選択したとき、システムはその日の合計作業時間に選択した時間を加算すること。

#### Scenario: 記録が保存される
- **GIVEN** その日の合計が 0 分である
- **WHEN** ユーザーが「10分」を選択したとき
- **THEN** その日の合計に 10 分が反映されること
```

各 Requirement には少なくとも 1 つの `#### Scenario:` を付ける（見出しレベル 4 固定）。`MODIFIED` では既存の Requirement 全文を書き直して置き換える。

## 実装時の規約

- 実装は `tasks.md` のタスク単位で進め、完了ごとにチェックを付ける。タスク外の変更をしない。
- ライブラリ・フレームワークの API は記憶に頼らず `find-docs` スキルで最新ドキュメントを確認する。
- JS/TS コードは Ultracite（`ultracite` スキル）の規約に従い、`npx ultracite check` / `fix` で整形・lint する。
- UI を作る場合は `web-design-guidelines` スキルでレビューする。
- コミットはユーザーの指示があるときのみ行う。メッセージは Conventional Commits（`feat:` / `fix:` / `chore:` など）に従う。
- `.env` 系ファイルは読まない・編集しない。

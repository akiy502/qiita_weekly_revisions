## Why

Qiita 公式の「週間トレンド記事一覧」（https://qiita.com/Qiita/items/b5c1550c969776b65b9b）は週 2 回上書き更新されるため、過去のある週のトレンドを見るには revisions ページで「もっと見る」を繰り返し、目的の版を探してクリックする必要がある。Qiita API v2 には編集履歴を取得するエンドポイントがない（`/api/v2/items/:id/revisions` は 404）。そのため、更新日を一覧から選ぶだけで、その版のプレビューが表示された revisions ページへ直接飛べる手段を用意する。

## What Changes

- revisions ページ（`/Qiita/items/b5c1550c969776b65b9b/revisions?page=N`）に埋め込まれた版一覧データ（更新日時と版 ID）を取得し、データファイルとして保存する取得スクリプトを新設する。取得済みの版は再取得しない（差分取得）。
- 版の更新日（JST）を年・月ごとに一覧表示し、日付を選ぶと `revisions?id=<版ID>` を新しいタブで開く静的 HTML ページを新設する。
- 閲覧者ごとの既読管理を追加する。日付を開くと既読になり、未読に戻すこともできる。「未読のみ」フィルタで絞り込める。
- 既読データのエクスポートとインポートを追加する。JSON ファイルとテキスト（コピー＆貼り付け）の両方に対応し、インポートはマージを既定、上書きを選択肢とする。
- GitHub Actions で週 2 回（木・日 06:00 JST）の定期取得と手動取得を行い、版一覧に差分があればコミットして GitHub Pages に公開する。
- GitHub リポジトリ `qiita_weekly_revisions` の作成、初回 push、Pages の有効化を行うブートストラップスクリプト（`gh` CLI 使用）を追加する。既定ブランチは `main` とする。

## Capabilities

### New Capabilities
- `revision-collection`: Qiita の revisions ページから版一覧（更新日時・版 ID）を取得し、差分をデータファイルに保存する。
- `revision-browser`: 版の更新日を一覧表示し、選んだ日の版がプレビューされた revisions ページへ遷移させる。未読のみフィルタを含む。
- `read-status`: 閲覧者ごとの既読状態の記録・解除と、エクスポート／インポートを扱う。
- `scheduled-publishing`: 定期・手動の版一覧更新と、GitHub Pages への公開を扱う。

### Modified Capabilities
（なし）

## Impact

- 新規ファイル: `scripts/fetch-revisions.mjs`、`scripts/bootstrap.sh`、`site/index.html`、`site/revisions.js`、`.github/workflows/update.yml`、`package.json`（Ultracite による lint・整形用）
- 外部依存: Qiita の revisions ページ HTML 内の埋め込み JSON（非公開の構造であり、予告なく変わる可能性がある）、GitHub Pages、GitHub Actions、`gh` CLI（ユーザーが手動でインストールする）
- Git: 現在のブランチ `master` を `main` に改名し、GitHub に public リポジトリ `qiita_weekly_revisions` を作成する
- 実行時のサーバー側処理・データベースはない。既読データは閲覧者のブラウザ（localStorage）にのみ保存される

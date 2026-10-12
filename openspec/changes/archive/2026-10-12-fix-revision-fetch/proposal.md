## Why

change `add-revision-date-picker` で作った版一覧の取得は、revisions ページが `?page=N` でページを送れるという未検証の前提に立っていた。実際には `?page` は無視され、常に 1 ページ目が返る。そのため全件取得は最終ページに達せず、783 ページ分の空振りが起きた（`docs/post-mortems/2026-10-11-unverified-page-parameter.md`）。

その後の調査で、次のことがわかった。

- 2 ページ目以降は、GraphQL（`POST https://qiita.com/graphql`、`GetArticleRevisions`）でしか取れない。
- この GraphQL はブラウザ以外から呼ぶと `422 CSRF token is invalid` になる。
- revisions ページを開いたブラウザのコンソールからなら呼べる。`per` を大きくすれば、1 リクエストで全 556 件が取れる。

これを踏まえ、正式な仕様に入った誤った取得方法を直す。

## What Changes

- **定期取得を 1 ページ目だけにする。** 取得スクリプトは、revisions ページの HTML（`?page` なし）を 1 回だけ取得し、その 10 件のうち未保存の版を追加する。ページ送り、リクエスト間隔の制御、リトライは廃止する。
- **差分を埋められない場合は中断する。** 1 ページ目に保存済みの版が 1 件もない場合、またはデータファイルがない場合は、0 以外で終了してデータファイルを変更しない。このとき、過去分の取り込み手順を案内する。
- **応答のページ位置を照合する。** 応答の `currentPage` が 1 でなければ中断する（ポストモーテムの対応項目 4）。
- **過去分の取り込み手順を新設する。**
  - revisions ページのコンソールに 1 回貼り付けるスクリプトを用意する。GraphQL で全版を取得し、JSON ファイルとしてダウンロードさせる。
  - Node の取り込みスクリプト（`scripts/import-snapshots.mjs`）を新設する。取得した JSON をデータファイルにマージする。応答が最終ページまで揃っていない（`isLastPage` が `true` でない）場合は取り込まない。
- **取得済みの 556 件を反映する。** `tmp/snapshots.json` から取り込みスクリプトで `site/revisions.js` を作り、公開する。
- **旧 change から引き継いだタスクを行う。** 2.7（データの確認）、4.4（ファイルへのエクスポートの確認）、6.3（`file://` での確認）、6.5（bootstrap と push）、6.6（公開の確認）。
- **ドキュメントを更新する。** ポストモーテムの対応項目の状態を更新し、ADR に取得方法の決定を追加する。

## Capabilities

### New Capabilities
（なし）

### Modified Capabilities
- `revision-collection`: 取得を 1 ページ目だけに改め、ページ送りとリクエスト間隔の要件を削除する。差分を埋められない場合とページ位置が食い違う場合の中断を加え、過去分の取り込みの要件を加える。

## Impact

- 変更するファイル: `scripts/lib/revisions.mjs`、`scripts/fetch-revisions.mjs`、`scripts/revisions.test.mjs`
- 新しく作るファイル: `scripts/import-snapshots.mjs`、`docs/backfill.md`（コンソール用スクリプトと手順）、`site/revisions.js`（556 件）
- 更新するドキュメント: `docs/archtecture-decision-record.md`（ADR を追加）、`docs/post-mortems/2026-10-11-unverified-page-parameter.md`
- 外部依存: revisions ページの HTML（定期取得）。過去分の取り込みに限り、Qiita の非公開 GraphQL を、利用者のブラウザから手作業で呼ぶ。
- `scheduled-publishing` の振る舞いは変わらない。取得失敗時の扱いは、既存の要件「取得失敗時の扱い」のまま。

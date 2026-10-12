## Context

- 動機は proposal.md を、経緯はポストモーテム（`docs/post-mortems/2026-10-11-unverified-page-parameter.md`）を参照する。
- 外部の振る舞いについて確認できた事実を、確認の方法とともに記す。ポストモーテムの対応項目 8 に従い、推測とは書き分ける。

| 事実 | 確認の方法 |
| --- | --- |
| revisions ページの HTML（`?page` なし）には、版一覧の埋め込み JSON が入っている。`pageData` は `{ currentPage: 1, isLastPage: false }` で、版は 10 件 | 探索時に curl で取得して確認 |
| `?page=N` は無視され、常に 1 ページ目が返る | 利用者の実行で、783 ページまで最終ページに達しなかったことで確定 |
| 2 ページ目以降は、GraphQL `POST https://qiita.com/graphql`（`operationName: GetArticleRevisions`、変数 `uuid`・`page`・`per`）で取得される | 利用者が「もっと見る」のリクエストを Network タブで確認 |
| GraphQL をブラウザ以外から呼ぶと、HTTP 422 `CSRF token is invalid` になる | 利用者が Node の `fetch` で確認 |
| revisions ページを開いたブラウザのコンソールから、`<meta name="csrf-token">` の値を `X-CSRF-Token` に付けて呼ぶと、HTTP 200 が返る。`page` は効き、`per=100` で 100 件が返る | 利用者がコンソールで確認（page=1/2、per=10/100） |
| `per` を大きくすると、1 リクエストで全 556 件が返り、`isLastPage: true` になる。最古の版は 2021-06-24T06:13:30Z | 利用者が保存した応答（`tmp/snapshots.json`）で確認 |
| `page=101, per=10` は `items: 0` を返す（範囲外） | 利用者がコンソールで確認。このときの `isLastPage` の値は未確認 |

- **未確認の点：** 範囲外のページの `isLastPage` の値、`per` の上限、`csrf-token` の meta 要素の有無。いずれも、コンソール用スクリプトの停止条件と、トークンの取得に関わる。そのためスクリプトは、これらに頼らずに止まるように作る（D3）。

## Goals / Non-Goals

**Goals:**
- 定期取得（CI）では、CSRF も GraphQL も使わず、確認済みの HTML の 1 ページ目だけを読む。
- 差分を埋められない状況を黙って見過ごさず、必ず失敗として知らせる。
- 過去分の取り込みは、利用者の貼り付け 1 回と、コマンド 1 回で終わるようにする。

**Non-Goals:**
- GraphQL を CI から自動で呼ぶこと（CSRF トークンと Cookie を取得して呼ぶ方式 Y は採らない）。
- 版の本文の取得。

## Decisions

### D1. 定期取得は HTML の 1 ページ目だけにする
- `revisions`（クエリなし）を 1 回取得する。既存の `extractSnapshots` で埋め込み JSON を読み、`currentPage` も返すように拡張する。
- 判定は次の順に行う。
  1. データファイルがない → リクエストを送らずに中断する。
  2. `currentPage !== 1` → 中断する。
  3. 保存済みの版が 1 件もない → 中断する。
  4. 未保存の版を追加する（署名だけ変わった版の ID の置き換えも、既存どおり行う）。
- 中断のメッセージには、取り込み手順（`docs/backfill.md`）の場所を含める。
- `collectRevisions` のページ送り、`MAX_PAGES`、`REQUEST_INTERVAL_MS`、`RETRY_DELAYS_MS` と再試行は削除する。
- タイムアウト（60 秒）は残す。応答がないまま CI ジョブが止まり続けるのを防ぐためである。
- 却下した代替案：
  - 方式 Y（スクリプトが HTML から CSRF トークンと Cookie を取得し、GraphQL を呼ぶ）：CSRF とセッションの仕組みに依存して壊れやすい。非公開の内部 API を、ブラウザのふりをして自動で呼ぶことにもなる。
  - リトライを残す：導入の根拠だったタイムアウトは、手動停止の副作用だった（ポストモーテム）。リクエストは 1 回なので、失敗したら次の定期実行か手動実行でやり直せば足りる。

### D2. 過去分は「コンソールで 1 回貼り付け → 取り込みスクリプト」で取り込む
- **コンソール用スクリプト**（`docs/backfill.md` に掲載し、利用者が revisions ページのコンソールに 1 回貼り付ける）
  - `<meta name="csrf-token">` があればその値を `X-CSRF-Token` に付け、`credentials: "same-origin"` で `/graphql` を呼ぶ。
  - `per=1000` で `page=1` から呼ぶ。
  - すべての応答の配列を `qiita-weekly-revisions-snapshots-YYYYMMDD.json` としてダウンロードさせる。
- **取り込みスクリプト**（`node scripts/import-snapshots.mjs <file>`、`npm run import -- <file>`）
  - 受け付ける形式は、応答オブジェクト 1 つ（`tmp/snapshots.json` の形）か、応答の配列。
  - 検証では次をすべて確かめる。
    - 各要素が `data.article.paginatedSnapshots` の `items` と `pageData` を持つ。
    - `currentPage` が 1 から 1 ずつ増えて連続している。
    - 最後の要素が `isLastPage: true`。
  - 検証に通ったら、既存の `mergeRevisions` でデータファイルにマージする。書き込みは、一時ファイルに書いてから rename する（既存どおり）。

### D3. コンソール用スクリプトの停止条件は、複数の条件で止める
- 範囲外の `isLastPage` の値が未確認なので、`isLastPage === true`、`items.length === 0`、上限ページ数（20 ページ。`per=1000` なら 2 万件）のどれかで止める。
- 応答の `currentPage` が要求したページ番号と一致しなければ、エラーを表示して何もダウンロードしない。
- 最後の応答が `isLastPage: true` でなければ、それでもダウンロードはするが、取り込みスクリプトの完全性の確認で拒否される。
- ページ間は 1 秒空ける。

### D4. 取得済みの 556 件は、取り込みスクリプトで作り直してから commit する
- 現在の `site/revisions.js` は、一回限りのコマンドで作ったものである。取り込みスクリプトを実装したら、`tmp/snapshots.json` から作り直し、内容がバイト単位で一致することを確かめてから commit する。これは取り込みスクリプトのスモークテストも兼ねる。
- `tmp/` は `.gitignore` 済みで、元データは commit しない。
- `site/revisions.js` はスクリプトが生成するデータなので、Oxlint と oxfmt の対象から外す（`ignorePatterns`）。整形で書き換えられると、作り直したときにバイト単位で一致しなくなるためである。

### D5. ドキュメント
- `docs/backfill.md`：取り込みが必要になる状況（CI が「差分を埋められない」で失敗したとき）、コンソール用スクリプト、取り込みコマンド、commit の手順を書く。
- ADR に次の 2 件を追加し、ADR-001・002 のステータスを「一部置き換え済み」にする。
  - ADR-010「定期取得は HTML の 1 ページ目だけにし、過去分は手作業で取り込む」
  - ADR-011「リトライを廃止する」
- ポストモーテムの対応項目 2〜7 の状態を更新する。

## Risks / Trade-offs

- [CI が約 5 週間以上止まり、版が 10 件を超えて増える] → 取得スクリプトが「差分を埋められない」で失敗する。ワークフローの失敗通知で気づき、`docs/backfill.md` の手順で取り込む。
- [Qiita が GraphQL のスキーマや CSRF の仕組みを変える] → 影響を受けるのは手作業の取り込みだけで、定期取得は止まらない。取り込みが必要になったときに、スクリプトを直す。
- [Qiita が revisions ページの HTML の構造を変える] → 既存の要件「版一覧を読み取れない場合の中断」で失敗として知らせる。
- [非公開の GraphQL を手作業で呼ぶ] → 呼ぶのは、利用者のブラウザから、必要なときに数回だけである。ブラウザがふだん送るリクエストと同じ形にする。
- [コンソール用スクリプトを本物の Qiita で試せるのは、利用者だけである] → tasks で、利用者が 1 回試すことを明示する。取り込みスクリプトは、実データ（`tmp/snapshots.json`）で検証する。

## Migration Plan

1. 取得スクリプトの修正と取り込みスクリプトを実装し、テストする。
2. `tmp/snapshots.json` から `site/revisions.js` を作り直して commit する。
3. 利用者がコンソール用スクリプトを 1 回試し、取り込みスクリプトが受け付けることを確かめる。
4. 利用者が `scripts/bootstrap.sh` を実行して公開し、Actions の手動実行で、1 リクエストで「新しい版はありません」または差分の追加になることを確かめる。
5. ロールバック：`site/revisions.js` は git で戻せる。取得スクリプトの不具合で定期実行が失敗しても、公開中のページは前回の状態のまま残る。

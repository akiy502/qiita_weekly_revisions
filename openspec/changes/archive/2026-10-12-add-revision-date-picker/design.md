## Context

- 動機と範囲は proposal.md を、振る舞いは各 spec を参照する。
- リポジトリにはまだアプリケーションコードがなく、OpenSpec と Claude Code の設定だけがある。Git リモートは未設定で、ブランチは `master` である。
- Qiita API v2 には編集履歴のエンドポイントがない。revisions ページの HTML には `data-component-name="ArticleRevisionsIndexPage"` を持つ `<script>` 要素があり、その中（`type="application/json"`）に JSON がそのまま入っている。版一覧はその JSON の `article.paginatedSnapshots.items[]`（`createdAt`、`encryptedId`）にあり、ページ情報は `pageData.isLastPage` にある。1 ページは 10 件である。
- 版のプレビューを開く URL は `/Qiita/items/b5c1550c969776b65b9b/revisions?id=<encodeURIComponent(encryptedId)>` であることを、ユーザーが PC のブラウザで確認済みである。iPhone での表示確認は、ユーザーの判断で省略した。
- `encryptedId` は `<base64("\"ArticleSnapshot-<数値>\"")>--<署名>` という形である。前半を base64 デコードすると版の数値 ID が得られる。
- revisions の HTML は CORS ヘッダーを返さないため、ブラウザからは取得できない。
- 版は JST の木曜と日曜の 05:12 ごろに作られる（例: `2026-10-07T20:12:44Z`、`2026-10-10T20:12:41Z`）。

## Goals / Non-Goals

**Goals:**
- 実行時に依存パッケージを持たない構成にする。取得スクリプトは Node 標準 API だけで動かし、閲覧ページはビルドなしの素の HTML / CSS / JS にする。
- 閲覧ページは GitHub Pages 上でも、ローカルの `file://` でも同じように動くようにする。
- データの更新と公開は GitHub Actions だけで完結させる。

**Non-Goals:**
- 既読状態の端末間での自動同期。手段はエクスポートとインポートに限る。
- 版の本文の取得や、自前のページ内での表示。
- 「週間トレンド記事一覧」以外の記事への対応。
- Terraform などによる宣言的なインフラ管理。

## Decisions

### D1. 版一覧の取得元は revisions ページの埋め込み JSON にする
- `revisions?page=N` を取得し、`ArticleRevisionsIndexPage` の `<script>` 要素の中身を取り出す。中身は HTML 実体参照でエスケープされていない生の JSON なので、そのまま `JSON.parse` する（実体参照を戻すと、本文中の `&amp;` などを壊すため戻さない）。
- 却下した代替案:
  - Qiita API v2: エンドポイントがない。
  - Playwright などのヘッドレスブラウザ: CI が重くなるうえ、必要なデータは HTML に既に入っている。
  - DOM 要素からの抽出: 一覧はクライアント側で描画されるため、取得した HTML には要素がない。

### D2. 版の同一性は数値 snapshot ID で判定する
- `encryptedId` の `--` より前を base64 デコードし、`ArticleSnapshot-(\d+)` の数値を版のキーにする。差分取得、重複の排除、既読管理のすべてでこのキーを使う。
- 理由: 署名部分は Qiita 側の鍵の変更で値が変わり得る（read-status spec の「既読の版 ID 変化への耐性」）。
- デコードできない ID があれば、D1 の「読み取れない」と同じ扱いにして取得を中断する。
- 取得時にキーが一致する版の `encryptedId` が変わっていたら、新しい値で上書きする。遷移 URL は常に最新の署名を使う。

### D3. データファイルは `site/revisions.js` にする
- 形式は `window.REVISIONS = [ { "snapshotId": 16625529, "id": "<encryptedId>", "createdAt": "2026-10-07T20:12:44Z" }, ... ];` とし、更新日時の降順に並べる。整形は `JSON.stringify(list, null, 2)` 相当で固定し、差分がない場合はバイト単位で同一になるようにする。
- 閲覧ページは `<script src="revisions.js">` で読み込む。
- 理由: `file://` では `fetch()` で JSON を読めないが、`<script>` での読み込みなら Pages とローカルの両方で動く。
- 取得スクリプトは既存ファイルから `window.REVISIONS = ` と末尾の `;` を除いた部分を `JSON.parse` して読む。
- 書き込みは一時ファイルに書いてから rename する。失敗時に既存ファイルを壊さないためである。

### D4. 差分取得の停止条件
- `page=1` から順に取得し、ページ内に既知の snapshotId が 1 つでもあれば、そのページの未知の版だけを追加して停止する。既知の版がなければ、`isLastPage === true` になるまで続ける。
- 1 リクエストのタイムアウトは 60 秒とする（応答のないまま CI ジョブが止まり続けるのを防ぐ）。タイムアウトと通信エラーのときは 5 秒・10 秒・20 秒の間隔で最大 3 回再試行し、それでも失敗したら通信失敗として扱う。初回の全件取得は 470 ページを超え、1 回の遅延で全体がやり直しになるためである。HTTP ステータスのエラー（503 など）は再試行せず、すぐに失敗とする。CLI は取得中のページ番号を stderr に出す。
- リクエストは直列にし、各リクエストの開始から次の開始まで 1 秒以上空ける。User-Agent にはリポジトリ URL を含める。
- 新しい版がなければファイルに書き込まない。

### D5. 閲覧ページは `site/index.html` と `site/app.js` にする
- マークアップとスタイルは `index.html`、スクリプトは `app.js` に置く。Oxlint は HTML 内のスクリプトを検査できないためである。`file://` ではモジュールスクリプトを読み込めないので、`app.js` は `type="module"` を付けない通常のスクリプトにする。
- フレームワークは使わない。描画は `REVISIONS` を JST の年・月でまとめて DOM を作るだけである。JST の変換は `Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo" })` を使う。
- 各版は `<a href=… target="_blank" rel="noopener">` で表示する。`click` と `auxclick`（中クリック）で既読を記録する。リンクにしておくことで、長押しメニューや新しいタブでも開ける。
- 既読の版には「✓」の記号と「既読」の視覚的ラベルを付ける。あわせて「未読に戻す」ボタンを表示する。
- 却下した代替案: React や Vite などの導入。ビルド工程と依存の更新が要るのに、得られるものがない。

### D6. 既読データは localStorage に保存する
- キー `qiita-weekly-revisions:read` に `{ "<snapshotId>": "<既読にした ISO 日時>" }` を保存する。キー `qiita-weekly-revisions:unread-only` には `"1"` か `"0"` を保存する。
- `file://` では全ページが同じオリジンになるため、プレフィックスで衝突を避ける。
- 読み書きはすべて try/catch で包む。失敗したら既読を保存できない旨のメッセージを表示し、メモリ上だけで動かす。

### D7. エクスポートとインポートの形式
- 形式は `{ "app": "qiita-weekly-revisions", "version": 1, "exportedAt": "<ISO>", "read": { "<snapshotId>": "<ISO>" } }` とする。
- ファイルへのエクスポートは Blob と `<a download>` で `qiita-weekly-revisions-read-YYYYMMDD.json` を保存させる。iOS Safari では「ファイル」App に保存される。
- テキストでのコピーには `navigator.clipboard.writeText` を使う。使えない環境（`file://` など）では、選択済みのテキストエリアに JSON を表示する。
- インポートは、`<input type="file" accept="application/json,.json">` かテキストエリアへの貼り付けで受け付ける。方法はラジオボタンで選び、初期値はマージにする。上書きは `confirm()` で確認する。
- 検証では次をすべて満たすことを確かめる: `app` が一致する、`version === 1`、`read` がオブジェクトである、全キーが数字だけの文字列である、全値が `Date.parse` できる文字列である。1 つでも満たさなければ拒否し、何も変更しない。
- マージで同じキーがある場合は、既存の値を残す。

### D8. ワークフローは `update.yml` の 1 本にする
- トリガー:
  - `schedule: cron "0 21 * * 3,6"`（UTC の水・土 21:00 = JST の木・日 06:00）
  - `workflow_dispatch`
  - `push`（`branches: [main]`）
- ジョブ `fetch`: schedule と workflow_dispatch のときだけ動く（`permissions: contents: write`）。checkout、Node のセットアップ、`node scripts/fetch-revisions.mjs` の実行を行う。`git diff --quiet site/revisions.js` で差分を確かめ、差分があれば commit して push し、出力 `changed=true` を返す。
- ジョブ `deploy`（`needs: fetch`。`permissions: pages: write, id-token: write`）は、次のどちらかのときに動く:
  - `fetch` が成功し、かつ `changed == 'true'` のとき
  - イベントが `push` で、`fetch` がスキップされたとき
- `deploy` は `main` の最新を checkout し、`site/` を Pages 用の成果物としてアップロードしてデプロイする。
- `concurrency: group: pages, cancel-in-progress: false` を付ける。
- 1 本にまとめる理由: `GITHUB_TOKEN` による push では、別のワークフローの `on: push` が発火しない。そのため、取得からデプロイまでを同じ実行の中でつなぐ必要がある。同じ理由で、bot の commit による無限ループも起きない。
- 使う action のバージョンと入力は、実装時に `find-docs` で確認する。

### D9. ブートストラップは `scripts/bootstrap.sh`（gh CLI）にする
- 前提: `gh` がインストール済みで、`gh auth login` 済みであること。
- 手順は次のとおり。どの段階も「既にあれば何もしない」ように書き、再実行できるようにする:
  1. 現在のブランチが `master` なら `main` に改名する。
  2. `gh repo view <owner>/qiita_weekly_revisions` で存在を確かめる。なければ `gh repo create qiita_weekly_revisions --public` で作成し、`origin` がなければ追加する。
  3. `gh api repos/<owner>/qiita_weekly_revisions/pages` で状態を確かめる。未設定なら `POST`（`build_type=workflow`）、設定済みで種類が違えば `PUT` を送る。
  4. `git push -u origin main` を実行する。Pages を有効にする前に push すると、`update.yml` のデプロイが失敗するため、push は最後に行う。
- 未コミットの変更がある場合は、push 前に警告して中断する。
- 却下した代替案: Terraform。個人用の 1 リポジトリでは、state と PAT の管理の手間が見合わない。

### D10. lint と整形
- ルートに `package.json` を置き、Ultracite を devDependency にする。`npx ultracite check` と `fix` で JS と HTML 内のスクリプトを検査する。実行時の依存は持たない。

## Risks / Trade-offs

- **[既知の不具合] `?page=N` は Qiita に無視され、常に 1 ページ目が返る。** そのため D1・D4 の全件取得は最終ページに達せず、完了しない（783 ページまで達しないことを確認）。D1・D4 と spec `revision-collection` の「版一覧の取得」は、この誤った前提に基づいている。経緯は `docs/post-mortems/2026-10-11-unverified-page-parameter.md` を参照。修正は change `fix-revision-fetch` で行う。それまでは `npm run fetch` と `scripts/bootstrap.sh` を実行しない。
- [Qiita の HTML 構造が変わり、取得が失敗する] → 取得スクリプトは失敗時に 0 以外で終了し、データファイルを変更しない。ワークフローは失敗として通知され、公開中のページは前回の状態のまま残る。
- [GitHub の schedule は遅れたり、実行がとばされたりすることがある] → 版は消えないので、次の実行か手動実行で差分を取り戻せる。
- [public リポジトリでは、60 日間活動がないと schedule が自動で無効化される] → 版は週 2 回増え、そのたびに commit されるため、通常は該当しない。無効化されたら、Actions 画面から再度有効にする。
- [Safari の ITP は、7 日間開かれなかったサイトの localStorage を消す] → ホーム画面に追加して使うと対象外になる。エクスポートでバックアップもできる。README などには書かず、閲覧ページのエクスポート欄に短い注記を置く。
- [Qiita への定期アクセス] → 週 2 回、差分のみで通常は 1 リクエストである。間隔を 1 秒以上空け、User-Agent で連絡先を示す。
- [作業ディレクトリに、追跡されていないドットファイル（`.bashrc`、`.gitconfig` など）がある] → `bootstrap.sh` は commit 済みの内容だけを push する。tasks で push 前に `git ls-files` を確認する。

## Migration Plan

※ 既知の不具合（Risks の先頭を参照）のため、以下の手順 2 以降は、この change では実施しない。change `fix-revision-fetch` で取得を直した後に実施する。

1. ユーザーが `gh` をインストールし、`gh auth login` を実行する。
2. 実装を commit し、ユーザーが `scripts/bootstrap.sh` を実行する。これでリポジトリの作成、push、Pages の有効化が行われる。
3. `main` への push で `update.yml` がデプロイを実行する。初回のデータは、ローカルで取得スクリプトを実行して commit しておくか、push 後に `workflow_dispatch` で取得する。
4. ロールバック: Pages は直前の commit を再 push すれば戻る。サイト全体を止めるときは、GitHub の設定で Pages を無効にする。

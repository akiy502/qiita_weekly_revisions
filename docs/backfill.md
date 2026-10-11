# 過去分の版の取り込み

定期取得（`npm run fetch` と、GitHub Actions の `update` ワークフロー）は、revisions ページの 1 ページ目（最新 10 件）だけを読む。2 ページ目以降は、ブラウザ以外からは取得できないためである。Qiita の GraphQL が CSRF トークンを要求する。

1 ページ目だけでは差分を埋められないときは、この手順で過去分を取り込む。

## 取り込みが必要になるとき

- 取得スクリプトが次のどちらかのメッセージで失敗したとき。
  - `1 ページ目に保存済みの版がなく、差分を埋められません`：定期取得が止まっている間に、版が 10 件を超えて増えた（週 2 回の更新で約 5 週間）。
  - `データファイル … がありません`：`site/revisions.js` がない。
- `site/revisions.js` を作り直したいとき。

## 1. ブラウザで全版を取得する（貼り付けは 1 回）

1. ブラウザで https://qiita.com/Qiita/items/b5c1550c969776b65b9b/revisions を開く。
2. 開発者ツールを開き（F12、Mac は ⌥⌘I）、「Console」タブを選ぶ。
3. 次のスクリプトを貼り付けて Enter を押す。Chrome で貼り付けを止められたときは、先に `allow pasting` と入力する。

```js
(async () => {
  const PER = 1000;
  const MAX_PAGES = 20;
  const token = document.querySelector('meta[name="csrf-token"]')?.content;
  const query = `query GetArticleRevisions($uuid: String!, $page: Int, $per: Int) {
    article(uuid: $uuid) { paginatedSnapshots(per: $per, page: $page) {
      items { createdAt encryptedId } pageData { currentPage isLastPage } } } }`;
  const responses = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await fetch("/graphql", {
      body: JSON.stringify({
        operationName: "GetArticleRevisions",
        query,
        variables: { page, per: PER, uuid: "b5c1550c969776b65b9b" },
      }),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(token ? { "X-CSRF-Token": token } : {}) },
      method: "POST",
    });
    const data = await res.json().catch(() => null);
    const snapshots = data?.data?.article?.paginatedSnapshots;
    if (!res.ok || !snapshots) {
      console.error(`page=${page} の取得に失敗しました（HTTP ${res.status}）`, data?.errors ?? data);
      return;
    }
    if (snapshots.pageData.currentPage !== page) {
      console.error(`page=${page} を要求しましたが、${snapshots.pageData.currentPage} ページ目が返りました。中断します`);
      return;
    }
    if (snapshots.items.length === 0) {
      break;
    }
    responses.push(data);
    console.log(`page=${page}: ${snapshots.items.length} 件`);
    if (snapshots.pageData.isLastPage) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const blob = new Blob([JSON.stringify(responses, null, 2)], { type: "application/json" });
  const link = Object.assign(document.createElement("a"), {
    download: `qiita-weekly-revisions-snapshots-${date}.json`,
    href: URL.createObjectURL(blob),
  });
  link.click();
  const total = responses.reduce((sum, r) => sum + r.data.article.paginatedSnapshots.items.length, 0);
  console.log(`合計 ${total} 件をダウンロードしました`);
})();
```

4. `qiita-weekly-revisions-snapshots-YYYYMMDD.json` がダウンロードされる。

スクリプトは、最終ページ（`isLastPage: true`）か、版が 0 件のページに達すると止まる。応答のページ番号が要求と食い違ったときは、何もダウンロードせずに止まる。読み取るだけで、Qiita 上のデータは変更しない。

## 2. 取り込む

ダウンロードしたファイルをリポジトリの `tmp/` に置き（`tmp/` は commit されない）、取り込みスクリプトを実行する。

```bash
npm run import -- tmp/qiita-weekly-revisions-snapshots-YYYYMMDD.json
```

- 既存の `site/revisions.js` に、まだない版だけが追加される。ファイルがなければ新しく作られる。
- 応答が最終ページまで揃っていない場合や、エラー応答の場合は取り込まず、`site/revisions.js` も変更しない。

## 3. commit して公開する

```bash
git add site/revisions.js
git commit -m "chore: backfill revisions"
git push
```

`main` への push で `update` ワークフローがデプロイを行う。次回からの定期取得は、1 ページ目だけで差分を追えるようになる。

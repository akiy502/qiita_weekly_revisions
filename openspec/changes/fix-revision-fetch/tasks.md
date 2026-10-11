## 1. 定期取得の修正（revision-collection）

- [ ] 1.1 `extractSnapshots` が `pageData.currentPage` も返すようにし、`currentPage` が数値でなければ読み取れない場合として扱う（D1）
- [ ] 1.2 `collectRevisions` のページ送り、`MAX_PAGES`、`REQUEST_INTERVAL_MS`、`RETRY_DELAYS_MS` と再試行を削除し、1 回の取得に置き換える。タイムアウト（60 秒）は残す（D1）
- [ ] 1.3 `updateDataFile` に判定を加える：データファイルがなければリクエストせずに中断、`currentPage !== 1` なら中断、保存済みの版が 1 件もなければ中断。中断時のメッセージに `docs/backfill.md` を含める（D1）
- [ ] 1.4 `scripts/revisions.test.mjs` を新しい spec に合わせて書き直す。対象は、1 回のリクエストで終わる、新しい版だけが追加される、差分なしで無変更、データファイルがないとリクエスト 0 回で中断、差分を埋められないと中断、`currentPage` が 2 なら中断、構造変化、HTTP 503、署名の置き換え、CLI の終了コード

## 2. 過去分の取り込み（revision-collection）

- [ ] 2.1 `scripts/import-snapshots.mjs` と、検証・変換を行うライブラリ関数を実装する。応答 1 つと応答の配列を受け付け、`currentPage` の連続と最後の `isLastPage: true` を確かめてマージする（D2）
- [ ] 2.2 `package.json` に `import` スクリプトを追加する
- [ ] 2.3 取り込みのテストを書く。対象は、全版の取り込み、既存への追加、重なった版の一意化、最終ページまで揃っていない場合の拒否、`currentPage` が飛んでいる場合の拒否、エラー応答の拒否、拒否時にデータファイルが変わらないこと
- [ ] 2.4 `docs/backfill.md` に、取り込みが必要になる状況、コンソール用スクリプト（D2・D3 の停止条件と照合を含む）、取り込みと commit の手順を書く

## 3. データの反映

- [ ] 3.1 `npm run import -- tmp/snapshots.json` で `site/revisions.js` を作り直し、一回限りのコマンドで作った現在の内容とバイト単位で一致することを確かめる（D4）
- [ ] 3.2 （旧 2.7）`site/revisions.js` の件数（556）、最新（2026-10-10T20:12:41Z）、最古（2021-06-24T06:13:30Z）、日付の途切れがないことを確かめる
- [ ] 3.3 （ユーザー作業）revisions ページのコンソールに `docs/backfill.md` のスクリプトを 1 回貼り付けて実行し、ダウンロードしたファイルを `npm run import` が受け付けること（新しい版がなければ件数が変わらないこと）を確かめる

## 4. 検証

- [ ] 4.1 `npm run check` と `npm test` を通す
- [ ] 4.2 （旧 4.4、ユーザー作業）`site/index.html` で「ファイルにエクスポート」を実行し、既読データの JSON ファイルがダウンロードされることを確かめる
- [ ] 4.3 （旧 6.3、ユーザー作業）ローカルの `file://` で `site/index.html` を開き、556 件の一覧の表示、遷移、既読、フィルタ、エクスポートとインポートを確かめる

## 5. ドキュメント

- [ ] 5.1 ADR に ADR-010（定期取得は HTML の 1 ページ目だけにし、過去分は手作業で取り込む）と ADR-011（リトライの廃止）を追加し、ADR-001・002 のステータスを「一部置き換え済み」にする（D5）
- [ ] 5.2 ポストモーテムの対応項目 2〜7 の状態を更新する（D5）

## 6. 公開

- [ ] 6.1 （旧 6.5、ユーザー作業）変更を commit し、`scripts/bootstrap.sh` を実行してリポジトリの作成、push、Pages の有効化を行う
- [ ] 6.2 （旧 6.6、ユーザー作業）Actions 画面から `update.yml` を手動実行し、取得が 1 リクエストで成功すること、`https://<user>.github.io/qiita_weekly_revisions/` に 556 件以上の一覧が表示されることを確かめる

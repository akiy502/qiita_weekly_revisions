## 1. 準備

- [x] 1.1 （ユーザー作業）`gh` CLI をインストールし、`gh auth login` で GitHub にログインする。`gh auth status` でログイン済みと表示されることを確認する
- [x] 1.2 ルートに `package.json` を作り（`"type": "module"`、Node 22 以上）、Ultracite を devDependency として導入する。`npx ultracite check` が動くことを確認する
- [x] 1.3 `site/`、`scripts/`、`.github/workflows/` を作成する

## 2. 版一覧の取得（revision-collection）

- [x] 2.1 `scripts/fetch-revisions.mjs` に、revisions ページの HTML から `ArticleRevisionsIndexPage` の埋め込み JSON を取り出して解析する処理を実装する（D1）
- [x] 2.2 `encryptedId` から数値 snapshotId を取り出す処理を実装する。デコードできなければ中断する（D2）
- [x] 2.3 既存の `site/revisions.js` の読み込みと、一時ファイル経由の書き込み（降順、重複排除、固定の整形）を実装する（D3）
- [x] 2.4 `page=1` からの直列取得、既知の版に当たったら停止、`isLastPage` で停止、1 秒以上の間隔、User-Agent の設定を実装する（D4）
- [x] 2.5 HTTP ステータスが 200 以外、通信失敗、埋め込みデータなしの各場合に、0 以外で終了してファイルを変更しないことを実装する
- [x] 2.6 保存した HTML を入力にしたテスト（`node --test`）を書き、spec の各シナリオを検証する。対象は初回取得、最終ページでの停止、差分取得、差分なしでの無変更、重複排除、構造変化、HTTP 503
- [ ] 2.7 実際に取得スクリプトを実行して `site/revisions.js` を生成し、件数と先頭・末尾の日付が revisions ページと一致することを確認する

## 3. 閲覧ページ（revision-browser）

- [x] 3.1 `site/index.html` と `site/app.js` に、`revisions.js` を読み込み、JST の年・月でまとめて新しい順に日付と曜日を描画する処理を実装する（D5）
- [x] 3.2 各日付を `revisions?id=<encodeURIComponent(id)>` へのリンク（新しいタブで開く）にする
- [x] 3.3 版が 0 件のときに「表示できる版がありません」と表示する
- [x] 3.4 幅 375px で横スクロールが出ないレイアウトにし、ダークモードにも対応させる

## 4. 既読管理（read-status）

- [x] 4.1 localStorage の読み書き層を、try/catch と、使えないときのメッセージ表示付きで実装する（D6）
- [x] 4.2 `click` と `auxclick` での既読記録、記号と文言による既読表示、「未読に戻す」ボタンを実装する
- [x] 4.3 「未読のみ」フィルタと、その状態の保持を実装する
- [ ] 4.4 ファイルへのエクスポートと、テキストでのコピー（クリップボードが使えないときはテキストエリアに表示）を実装する（D7）
- [x] 4.5 ファイル選択とテキスト貼り付けによるインポートを実装する。形式の検証、マージ（既定）、確認付きの上書き、不正データ時のエラー表示を含める
- [x] 4.6 エクスポート欄に、Safari で 7 日開かないと既読が消えることと、ホーム画面に追加すると回避できることの短い注記を置く

## 5. 自動更新と公開（scheduled-publishing）

- [x] 5.1 `find-docs` で `actions/checkout`、`actions/setup-node`、`actions/configure-pages`、`actions/upload-pages-artifact`、`actions/deploy-pages` の最新バージョンと入力を確認する
- [x] 5.2 `.github/workflows/update.yml` を作成する。内容は schedule（`0 21 * * 3,6`）、`workflow_dispatch`、`push: main` のトリガー、`fetch` ジョブ（差分時のみ commit と push、`changed` の出力）、`deploy` ジョブ（実行条件は D8 のとおり）、`concurrency` の設定（D8）
- [x] 5.3 `scripts/bootstrap.sh` を作成する。内容は、ブランチを `main` に改名、リポジトリ `qiita_weekly_revisions` を作成して push、Pages を有効化（`build_type=workflow`）。どの段階も再実行できるようにし、未コミットの変更があれば中断する（D9）

## 6. 検証と公開

- [x] 6.1 `npx ultracite check` を通す。JS と `index.html` 内のスクリプトが対象
- [x] 6.2 `web-design-guidelines` スキルで `site/index.html` をレビューし、指摘に対応する
- [ ] 6.3 ローカルの `file://` で `site/index.html` を開き、一覧の表示、遷移、既読、フィルタ、エクスポートとインポートを確認する
- [x] 6.4 `git ls-files` で、公開してよいファイルだけが追跡されていることを確認する。`.env` やドットファイル類が含まれていないこと
- [ ] 6.5 （ユーザー作業）変更を commit し、`scripts/bootstrap.sh` を実行してリポジトリの作成、push、Pages の有効化を行う
- [ ] 6.6 （ユーザー作業）Actions 画面から `update.yml` を手動実行し、成功すること、`https://<user>.github.io/qiita_weekly_revisions/` に一覧が表示されることを確認する

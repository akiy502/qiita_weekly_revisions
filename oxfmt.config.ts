import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  // site/revisions.js は取り込み・取得スクリプトが生成するデータなので整形しない
  ignorePatterns: [...ultracite.ignorePatterns, "site/revisions.js"],
});

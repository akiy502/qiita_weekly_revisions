import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";

export default defineConfig({
  extends: [core],
  // site/revisions.js は取り込み・取得スクリプトが生成するデータなので検査しない
  ignorePatterns: [...core.ignorePatterns, "site/revisions.js"],
});

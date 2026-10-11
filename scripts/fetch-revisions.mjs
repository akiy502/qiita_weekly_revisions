import { fileURLToPath } from "node:url";

import { createPageFetcher, updateDataFile } from "./lib/revisions.mjs";

const dataPath = fileURLToPath(
  new URL("../site/revisions.js", import.meta.url)
);
const repository = process.env.GITHUB_REPOSITORY ?? "qiita_weekly_revisions";
const userAgent = `qiita_weekly_revisions (+https://github.com/${repository})`;

try {
  const result = await updateDataFile({
    dataPath,
    fetchPage: createPageFetcher({ userAgent }),
  });
  const summary = result.written
    ? `${result.added} 件の新しい版を追加しました（合計 ${result.total} 件）`
    : `新しい版はありません（合計 ${result.total} 件）`;
  process.stdout.write(`${summary}\n`);
} catch (error) {
  process.stderr.write(`版一覧の取得に失敗しました: ${error.message}\n`);
  process.exitCode = 1;
}

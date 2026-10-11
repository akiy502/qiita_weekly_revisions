// GraphQL GetArticleRevisions の応答を保存した JSON を、site/revisions.js に取り込む。
// 使い方: npm run import -- <JSON ファイル>（手順は docs/backfill.md）
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { importIntoDataFile } from "./lib/revisions.mjs";

const dataPath = fileURLToPath(
  new URL("../site/revisions.js", import.meta.url)
);
const [inputPath] = process.argv.slice(2);

try {
  if (!inputPath) {
    throw new Error(
      "取り込む JSON ファイルを指定してください（例: npm run import -- tmp/snapshots.json）"
    );
  }
  let responses;
  try {
    responses = JSON.parse(await readFile(inputPath, "utf-8"));
  } catch (error) {
    throw new Error(
      `${inputPath} を JSON として読み込めません (${error.message})`,
      { cause: error }
    );
  }
  const result = await importIntoDataFile({ dataPath, responses });
  const summary = result.written
    ? `${result.added} 件の新しい版を取り込みました（合計 ${result.total} 件）`
    : `変更はありません（合計 ${result.total} 件）`;
  process.stdout.write(`${summary}\n`);
} catch (error) {
  process.stderr.write(`取り込みに失敗しました: ${error.message}\n`);
  process.exitCode = 1;
}

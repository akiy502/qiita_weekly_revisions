import { readFile, rename, writeFile } from "node:fs/promises";

export const ARTICLE_URL = "https://qiita.com/Qiita/items/b5c1550c969776b65b9b";
export const REVISIONS_URL = `${ARTICLE_URL}/revisions`;
export const REQUEST_TIMEOUT_MS = 60_000;
export const BACKFILL_GUIDE = "docs/backfill.md";

const DATA_PREFIX = "window.REVISIONS = ";
const DATA_SUFFIX = ";\n";
const EMBEDDED_JSON_PATTERN =
  /<script\b[^>]*\bdata-component-name="ArticleRevisionsIndexPage"[^>]*>(?<json>[\s\S]*?)<\/script>/u;
const SNAPSHOT_KEY_PATTERN = /^"ArticleSnapshot-(?<id>\d+)"$/u;

/**
 * 版一覧を取得・解析・取り込みできないときのエラー。
 * `kind` は次のいずれか。
 * - "parse": 版一覧データを読み取れない
 * - "fetch": revisions ページを取得できない
 * - "missing": データファイルがない
 * - "gap": 1 ページ目に保存済みの版がなく、差分を埋められない
 * - "incomplete": 取り込むデータが最終ページまで揃っていない
 */
export class RevisionError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = "RevisionError";
    this.kind = kind;
  }
}

const parseError = (message) => new RevisionError("parse", message);
const fetchError = (message) => new RevisionError("fetch", message);

/**
 * encryptedId の `--` より前を base64 デコードし、数値の snapshot ID を返す。
 * @param {string} encryptedId Qiita の版 ID
 * @returns {number} 数値の snapshot ID
 */
export const snapshotIdOf = (encryptedId) => {
  const [payload] = encryptedId.split("--");
  const decoded = Buffer.from(payload, "base64").toString("utf-8");
  const match = SNAPSHOT_KEY_PATTERN.exec(decoded);
  if (!match) {
    throw parseError(`版 ID をデコードできません: ${encryptedId}`);
  }
  return Number(match.groups.id);
};

/**
 * `paginatedSnapshots` の形をした値を検証し、版一覧とページ情報に変換する。
 * HTML の埋め込みデータと GraphQL の応答で共通の形である。
 * @param {unknown} snapshots `article.paginatedSnapshots` の値
 * @returns {{ items: { snapshotId: number, id: string, createdAt: string }[], currentPage: number, isLastPage: boolean }} 版一覧とページ情報
 */
const parsePaginatedSnapshots = (snapshots) => {
  const pageData = snapshots?.pageData;
  if (
    !(
      Array.isArray(snapshots?.items) &&
      Number.isInteger(pageData?.currentPage) &&
      typeof pageData?.isLastPage === "boolean"
    )
  ) {
    throw parseError("版一覧データの構造が想定と異なります");
  }

  const items = snapshots.items.map((item) => {
    const { createdAt, encryptedId } = item ?? {};
    if (
      typeof encryptedId !== "string" ||
      typeof createdAt !== "string" ||
      Number.isNaN(Date.parse(createdAt))
    ) {
      throw parseError("版の更新日時または版 ID を読み取れません");
    }
    return {
      createdAt,
      id: encryptedId,
      snapshotId: snapshotIdOf(encryptedId),
    };
  });

  return {
    currentPage: pageData.currentPage,
    isLastPage: pageData.isLastPage,
    items,
  };
};

/**
 * revisions ページの HTML から、そのページの版一覧とページ情報を取り出す。
 * @param {string} html revisions ページの HTML
 * @returns {{ items: { snapshotId: number, id: string, createdAt: string }[], currentPage: number, isLastPage: boolean }} 版一覧とページ情報
 */
export const extractSnapshots = (html) => {
  const match = EMBEDDED_JSON_PATTERN.exec(html);
  if (!match) {
    throw parseError("版一覧データが埋め込まれていません");
  }

  let props;
  try {
    props = JSON.parse(match.groups.json);
  } catch {
    throw parseError("版一覧データを JSON として解析できません");
  }

  return parsePaginatedSnapshots(props?.article?.paginatedSnapshots);
};

/**
 * GraphQL `GetArticleRevisions` の応答（1 つ、または配列）を検証し、全版を返す。
 * 1 ページ目から最終ページまでが連続して揃っていなければ拒否する。
 * @param {unknown} data 応答オブジェクト、または応答の配列
 * @returns {{ snapshotId: number, id: string, createdAt: string }[]} 全ページの版
 */
export const parseSnapshotResponses = (data) => {
  const responses = Array.isArray(data) ? data : [data];
  if (responses.length === 0) {
    throw parseError("取り込むデータが空です");
  }

  const pages = responses.map((response) => {
    if (response?.errors) {
      throw parseError(
        `エラー応答は取り込めません: ${JSON.stringify(response.errors)}`
      );
    }
    return parsePaginatedSnapshots(response?.data?.article?.paginatedSnapshots);
  });

  for (const [index, page] of pages.entries()) {
    if (page.currentPage !== index + 1) {
      throw new RevisionError(
        "incomplete",
        `${index + 1} 番目の応答のページ番号が ${page.currentPage} です。1 ページ目から連続している必要があります`
      );
    }
  }
  if (!pages.at(-1).isLastPage) {
    throw new RevisionError(
      "incomplete",
      "最後の応答が最終ページではありません（isLastPage が true ではありません）"
    );
  }

  return pages.flatMap((page) => page.items);
};

/**
 * 既存の版一覧に取得した版をマージし、更新日時の降順・snapshot ID で一意にして返す。
 * 同じ snapshot ID の版 ID が変わっていれば新しい値で置き換える。
 */
export const mergeRevisions = (existing, fetched) => {
  const bySnapshot = new Map(
    existing.map((revision) => [revision.snapshotId, revision])
  );
  for (const revision of fetched) {
    bySnapshot.set(revision.snapshotId, revision);
  }
  return [...bySnapshot.values()].toSorted(
    (a, b) =>
      Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      b.snapshotId - a.snapshotId
  );
};

/** データファイルの内容を版一覧に変換する。 */
export const parseDataFile = (text) => {
  if (!(text.startsWith(DATA_PREFIX) && text.trimEnd().endsWith(";"))) {
    throw parseError("データファイルの形式が想定と異なります");
  }
  const json = text.slice(DATA_PREFIX.length, text.trimEnd().length - 1);
  const list = JSON.parse(json);
  if (!Array.isArray(list)) {
    throw parseError("データファイルの版一覧が配列ではありません");
  }
  return list;
};

/** 版一覧をデータファイルの内容に変換する。 */
export const serializeDataFile = (list) =>
  `${DATA_PREFIX}${JSON.stringify(
    list.map(({ snapshotId, id, createdAt }) => ({
      createdAt,
      id,
      snapshotId,
    })),
    null,
    2
  )}${DATA_SUFFIX}`;

/** qiita.com から revisions ページ（クエリなし）を 1 回取得する関数を作る。 */
export const createPageFetcher =
  ({ fetchImpl = fetch, userAgent }) =>
  async () => {
    let response;
    let body;
    try {
      response = await fetchImpl(REVISIONS_URL, {
        headers: { "User-Agent": userAgent },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      body = response.status === 200 ? await response.text() : undefined;
    } catch (error) {
      throw fetchError(
        `取得に失敗しました: ${REVISIONS_URL} (${error.message})`
      );
    }
    if (response.status !== 200) {
      throw fetchError(
        `HTTP ${response.status} が返りました: ${REVISIONS_URL}`
      );
    }
    return body;
  };

const readExisting = async (dataPath) => {
  try {
    return await readFile(dataPath, "utf-8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }
};

const writeAtomically = async (dataPath, text) => {
  const tempPath = `${dataPath}.tmp`;
  await writeFile(tempPath, text, "utf-8");
  await rename(tempPath, dataPath);
};

/** 既存の版一覧に対して、取得した版のうち新しい件数・保存済みの件数と、署名だけ変わった版があるかを数える。 */
const diffAgainst = (existing, fetched) => {
  const knownById = new Map(
    existing.map((revision) => [revision.snapshotId, revision.id])
  );
  return {
    added: fetched.filter((revision) => !knownById.has(revision.snapshotId))
      .length,
    knownCount: fetched.filter((revision) => knownById.has(revision.snapshotId))
      .length,
    renewed: fetched.some(
      (revision) =>
        knownById.has(revision.snapshotId) &&
        knownById.get(revision.snapshotId) !== revision.id
    ),
  };
};

/**
 * データファイルを読み、revisions ページの 1 ページ目を取得して新しい版を追加する。
 * 失敗したときはデータファイルを変更せずに例外を投げる。
 * @returns {Promise<{ added: number, total: number, written: boolean }>} 追加した件数、合計件数、書き込んだかどうか
 */
export const updateDataFile = async ({ dataPath, fetchPage }) => {
  const existingText = await readExisting(dataPath);
  if (existingText === undefined) {
    throw new RevisionError(
      "missing",
      `データファイル ${dataPath} がありません。${BACKFILL_GUIDE} の手順で過去分を取り込んでください`
    );
  }
  const existing = parseDataFile(existingText);

  const { items, currentPage } = extractSnapshots(await fetchPage());
  if (currentPage !== 1) {
    throw parseError(
      `1 ページ目を要求しましたが、${currentPage} ページ目が返りました`
    );
  }

  const { added, knownCount, renewed } = diffAgainst(existing, items);
  if (knownCount === 0) {
    throw new RevisionError(
      "gap",
      `1 ページ目に保存済みの版がなく、差分を埋められません。${BACKFILL_GUIDE} の手順で過去分を取り込んでください`
    );
  }
  if (added === 0 && !renewed) {
    return { added, total: existing.length, written: false };
  }

  const merged = mergeRevisions(existing, items);
  await writeAtomically(dataPath, serializeDataFile(merged));
  return { added, total: merged.length, written: true };
};

/**
 * GraphQL の応答から取り出した全版を、データファイルにマージする。
 * データファイルがなければ新しく作る。内容が変わらなければ書き込まない。
 * @returns {Promise<{ added: number, total: number, written: boolean }>} 追加した件数、合計件数、書き込んだかどうか
 */
export const importIntoDataFile = async ({ dataPath, responses }) => {
  const imported = parseSnapshotResponses(responses);
  const existingText = await readExisting(dataPath);
  const existing =
    existingText === undefined ? [] : parseDataFile(existingText);

  const merged = mergeRevisions(existing, imported);
  const text = serializeDataFile(merged);
  const { added } = diffAgainst(existing, imported);
  if (text === existingText) {
    return { added, total: merged.length, written: false };
  }

  await writeAtomically(dataPath, text);
  return { added, total: merged.length, written: true };
};

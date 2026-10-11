import { readFile, rename, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

export const ARTICLE_URL = "https://qiita.com/Qiita/items/b5c1550c969776b65b9b";
export const REVISIONS_URL = `${ARTICLE_URL}/revisions`;
export const REQUEST_INTERVAL_MS = 1000;
export const MAX_PAGES = 1000;
export const REQUEST_TIMEOUT_MS = 30_000;

const DATA_PREFIX = "window.REVISIONS = ";
const DATA_SUFFIX = ";\n";
const EMBEDDED_JSON_PATTERN =
  /<script\b[^>]*\bdata-component-name="ArticleRevisionsIndexPage"[^>]*>(?<json>[\s\S]*?)<\/script>/u;
const SNAPSHOT_KEY_PATTERN = /^"ArticleSnapshot-(?<id>\d+)"$/u;

/**
 * 版一覧を取得・解析できないときのエラー。
 * `kind` は、読み取れない場合が "parse"、取得できない場合が "fetch"。
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
 * revisions ページの HTML から、そのページの版一覧と最終ページかどうかを取り出す。
 * @param {string} html revisions ページの HTML
 * @returns {{ items: { snapshotId: number, id: string, createdAt: string }[], isLastPage: boolean }} そのページの版一覧と最終ページかどうか
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

  const snapshots = props?.article?.paginatedSnapshots;
  if (
    !(
      Array.isArray(snapshots?.items) &&
      typeof snapshots?.pageData?.isLastPage === "boolean"
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

  return { isLastPage: snapshots.pageData.isLastPage, items };
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

/**
 * page=1 から順にページを取得し、取得したページに含まれる全版を返す。
 * 既知の版を含むページ、または最終ページで停止する。
 * @param {{ fetchPage: (page: number) => Promise<string>, knownIds: Set<number>, wait?: (ms: number) => Promise<void>, now?: () => number }} options 取得関数、既知の snapshot ID、待機関数と時計（テスト用）
 * @returns {Promise<{ snapshotId: number, id: string, createdAt: string }[]>} 取得したページに含まれる全版
 */
export const collectRevisions = async ({
  fetchPage,
  knownIds,
  wait = sleep,
  now = Date.now,
}) => {
  const found = [];
  let lastStart;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    if (lastStart !== undefined) {
      const remaining = REQUEST_INTERVAL_MS - (now() - lastStart);
      if (remaining > 0) {
        // oxlint-disable-next-line no-await-in-loop
        await wait(remaining);
      }
    }
    lastStart = now();

    // 直列取得とリクエスト間隔の保証のため、ループ内で順に待つ
    // oxlint-disable-next-line no-await-in-loop
    const { items, isLastPage } = extractSnapshots(await fetchPage(page));
    found.push(...items);

    if (items.some((item) => knownIds.has(item.snapshotId)) || isLastPage) {
      return found;
    }
  }

  throw parseError(`${MAX_PAGES} ページを超えても最終ページに達しません`);
};

/** qiita.com から revisions ページを 1 ページ取得する。 */
export const createPageFetcher =
  ({ fetchImpl = fetch, userAgent }) =>
  async (page) => {
    const url = `${REVISIONS_URL}?page=${page}`;
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { "User-Agent": userAgent },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw fetchError(`取得に失敗しました: ${url} (${error.message})`);
    }
    if (response.status !== 200) {
      throw fetchError(`HTTP ${response.status} が返りました: ${url}`);
    }
    return response.text();
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

/**
 * データファイルを読み、新しい版を取得してマージし、差分があれば書き込む。
 * 失敗したときはデータファイルを変更せずに例外を投げる。
 * @returns {Promise<{ added: number, total: number, written: boolean }>} 追加した件数、合計件数、書き込んだかどうか
 */
export const updateDataFile = async ({ dataPath, fetchPage, wait, now }) => {
  const existingText = await readExisting(dataPath);
  const existing =
    existingText === undefined ? [] : parseDataFile(existingText);
  const knownIds = new Set(existing.map((revision) => revision.snapshotId));

  const knownById = new Map(
    existing.map((revision) => [revision.snapshotId, revision.id])
  );
  const fetched = await collectRevisions({ fetchPage, knownIds, now, wait });
  const added = fetched.filter(
    (revision) => !knownIds.has(revision.snapshotId)
  ).length;
  const renewed = fetched.some(
    (revision) =>
      knownById.has(revision.snapshotId) &&
      knownById.get(revision.snapshotId) !== revision.id
  );

  if (added === 0 && !renewed && existingText !== undefined) {
    return { added, total: existing.length, written: false };
  }

  const merged = mergeRevisions(existing, fetched);
  const text = serializeDataFile(merged);

  const tempPath = `${dataPath}.tmp`;
  await writeFile(tempPath, text, "utf-8");
  await rename(tempPath, dataPath);
  return { added, total: merged.length, written: true };
};

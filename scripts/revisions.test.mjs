import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createPageFetcher,
  serializeDataFile,
  snapshotIdOf,
  updateDataFile,
} from "./lib/revisions.mjs";

const encryptedIdFor = (snapshotId, signature = "ab12") =>
  `${Buffer.from(`"ArticleSnapshot-${snapshotId}"`).toString("base64")}--${signature}`;

/** snapshot ID が大きいほど新しい版になるよう、更新日時を作る。 */
const revisionFor = (snapshotId) => ({
  createdAt: new Date(Date.UTC(2021, 5, 24) + snapshotId * 3_600_000)
    .toISOString()
    .replace(".000", ""),
  id: encryptedIdFor(snapshotId),
  snapshotId,
});

const pageHtml = (revisions, isLastPage) => {
  const props = {
    article: {
      paginatedSnapshots: {
        items: revisions.map(({ createdAt, id }) => ({
          comment: null,
          createdAt,
          encryptedId: id,
        })),
        pageData: { currentPage: 1, isLastPage },
      },
      title: "週間トレンド記事一覧 & その他",
    },
  };
  return `<html><body><script type="application/json" class="js-react-on-rails-component" data-component-name="ArticleRevisionsIndexPage" data-dom-id="x">${JSON.stringify(props)}</script></body></html>`;
};

/** 新しい順の版一覧を 10 件ずつのページに分けた、偽の revisions サイトを作る。 */
const fakeSite = (revisions) => {
  const sorted = revisions.toSorted((a, b) => b.snapshotId - a.snapshotId);
  const pages = [];
  for (let index = 0; index < sorted.length; index += 10) {
    pages.push(sorted.slice(index, index + 10));
  }
  const requested = [];
  const fetchPage = (page) => {
    requested.push(page);
    return Promise.resolve(
      pageHtml(pages[page - 1] ?? [], page >= pages.length)
    );
  };
  return { fetchPage, requested };
};

const range = (from, to) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

/** 実時間を待たずに進む時計。 */
const fakeClock = () => {
  let current = 0;
  return {
    now: () => current,
    wait: (ms) => {
      current += ms;
      return Promise.resolve();
    },
  };
};

const fetchMaintenancePage = () =>
  Promise.resolve("<html><body>maintenance</body></html>");

let workDir;
let dataPath;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "revisions-test-"));
  dataPath = path.join(workDir, "revisions.js");
});

afterEach(async () => {
  await rm(workDir, { force: true, recursive: true });
});

const readData = async () => {
  const text = await readFile(dataPath, "utf-8");
  return JSON.parse(
    text.slice("window.REVISIONS = ".length, text.trimEnd().length - 1)
  );
};

describe("snapshotIdOf", () => {
  it("実際の版 ID から数値 ID を取り出す", () => {
    assert.equal(
      snapshotIdOf(
        "IkFydGljbGVTbmFwc2hvdC0xNjYyNTUyOSI=--5d2b5b22cc0b558693f652f24ac679e02a9ef96ba8f34227a6533bd2658628f7"
      ),
      16_625_529
    );
  });

  it("デコードできない版 ID は解析エラーになる", () => {
    assert.throws(() => snapshotIdOf("bm90LWEtc25hcHNob3Q=--ab12"), {
      kind: "parse",
      name: "RevisionError",
    });
  });
});

describe("updateDataFile", () => {
  it("初回取得で全版が保存される", async () => {
    const site = fakeSite(range(1, 25).map(revisionFor));
    const result = await updateDataFile({
      dataPath,
      fetchPage: site.fetchPage,
      ...fakeClock(),
    });

    assert.equal(result.added, 25);
    const saved = await readData();
    assert.equal(saved.length, 25);
  });

  it("最終ページの後は取得しない", async () => {
    const site = fakeSite(range(1, 25).map(revisionFor));
    await updateDataFile({
      dataPath,
      fetchPage: site.fetchPage,
      ...fakeClock(),
    });

    assert.deepEqual(site.requested, [1, 2, 3]);
  });

  it("新しい版だけが追加され、1 ページ目だけを取得する", async () => {
    await writeFile(
      dataPath,
      serializeDataFile(range(1, 25).toReversed().map(revisionFor))
    );
    const site = fakeSite(range(1, 27).map(revisionFor));
    const result = await updateDataFile({
      dataPath,
      fetchPage: site.fetchPage,
      ...fakeClock(),
    });

    assert.equal(result.added, 2);
    const saved = await readData();
    assert.equal(saved.length, 27);
    assert.deepEqual(site.requested, [1]);
  });

  it("新しい版がないときはファイルが変わらない", async () => {
    const original = serializeDataFile(
      range(1, 25).toReversed().map(revisionFor)
    );
    await writeFile(dataPath, original);
    const before = await stat(dataPath);
    const site = fakeSite(range(1, 25).map(revisionFor));
    const result = await updateDataFile({
      dataPath,
      fetchPage: site.fetchPage,
      ...fakeClock(),
    });

    assert.equal(result.written, false);
    assert.equal(await readFile(dataPath, "utf-8"), original);
    const after = await stat(dataPath);
    assert.equal(after.mtimeMs, before.mtimeMs);
  });

  it("ページ境界で重複した版は 1 回だけ保存され、先頭が最新になる", async () => {
    const revisions = range(1, 15).map(revisionFor).toReversed();
    const requested = [];
    const fetchPage = (page) => {
      requested.push(page);
      // 2 ページ目の先頭に、1 ページ目の末尾と同じ版が再び現れる
      const pages = [revisions.slice(0, 10), revisions.slice(9)];
      return Promise.resolve(pageHtml(pages[page - 1], page === 2));
    };
    await updateDataFile({ dataPath, fetchPage, ...fakeClock() });
    const saved = await readData();

    assert.equal(saved.length, 15);
    assert.equal(
      saved.filter(
        (revision) => revision.snapshotId === revisions[9].snapshotId
      ).length,
      1
    );
    assert.equal(saved[0].snapshotId, 15);
    assert.deepEqual(
      saved.map((revision) => revision.snapshotId),
      range(1, 15).toReversed()
    );
  });

  it("連続リクエストの開始時刻の間隔が 1 秒以上空く", async () => {
    const clock = fakeClock();
    const starts = [];
    const site = fakeSite(range(1, 25).map(revisionFor));
    const fetchPage = (page) => {
      starts.push(clock.now());
      return site.fetchPage(page);
    };
    await updateDataFile({ dataPath, fetchPage, ...clock });

    assert.equal(starts.length, 3);
    for (let index = 1; index < starts.length; index += 1) {
      assert.ok(starts[index] - starts[index - 1] >= 1000);
    }
  });

  it("版一覧データが埋め込まれていないときは失敗し、ファイルを変更しない", async () => {
    const original = serializeDataFile(
      range(1, 25).toReversed().map(revisionFor)
    );
    await writeFile(dataPath, original);
    await assert.rejects(
      updateDataFile({
        dataPath,
        fetchPage: fetchMaintenancePage,
        ...fakeClock(),
      }),
      { kind: "parse", name: "RevisionError" }
    );
    assert.equal(await readFile(dataPath, "utf-8"), original);
  });

  it("HTTP 503 のときは失敗し、ファイルを変更しない", async () => {
    const original = serializeDataFile(
      range(1, 25).toReversed().map(revisionFor)
    );
    await writeFile(dataPath, original);
    const fetchPage = createPageFetcher({
      fetchImpl: () =>
        Promise.resolve(new Response("unavailable", { status: 503 })),
      userAgent: "test",
    });

    await assert.rejects(
      updateDataFile({ dataPath, fetchPage, ...fakeClock() }),
      { kind: "fetch", name: "RevisionError" }
    );
    assert.equal(await readFile(dataPath, "utf-8"), original);
  });

  it("同じ版の署名が変わっていたら、新しい版 ID に置き換える", async () => {
    await writeFile(
      dataPath,
      serializeDataFile([revisionFor(2), revisionFor(1)])
    );
    const renewed = { ...revisionFor(2), id: encryptedIdFor(2, "cd34") };
    const fetchPage = () =>
      Promise.resolve(pageHtml([revisionFor(3), renewed], true));
    await updateDataFile({ dataPath, fetchPage, ...fakeClock() });
    const saved = await readData();

    assert.deepEqual(
      saved.map((revision) => revision.snapshotId),
      [3, 2, 1]
    );
    assert.equal(saved[1].id, encryptedIdFor(2, "cd34"));
  });
});

describe("fetch-revisions.mjs", () => {
  it("取得に失敗したときは 0 以外の終了コードで終了する", () => {
    const script = fileURLToPath(
      new URL("fetch-revisions.mjs", import.meta.url)
    );
    const mockFetch = `data:text/javascript,globalThis.fetch = () => Promise.resolve(new Response("", { status: 503 }));`;
    const child = spawnSync(process.execPath, ["--import", mockFetch, script], {
      encoding: "utf-8",
    });

    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /HTTP 503/u);
  });
});

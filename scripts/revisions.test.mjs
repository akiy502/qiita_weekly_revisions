import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  REVISIONS_URL,
  createPageFetcher,
  importIntoDataFile,
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

const range = (from, to) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

/** 新しい順の版一覧（データファイルの並び）を作る。 */
const newestFirst = (from, to) => range(from, to).toReversed().map(revisionFor);

const snapshotsOf = (
  revisions,
  { currentPage = 1, isLastPage = false } = {}
) => ({
  items: revisions.map(({ createdAt, id }) => ({
    comment: null,
    createdAt,
    encryptedId: id,
  })),
  pageData: { currentPage, isLastPage },
});

/** revisions ページの HTML（実物と同じ埋め込み方）を作る。 */
const pageHtml = (revisions, pageData) => {
  const props = {
    article: {
      paginatedSnapshots: snapshotsOf(revisions, pageData),
      title: "週間トレンド記事一覧 & その他",
    },
  };
  return `<html><body><script type="application/json" class="js-react-on-rails-component" data-component-name="ArticleRevisionsIndexPage" data-dom-id="x">${JSON.stringify(props)}</script></body></html>`;
};

/** GraphQL GetArticleRevisions の応答を作る。 */
const graphqlResponse = (revisions, pageData) => ({
  data: { article: { paginatedSnapshots: snapshotsOf(revisions, pageData) } },
});

/** 呼ばれた回数を数える、1 ページ目の取得関数を作る。 */
const fakePage = (html) => {
  const calls = { count: 0 };
  const fetchPage = () => {
    calls.count += 1;
    return Promise.resolve(html);
  };
  return { calls, fetchPage };
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

/** 556 版を保存したデータファイルを作り、その内容を返す。 */
const seed556 = async () => {
  const text = serializeDataFile(newestFirst(1, 556));
  await writeFile(dataPath, text);
  return text;
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

describe("updateDataFile（定期取得）", () => {
  it("1 回のリクエストで終わる", async () => {
    await seed556();
    const page = fakePage(pageHtml(newestFirst(547, 556), { currentPage: 1 }));
    await updateDataFile({ dataPath, fetchPage: page.fetchPage });

    assert.equal(page.calls.count, 1);
  });

  it("新しい版だけが追加される", async () => {
    await seed556();
    const page = fakePage(pageHtml(newestFirst(549, 558), { currentPage: 1 }));
    const result = await updateDataFile({
      dataPath,
      fetchPage: page.fetchPage,
    });
    const saved = await readData();

    assert.equal(result.added, 2);
    assert.equal(saved.length, 558);
    assert.equal(saved[0].snapshotId, 558);
  });

  it("新しい版がないときはファイルが変わらない", async () => {
    const original = await seed556();
    const before = await stat(dataPath);
    const page = fakePage(pageHtml(newestFirst(547, 556), { currentPage: 1 }));
    const result = await updateDataFile({
      dataPath,
      fetchPage: page.fetchPage,
    });
    const after = await stat(dataPath);

    assert.equal(result.written, false);
    assert.equal(await readFile(dataPath, "utf-8"), original);
    assert.equal(after.mtimeMs, before.mtimeMs);
  });

  it("データファイルがないときはリクエストせずに中断し、取り込み手順を案内する", async () => {
    const page = fakePage(pageHtml(newestFirst(547, 556), { currentPage: 1 }));

    await assert.rejects(
      updateDataFile({ dataPath, fetchPage: page.fetchPage }),
      {
        kind: "missing",
        message: /docs\/backfill\.md/u,
      }
    );
    assert.equal(page.calls.count, 0);
  });

  it("1 ページ目に保存済みの版がないときは中断し、ファイルを変更しない", async () => {
    const original = await seed556();
    const page = fakePage(pageHtml(newestFirst(557, 566), { currentPage: 1 }));

    await assert.rejects(
      updateDataFile({ dataPath, fetchPage: page.fetchPage }),
      {
        kind: "gap",
        message: /docs\/backfill\.md/u,
      }
    );
    assert.equal(await readFile(dataPath, "utf-8"), original);
  });

  it("1 ページ目以外が返ったときは中断し、ファイルを変更しない", async () => {
    const original = await seed556();
    const page = fakePage(pageHtml(newestFirst(549, 558), { currentPage: 2 }));

    await assert.rejects(
      updateDataFile({ dataPath, fetchPage: page.fetchPage }),
      {
        kind: "parse",
      }
    );
    assert.equal(await readFile(dataPath, "utf-8"), original);
  });

  it("版一覧データが埋め込まれていないときは中断し、ファイルを変更しない", async () => {
    const original = await seed556();

    await assert.rejects(
      updateDataFile({ dataPath, fetchPage: fetchMaintenancePage }),
      { kind: "parse" }
    );
    assert.equal(await readFile(dataPath, "utf-8"), original);
  });

  it("HTTP 503 のときは中断し、ファイルを変更しない", async () => {
    const original = await seed556();
    const fetchPage = createPageFetcher({
      fetchImpl: () =>
        Promise.resolve(new Response("unavailable", { status: 503 })),
      userAgent: "test",
    });

    await assert.rejects(updateDataFile({ dataPath, fetchPage }), {
      kind: "fetch",
    });
    assert.equal(await readFile(dataPath, "utf-8"), original);
  });

  it("同じ版の署名が変わっていたら、新しい版 ID に置き換える", async () => {
    await writeFile(
      dataPath,
      serializeDataFile([revisionFor(2), revisionFor(1)])
    );
    const renewed = { ...revisionFor(2), id: encryptedIdFor(2, "cd34") };
    const page = fakePage(
      pageHtml([revisionFor(3), renewed, revisionFor(1)], { currentPage: 1 })
    );
    await updateDataFile({ dataPath, fetchPage: page.fetchPage });
    const saved = await readData();

    assert.deepEqual(
      saved.map((revision) => revision.snapshotId),
      [3, 2, 1]
    );
    assert.equal(saved[1].id, encryptedIdFor(2, "cd34"));
  });
});

describe("createPageFetcher", () => {
  it("クエリなしの revisions ページを 1 回だけ取得する", async () => {
    const urls = [];
    const fetchPage = createPageFetcher({
      fetchImpl: (url) => {
        urls.push(url);
        return Promise.resolve(new Response("ok", { status: 200 }));
      },
      userAgent: "test",
    });

    assert.equal(await fetchPage(), "ok");
    assert.deepEqual(urls, [REVISIONS_URL]);
  });
});

describe("importIntoDataFile（過去分の取り込み）", () => {
  it("保存した応答から全版を取り込む", async () => {
    const responses = graphqlResponse(newestFirst(1, 556), {
      currentPage: 1,
      isLastPage: true,
    });
    const result = await importIntoDataFile({ dataPath, responses });
    const saved = await readData();

    assert.equal(result.added, 556);
    assert.equal(saved.length, 556);
  });

  it("既存のデータに追加で取り込む（複数ページの応答）", async () => {
    await seed556();
    const responses = [
      graphqlResponse(newestFirst(469, 568), { currentPage: 1 }),
      graphqlResponse(newestFirst(1, 468), {
        currentPage: 2,
        isLastPage: true,
      }),
    ];
    const result = await importIntoDataFile({ dataPath, responses });
    const saved = await readData();

    assert.equal(result.added, 12);
    assert.equal(saved.length, 568);
  });

  it("重なった版は 1 回だけ保存され、先頭が最新になる", async () => {
    await seed556();
    const responses = graphqlResponse(newestFirst(1, 558), {
      currentPage: 1,
      isLastPage: true,
    });
    await importIntoDataFile({ dataPath, responses });
    const saved = await readData();

    assert.equal(saved.length, 558);
    assert.equal(
      new Set(saved.map((revision) => revision.snapshotId)).size,
      558
    );
    assert.equal(saved[0].snapshotId, 558);
  });

  it("同じ内容を取り込んでもファイルは変わらない", async () => {
    const original = await seed556();
    const responses = graphqlResponse(newestFirst(1, 556), {
      currentPage: 1,
      isLastPage: true,
    });
    const result = await importIntoDataFile({ dataPath, responses });

    assert.equal(result.written, false);
    assert.equal(await readFile(dataPath, "utf-8"), original);
  });

  it("最終ページまで揃っていないときは拒否し、ファイルを変更しない", async () => {
    const original = await seed556();
    const responses = graphqlResponse(newestFirst(469, 568), {
      currentPage: 1,
    });

    await assert.rejects(importIntoDataFile({ dataPath, responses }), {
      kind: "incomplete",
    });
    assert.equal(await readFile(dataPath, "utf-8"), original);
  });

  it("ページ番号が飛んでいるときは拒否し、ファイルを変更しない", async () => {
    const original = await seed556();
    const responses = [
      graphqlResponse(newestFirst(469, 568), { currentPage: 1 }),
      graphqlResponse(newestFirst(1, 368), {
        currentPage: 3,
        isLastPage: true,
      }),
    ];

    await assert.rejects(importIntoDataFile({ dataPath, responses }), {
      kind: "incomplete",
    });
    assert.equal(await readFile(dataPath, "utf-8"), original);
  });

  it("エラー応答は拒否し、ファイルを変更しない", async () => {
    const original = await seed556();
    const responses = { errors: [{ message: "CSRF token is invalid" }] };

    await assert.rejects(importIntoDataFile({ dataPath, responses }), {
      kind: "parse",
    });
    assert.equal(await readFile(dataPath, "utf-8"), original);
  });
});

const scriptPath = (name) => fileURLToPath(new URL(name, import.meta.url));

describe("CLI", () => {
  it("fetch-revisions.mjs は取得に失敗したとき 0 以外の終了コードで終了する", () => {
    const mockFetch = `data:text/javascript,globalThis.fetch = () => Promise.resolve(new Response("", { status: 503 }));`;
    const child = spawnSync(
      process.execPath,
      ["--import", mockFetch, scriptPath("fetch-revisions.mjs")],
      { encoding: "utf-8" }
    );

    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /HTTP 503/u);
  });

  it("import-snapshots.mjs は不正なファイルを拒否し、0 以外の終了コードで終了する", async () => {
    const inputPath = path.join(workDir, "error.json");
    await writeFile(
      inputPath,
      JSON.stringify({ errors: [{ message: "CSRF token is invalid" }] })
    );
    const child = spawnSync(
      process.execPath,
      [scriptPath("import-snapshots.mjs"), inputPath],
      { encoding: "utf-8" }
    );

    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /取り込みに失敗しました/u);
  });
});

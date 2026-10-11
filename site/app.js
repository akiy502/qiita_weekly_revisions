// 週間トレンド記事一覧の過去の版を、更新日から開くための閲覧ページ。
// file:// でも動くよう、モジュールではなく通常のスクリプトとして読み込む。

const REVISIONS_URL =
  "https://qiita.com/Qiita/items/b5c1550c969776b65b9b/revisions";
const STORAGE_PREFIX = "qiita-weekly-revisions:";
const READ_KEY = `${STORAGE_PREFIX}read`;
const UNREAD_ONLY_KEY = `${STORAGE_PREFIX}unread-only`;
const EXPORT_APP = "qiita-weekly-revisions";
const EXPORT_VERSION = 1;
const DIGITS_ONLY = /^\d+$/u;
const MIDDLE_BUTTON = 1;

const jstParts = new Intl.DateTimeFormat("ja-JP", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Tokyo",
  weekday: "short",
  year: "numeric",
});

const jstCache = new Map();

const toJst = (isoString) => {
  const cached = jstCache.get(isoString);
  if (cached) {
    return cached;
  }
  const parts = Object.fromEntries(
    jstParts
      .formatToParts(new Date(isoString))
      .map(({ type, value }) => [type, value])
  );
  const result = {
    day: parts.day,
    month: parts.month,
    weekday: parts.weekday,
    year: parts.year,
  };
  jstCache.set(isoString, result);
  return result;
};

// ---- ストレージ ----

const showStorageNotice = () => {
  document.querySelector("#storage-notice").hidden = false;
};

const storage = {
  available: false,
  get(key) {
    if (!this.available) {
      return null;
    }
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    if (!this.available) {
      return;
    }
    try {
      localStorage.setItem(key, value);
    } catch {
      this.available = false;
      showStorageNotice();
    }
  },
};

const detectStorage = () => {
  try {
    const probe = `${STORAGE_PREFIX}probe`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
};

const loadReadRecords = () => {
  const raw = storage.get(READ_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
};

// ---- 状態 ----

const state = {
  read: {},
  revisions: [],
  unreadOnly: false,
};

const saveRead = () => {
  storage.set(READ_KEY, JSON.stringify(state.read));
};

const isRead = (revision) =>
  Object.hasOwn(state.read, String(revision.snapshotId));

// ---- 描画 ----

const element = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
};

const revisionUrl = (revision) =>
  `${REVISIONS_URL}?id=${encodeURIComponent(revision.id)}`;

const renderDay = (revision) => {
  const read = isRead(revision);
  const jst = toJst(revision.createdAt);
  const link = element(
    "a",
    { href: revisionUrl(revision), rel: "noopener", target: "_blank" },
    [
      element("span", {
        ariaHidden: "true",
        className: "mark",
        textContent: read ? "✓" : "●",
      }),
      element("span", {
        textContent: `${jst.month}/${jst.day}(${jst.weekday})`,
      }),
      element("span", {
        className: read ? "state" : "state visually-hidden",
        textContent: read ? "既読" : "未読",
      }),
    ]
  );
  link.dataset.snapshotId = String(revision.snapshotId);

  const item = element("li", { className: read ? "day is-read" : "day" }, [
    link,
  ]);
  if (read) {
    const button = element("button", {
      ariaLabel: `${jst.month}/${jst.day} を未読に戻す`,
      className: "unread-button",
      textContent: "未読に戻す",
      type: "button",
    });
    button.dataset.unread = String(revision.snapshotId);
    item.append(button);
  }
  return item;
};

/** 版を JST の年・月でまとめる。版は新しい順に並んでいる前提。 */
const groupByYearMonth = (revisions) => {
  const years = new Map();
  for (const revision of revisions) {
    const { year, month } = toJst(revision.createdAt);
    if (!years.has(year)) {
      years.set(year, new Map());
    }
    const months = years.get(year);
    if (!months.has(month)) {
      months.set(month, []);
    }
    months.get(month).push(revision);
  }
  return years;
};

const render = () => {
  const container = document.querySelector("#revisions");
  if (state.revisions.length === 0) {
    container.replaceChildren(
      element("p", {
        className: "empty",
        textContent: "表示できる版がありません",
      })
    );
    return;
  }

  const visible = state.unreadOnly
    ? state.revisions.filter((revision) => !isRead(revision))
    : state.revisions;
  if (visible.length === 0) {
    container.replaceChildren(
      element("p", { className: "empty", textContent: "未読の版はありません" })
    );
    return;
  }

  const sections = [];
  for (const [year, months] of groupByYearMonth(visible)) {
    const monthBlocks = [];
    for (const [month, revisions] of months) {
      monthBlocks.push(
        element("div", { className: "month" }, [
          element("h3", { textContent: `${Number(month)}月` }),
          element("ul", { className: "days" }, revisions.map(renderDay)),
        ])
      );
    }
    sections.push(
      element("section", { className: "year" }, [
        element("h2", { textContent: `${year}年` }),
        ...monthBlocks,
      ])
    );
  }
  container.replaceChildren(...sections);
};

// ---- エクスポート／インポート ----

const exportPayload = () =>
  JSON.stringify(
    {
      app: EXPORT_APP,
      exportedAt: new Date().toISOString(),
      read: state.read,
      version: EXPORT_VERSION,
    },
    null,
    2
  );

const setMessage = (id, text, isError = false) => {
  const node = document.querySelector(id);
  node.textContent = text;
  node.classList.toggle("is-error", isError);
};

const exportToFile = () => {
  const { year, month, day } = toJst(new Date().toISOString());
  const blob = new Blob([exportPayload()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = element("a", {
    download: `qiita-weekly-revisions-read-${year}${month}${day}.json`,
    href: url,
  });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  setMessage(
    "#export-message",
    `${Object.keys(state.read).length} 件の既読をファイルに保存しました`
  );
};

const showExportFallback = (text) => {
  const output = document.querySelector("#export-output");
  document.querySelector("#export-output-label").hidden = false;
  output.hidden = false;
  output.value = text;
  output.focus();
  output.select();
};

const exportToClipboard = async () => {
  const text = exportPayload();
  try {
    await navigator.clipboard.writeText(text);
    setMessage(
      "#export-message",
      `${Object.keys(state.read).length} 件の既読をクリップボードにコピーしました`
    );
  } catch {
    showExportFallback(text);
    setMessage("#export-message", "");
  }
};

/** 既読データとして解釈できれば read を返し、できなければ null を返す。 */
const parseImport = (text) => {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (data?.app !== EXPORT_APP || data.version !== EXPORT_VERSION) {
    return null;
  }
  const { read } = data;
  if (!read || typeof read !== "object" || Array.isArray(read)) {
    return null;
  }
  const valid = Object.entries(read).every(
    ([key, value]) =>
      DIGITS_ONLY.test(key) &&
      typeof value === "string" &&
      !Number.isNaN(Date.parse(value))
  );
  return valid ? read : null;
};

const selectedImportMode = () =>
  document.querySelector('input[name="import-mode"]:checked').value;

const importRecords = (text) => {
  const imported = parseImport(text);
  if (!imported) {
    setMessage(
      "#import-message",
      "読み込めませんでした。エクスポートした既読データを指定してください。",
      true
    );
    return false;
  }

  if (selectedImportMode() === "replace") {
    // oxlint-disable-next-line no-alert
    const confirmed = confirm(
      "今の既読の記録を、読み込んだ内容で置き換えます。よろしいですか？"
    );
    if (!confirmed) {
      setMessage("#import-message", "上書きを取り消しました。");
      return false;
    }
    state.read = { ...imported };
  } else {
    state.read = { ...imported, ...state.read };
  }

  saveRead();
  render();
  setMessage(
    "#import-message",
    `既読データを読み込みました（現在 ${Object.keys(state.read).length} 件が既読）。`
  );
  return true;
};

const importFromFile = async (event) => {
  const [file] = event.target.files;
  if (!file) {
    return;
  }
  importRecords(await file.text());
  event.target.value = "";
};

const importFromText = () => {
  const textarea = document.querySelector("#import-text");
  if (importRecords(textarea.value)) {
    textarea.value = "";
  }
};

// ---- イベント ----

const markRead = (snapshotId) => {
  const key = String(snapshotId);
  if (Object.hasOwn(state.read, key)) {
    return;
  }
  state.read[key] = new Date().toISOString();
  saveRead();
  render();
};

const markUnread = (snapshotId) => {
  const key = String(snapshotId);
  state.read = Object.fromEntries(
    Object.entries(state.read).filter(([readKey]) => readKey !== key)
  );
  saveRead();
  render();
};

const onOpenRevision = (event) => {
  if (event.type === "auxclick" && event.button !== MIDDLE_BUTTON) {
    return;
  }
  const link = event.target.closest("a[data-snapshot-id]");
  if (link) {
    markRead(Number(link.dataset.snapshotId));
  }
};

const onUnreadClick = (event) => {
  const button = event.target.closest("button[data-unread]");
  if (button) {
    markUnread(Number(button.dataset.unread));
  }
};

const onToggleUnreadOnly = (event) => {
  state.unreadOnly = event.target.checked;
  storage.set(UNREAD_ONLY_KEY, state.unreadOnly ? "1" : "0");
  render();
};

const init = () => {
  storage.available = detectStorage();
  if (!storage.available) {
    showStorageNotice();
  }

  state.revisions = Array.isArray(globalThis.REVISIONS)
    ? globalThis.REVISIONS
    : [];
  state.read = loadReadRecords();
  state.unreadOnly = storage.get(UNREAD_ONLY_KEY) === "1";

  const toggle = document.querySelector("#unread-only");
  toggle.checked = state.unreadOnly;
  toggle.addEventListener("change", onToggleUnreadOnly);

  const container = document.querySelector("#revisions");
  container.addEventListener("click", onOpenRevision);
  container.addEventListener("auxclick", onOpenRevision);
  container.addEventListener("click", onUnreadClick);

  document
    .querySelector("#export-file")
    .addEventListener("click", exportToFile);
  document
    .querySelector("#export-text")
    .addEventListener("click", exportToClipboard);
  document
    .querySelector("#import-file")
    .addEventListener("change", importFromFile);
  document
    .querySelector("#import-text-button")
    .addEventListener("click", importFromText);

  render();
};

init();

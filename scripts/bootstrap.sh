#!/usr/bin/env bash
# GitHub リポジトリ qiita_weekly_revisions を作成し、Pages（GitHub Actions ソース）を有効にして push する。
# 前提: gh CLI がインストール済みで、`gh auth login` 済みであること。
# どの段階も「既にあれば何もしない」ので、何度実行してもよい。
set -euo pipefail

readonly REPO_NAME="qiita_weekly_revisions"

die() {
  echo "エラー: $*" >&2
  exit 1
}

cd "$(git rev-parse --show-toplevel)"

command -v gh >/dev/null 2>&1 || die "gh がインストールされていません。https://cli.github.com/ を参照してください。"
gh auth status >/dev/null 2>&1 || die "GitHub にログインしていません。gh auth login を実行してください。"

if ! git diff --quiet || ! git diff --cached --quiet; then
  die "コミットされていない変更があります。commit してから再実行してください。"
fi

# 1. ブランチを main にそろえる
if [[ "$(git branch --show-current)" == "master" ]]; then
  git branch -m master main
  echo "ブランチ master を main に改名しました。"
fi
[[ "$(git branch --show-current)" == "main" ]] || die "main ブランチに切り替えてから再実行してください。"

owner="$(gh api user --jq .login)"
full_name="${owner}/${REPO_NAME}"

# 2. リポジトリを作成する（push は Pages を有効にした後で行う）
if gh repo view "$full_name" >/dev/null 2>&1; then
  echo "リポジトリ ${full_name} は既にあります。"
else
  gh repo create "$REPO_NAME" --public --description "Qiita 週間トレンド記事一覧の過去の版を更新日から開くページ"
  echo "リポジトリ ${full_name} を作成しました。"
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "https://github.com/${full_name}.git"
fi

# 3. Pages を GitHub Actions ソースで有効にする
if build_type="$(gh api "repos/${full_name}/pages" --jq .build_type 2>/dev/null)"; then
  if [[ "$build_type" != "workflow" ]]; then
    gh api -X PUT "repos/${full_name}/pages" -f build_type=workflow >/dev/null
    echo "Pages のソースを GitHub Actions に変更しました。"
  else
    echo "Pages は GitHub Actions ソースで有効になっています。"
  fi
else
  gh api -X POST "repos/${full_name}/pages" -f build_type=workflow >/dev/null
  echo "Pages を GitHub Actions ソースで有効にしました。"
fi

# 4. push する（main への push で update.yml がデプロイを行う）
git push -u origin main

echo
echo "完了しました。"
echo "  リポジトリ: https://github.com/${full_name}"
echo "  公開 URL : https://${owner}.github.io/${REPO_NAME}/"
echo "Actions の update ワークフローが成功すると、公開 URL で一覧を見られます。"

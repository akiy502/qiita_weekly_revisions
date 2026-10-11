# gh CLI のセットアップ

`scripts/bootstrap.sh` は `gh` CLI を使って、次の 3 つを行う。

- GitHub に public リポジトリ `qiita_weekly_revisions` を作り、push する
- GitHub Pages を有効にする（`build_type=workflow`）
- すでに済んでいる段階を確かめ、飛ばす（再実行できるようにするため）

そのため、`bootstrap.sh` を実行する前に `gh` をインストールし、GitHub にログインしておく必要がある。この文書は、WSL 上の Ubuntu（26.04 で確認済み）での手順をまとめる。

## 1. インストール

GitHub 公式の apt リポジトリを登録してから、インストールする。

```bash
(type -p wget >/dev/null || (sudo apt update && sudo apt install wget -y)) \
&& sudo mkdir -p -m 755 /etc/apt/keyrings \
&& out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg \
&& cat $out | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
&& sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
&& echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
&& sudo apt update && sudo apt install gh -y
```

### `apt update` が別のリポジトリのエラーで止まる場合

ほかに登録してある apt リポジトリに問題があると、`apt update` が失敗し、上のコマンドは途中で止まる。例えば Ubuntu 26.04（`resolute`）では、Microsoft のリポジトリについて次のエラーが出ることがある。

```
Error: The repository 'https://packages.microsoft.com/repos/microsoft-ubuntu-resolute-prod resolute InRelease' is not signed.
```

これは gh とは関係のないエラーである。この場合でも、gh 用のファイル（`/etc/apt/sources.list.d/github-cli.list` と `/etc/apt/keyrings/githubcli-archive-keyring.gpg`）は作られている。gh のリポジトリだけを読み込めばインストールできる。

```bash
sudo apt-get update \
  -o Dir::Etc::sourcelist=sources.list.d/github-cli.list \
  -o Dir::Etc::sourceparts=- \
  -o APT::Get::List-Cleanup=0
sudo apt-get install gh -y
gh --version
```

エラーを出しているリポジトリを使っていないなら、そのリポジトリの `.list` ファイルを改名して無効にしてもよい（任意）。

```bash
sudo mv /etc/apt/sources.list.d/dotnetdev.list /etc/apt/sources.list.d/dotnetdev.list.disabled
```

## 2. ログイン

```bash
gh auth login --scopes workflow
```

質問には次のように答える。

| 質問 | 回答 |
| --- | --- |
| ログイン先 | GitHub.com |
| Git 操作のプロトコル | HTTPS |
| Git の認証に GitHub の認証情報を使うか | Yes |
| 認証方法 | Login with a web browser |

WSL ではブラウザが自動で開かないことがある。その場合は、表示されたワンタイムコードを控えて、Windows 側のブラウザで https://github.com/login/device を開いて入力する。

### `workflow` スコープが必要な理由

`gh auth login` を既定のまま実行すると、トークンに `workflow` スコープが付かない。このスコープがないと、`.github/workflows/update.yml` を含むコミットを HTTPS で push したときに GitHub に拒否され、`bootstrap.sh` が途中で止まる。

ログイン済みでスコープが足りない場合は、次のコマンドで追加できる。

```bash
gh auth refresh -s workflow
```

## 3. 確認

```bash
gh auth status
```

`Logged in to github.com` と表示され、Token scopes に `repo` と `workflow` が含まれていれば完了である。トークンの文字列は伏せて表示される（`gho_****` など）。

Claude Code のサンドボックス内で実行すると、認証情報（`~/.config/gh/`）が読めないため、ログイン済みでも「not logged into any GitHub hosts」と表示される。確認は自分のターミナルで行うこと。

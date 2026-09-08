# NicoLive Helper Standalone (nicolivehelper-standalone)

ブラウザ拡張機能を完全に不要化し、アプリ単体で動作するように刷新された **完全自立型ニコニコ生放送 配信・視聴支援デスクトップアプリ（Electron）** です。

従来の使い慣れた画面デザイン（UI）、操作感、データベース（IndexedDB）をそのまま維持しつつ、面倒なブラウザ拡張機能のインストールや Turnstile 認証エラーの心配なく、アプリ単体で快適に利用できます。

---

## 主な特徴

1. **拡張機能のインストール不要（完全スタンドアロン）**:
   - ブラウザ拡張機能（Extension）は一切不要です。
   - アプリ上部の配信ID入力欄に `lvXXXXXX`（例: `lv351349046`）を入力して「接続」ボタンを押すだけで、枠情報の自動取得、コメント受信、マイリスト同期、リクエスト管理、動画再生連動がすべてアプリ単体で動作します。

2. **Cloudflare Turnstile 突破＆公式ログイン（Chromium 系ブラウザ連携）**:
   - PC にインストールされている Chromium 系ブラウザ（**Microsoft Edge, Google Chrome, Brave, Vivaldi, Opera, Opera GX** 等）を自動検出し、公式ログイン画面を開きます。
   - 一般的な実機ブラウザとして起動するため、Cloudflare Turnstile 等の認証を 100% エラーなく通過できます。
   - ログインが完了すると自動的にセッション情報（Cookie）を安全に取得してウィンドウを閉じ、アプリ本体に即時反映します。
   - 対象ブラウザが未インストールの場合は、Google Chrome の公式インストール案内ダイアログを表示します。

3. **AppData フォルダへの設定・データ集約保存**:
   - ログインセッションやアプリ設定、IndexedDB はすべて Windows 標準の `%APPDATA%\nicolivehelper-standalone` に自動保存されます。
   - アプリのバージョンアップや配置フォルダの移動を行っても、大切な設定やデータベースが消える心配がありません。
   - アプリ内メニューまたは設定画面の「📁 設定フォルダを開く」からいつでもデータフォルダにアクセス可能です。

4. **GitHub Actions による自動ビルド & リリース**:
   - GitHub 上でタグを打ってプッシュ（または手動実行）するだけで、Windows 向けインストーラ（`.exe`）およびポータブル版（`.zip`）が自動ビルドされ、GitHub Releases に即座に公開されます。

---

## 使い方・利用手順

### 1. アプリの起動
- **インストーラ版**: インストール後、デスクトップまたはスタートメニューの「NicoLive Helper Standalone」から起動。
- **ポータブル版**: 解凍後、`NicoLive Helper Standalone.exe` を直接ダブルクリックして起動。
- **ソースコードから開発実行する場合**:
  ```powershell
  cd app
  npm install
  npm start
  ```

### 2. ニコニコへのログイン
1. アプリ右上またはメニューの **「🔑 ログイン」** をクリックします。
2. PC 内のブラウザ（Edge / Chrome 等）が自動検出され、公式のニコニコログイン画面が開きます。
3. 通常通りログイン（パスワード認証、2段階認証、SNS連携等）を完了します。
4. ログインが確認されると自動でブラウザが閉じ、アプリ右上にあなたのアカウント名とアイコンが表示されます。
   ※次回以降は自動的にセッションが復元されるため、再ログインは不要です。

### 3. 配信枠への接続
1. アプリ上部の **「lv...」** 入力欄に、対象の放送ID（例: `lv351349046`）を入力します。
2. **「接続」** ボタンをクリックします。
3. 番組情報が読み込まれ、コメント一覧のリアルタイム受信、リクエスト受付、動画再生連動がスタートします。

---

## 配布用パッケージのビルド

ローカルでパッケージをビルドする場合は、`app` ディレクトリで以下のコマンドを実行します：

```powershell
cd app

# インストーラ版 (.exe) とポータブル版 (.zip) の両方を生成
npm run dist

# インストーラ版のみ生成
npm run dist:installer

# ポータブル zip 版のみ生成
npm run dist:zip
```
ビルド成果物は `app/dist/` 配下に出力されます。

---

## GitHub Actions による自動リリース手順

リポジトリへのタグ push または GitHub Web 画面からの手動実行で、自動的に Windows 向けバイナリをビルドして GitHub Releases に公開できます。

### 方法A: タグ push による自動リリース（推奨）
```powershell
git tag v1.0.0
git push origin v1.0.0
```

### 方法B: GitHub Web 画面からの手動実行
1. GitHub リポジトリの **Actions** タブを開きます。
2. **Build & Release** ワークフローを選択します。
3. **Run workflow** ボタンを押し、バージョンタグ名（例: `v1.0.0`）を入力して実行します。

---

## ディレクトリ構成

```text
nicolivehelper-standalone/
├── app/                  # デスクトップアプリ本体 (Electron)
│   ├── package.json      # パッケージ情報 & ビルド設定
│   ├── main.js           # メインプロセス (Turnstile突破ブラウザ検出, AppData管理)
│   ├── preload.js        # セキュアな IPC 連携 & WebExtension API ポリフィル
│   └── src/              # アプリケーション UI 資産
│       ├── main/         # main.html, main.js, main.css (メインウィンドウ)
│       ├── libs/         # Dexie.js (IndexedDB), jQuery, Bootstrap, utils 等
│       ├── icons/        # アプリケーションアイコン
│       └── options/      # options.html, options.js (設定画面)
├── .github/
│   └── workflows/
│       └── release.yml   # GitHub Actions 自動ビルド & リリース設定
├── .gitignore
└── README.md
```

---

## ライセンス
[MIT License](LICENSE)

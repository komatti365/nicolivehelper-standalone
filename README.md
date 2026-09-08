# New NicoLive Helper (STSen)

Manifest v3 対応に伴い、従来のブラウザ拡張機能を **ネイティブデスクトップアプリ（Electron）** と **接続用ブラウザ拡張機能（Manifest V3 Bridge）** に分離したプロジェクトです。

従来の画面デザイン（UI）、操作感、データベース（Dexie/IndexedDB）を 100% 流用・維持しつつ、ローカル WebSocket 経由でブラウザ内のニコニコ生放送ページと連携します。

---

## 構成

```text
STSen-Extension/
├── app/                  # 【デスクトップアプリ本体 (Electron)】
│   ├── package.json
│   ├── main.js           # メインプロセス & ローカル WebSocket サーバー (ポート 18765)
│   ├── preload.js        # WebExtension API (browser.*) 互換ポリフィル
│   └── src/              # 既存の UI 資産 (main.html, libs, icons, options)
├── extension/            # 【接続用ブラウザ拡張機能 (Manifest V3)】
│   ├── manifest.json     # Manifest V3 定義 (Chrome & Firefox 両対応)
│   ├── background.js     # バックグラウンド Service Worker
│   └── content_scripts/  # ニコ生ページ連携スクリプト (WebSocket クライアント)
└── README.md
```

---

## 使い方・起動手順

### 1. デスクトップアプリの起動

1. ターミナルで `app` ディレクトリに移動します：
   ```powershell
   cd app
   ```
2. 依存関係のインストール（初回のみ）：
   ```powershell
   npm install
   ```
3. アプリの起動：
   ```powershell
   npm start
   ```
   デスクトップアプリが起動し、ローカル WebSocket サーバー（`ws://127.0.0.1:18765`）が自動的に待機状態になります。

---

### 2. 接続用ブラウザ拡張機能の読み込み (Manifest V3)

#### Google Chrome / Edge の場合
1. ブラウザで `chrome://extensions/` を開きます。
2. 右上の「**デベロッパー モード**」を有効にします。
3. 「**パッケージ化されていない拡張機能を読み込む**」をクリックし、本リポジトリの `extension` フォルダを選択します。

#### Firefox の場合
1. アドレスバーに `about:debugging#/runtime/this-firefox` を入力して開きます。
2. 「**一時的なアドオンを読み込む...**」をクリックします。
3. `extension/manifest.json` を選択して読み込みます。

---

### 3. 連携の確認
1. デスクトップアプリを起動した状態で、ブラウザでニコニコ生放送の配信・視聴ページ（`https://live.nicovideo.jp/watch/lvXXXXXX`）を開きます。
2. 拡張機能が自動的にローカル WebSocket（ポート 18765）へ接続し、番組情報（embedded-data）がデスクトップアプリへ送信されます。
3. 枠自動延長や動画再生検知が従来通りシームレスに機能します。
---

## 配布用パッケージ（インストーラ版 & zip版）

pp/dist/ 配下に配布用パッケージが生成されています。

- **インストーラ版 (NSIS .exe)**: pp/dist/New NicoLive Helper Setup 1.0.0.exe
  - デスクトップやスタートメニューにショートカットを作成し、通常通りインストールして使用できます。
- **ポータブル版 (.zip)**: pp/dist/New NicoLive Helper-1.0.0-win.zip
  - 解凍後、任意のフォルダで New NicoLive Helper.exe を直接起動できます（インストール不要）。

### 再ビルドコマンド
pp ディレクトリで以下のコマンドを実行します：
`powershell
npm run dist           # インストーラ版と zip 版の両方を生成
npm run dist:installer # インストーラ版のみ生成
npm run dist:zip       # zip 版のみ生成
`

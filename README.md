# NicoLive Helper Standalone

amano様のNew NicoLive HelperのStandalone版です。

従来の使い慣れた画面デザイン、操作感をそのまま維持しつつ、独自機能としてアプリ内から動画を検索し、引用することができます。
指定タグから自動でストックへ入れることも可能です
---

## 使い方・利用手順

### 1. アプリの起動
- **インストーラ版**: インストール後、デスクトップまたはスタートメニューの「New NicoLive Helper」から起動。
- **ポータブル版**: 解凍後、`New NicoLive Helper.exe` を直接ダブルクリックして起動。

### 2. ニコニコへのログイン
1. アプリ右上またはメニューの **「🔑 ログイン」** をクリックします。
2. PC内のブラウザ（Edge / Chrome 等）が自動検出され、公式のニコニコログイン画面が開きます。
3. 通常通りログイン（パスワード認証、2段階認証、SNS連携等）を完了します。
4. ログインが確認されると自動でブラウザが閉じ、アプリ右上にセッション情報が保存されます。
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

## 謝辞
amano様、New NicoLive Helperのオリジナル版を開発しています
ドワンゴ様、ニコニコ動画のプラットフォームとAPIを提供していただき、ありがとうございます。

## サポートについて
このソフトウェアは、amano様が開発している「New NicoLive Helper」を改造したものですが、スタンドアロン化にあたってコードを大幅に書き換えております。
サポートについては、komatti365(またはニコニコ動画のステイン)までお問い合わせください。
amano様の方にはサポートを依頼しないようにお願いします。

## コード・サポートについて
AI生成されたコードが含まれております。
反AIを掲げる方はご利用をお控えください。
また、反AIを掲げる方、理不尽な要求を行う方、作者の意図を理解しない方、誹謗中傷を行う方、作者の権利を侵害する行為を行う方、その他不誠実な対応をする方に対するサポートは**一切**行いません。
文句あるなら自分でクリーンに作り直してください。
悪質な場合は警察や関係当局へ通報いたします。
予めご了承ください。

FROM node:20-bookworm-slim

# Electron 実行に必要な依存パッケージと仮想ディスプレイ (Xvfb) のインストール
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    libgtk-3-0 \
    libnotify4 \
    libnss3 \
    libxss1 \
    libasound2 \
    libgbm1 \
    libdrm2 \
    libxshmfence1 \
    libglu1-mesa \
    fonts-noto-cjk \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依存関係のコピーとインストール
COPY app/package*.json ./
RUN npm install --omit=dev || npm install

# アプリケーションコードのコピー
COPY app/ ./

# リモート操作 API ポート
EXPOSE 18767

# デフォルト環境変数
ENV STSEN_HOST_ENABLED=1 \
    STSEN_HOST_PORT=18767 \
    STSEN_HEADLESS=1 \
    ELECTRON_DISABLE_SECURITY_WARNINGS=true

# Xvfb 経由でヘッドレス起動
CMD ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1024x768x24", "npx", "electron", ".", "--host", "--headless"]

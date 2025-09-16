# Dockerfile (Playwright版)

# 1. ベースイメージとして、標準的なNode.js 22を指定
FROM node:22-slim

# 2. Playwrightが必要とする依存ライブラリをインストール
# `npx playwright install-deps` は、公式が提供する依存関係インストール用コマンド
RUN apt-get update && apt-get install -y wget gnupg \
    && npx playwright@latest install-deps chromium \
    && rm -rf /var/lib/apt/lists/*

# 3. アプリケーションのセットアップ
WORKDIR /app
COPY package*.json ./
# Playwrightのブラウザ本体もインストールする
RUN npm install --only=production && npx playwright@latest install chromium

COPY . .

# 4. 実行コマンド
CMD ["npm", "start"]
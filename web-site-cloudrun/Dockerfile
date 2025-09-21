# 1. ベースとなるNode.js環境を選択します
FROM node:22

# 2. Puppeteerの実行と多言語フォント表示に必要なライブラリを明示的にインストールします
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    # Puppeteer/Chromeが要求するシステムライブラリ一式
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 \
    libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 \
    libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 \
    libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 \
    libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 \
    libxrender1 libxss1 libxtst6 lsb-release wget xdg-utils \
    \
    # ★★★ 日本語・中国語を完全にカバーするフォントパッケージ ★★★
    fonts-noto-cjk \
    \
    # ★★★ ベンガル語をカバーするフォントパッケージ ★★★
    fonts-beng \
    \
    # インストールしたフォントをシステムに認識させるためのコマンド
    && fc-cache -fv \
    \
    # 後片付け
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
    
# 2. コンテナ内の作業ディレクトリを作成・指定します
WORKDIR /usr/src/app

# 3. 最初にpackage.jsonをコピーして、依存関係をインストールします
# (これにより、コードを変更しただけの再ビルドが高速になります)
COPY package*.json ./
RUN npm install --only=production

# 4. アプリケーションの全てのソースコードを作業ディレクトリにコピーします
# (api.jsやpublicフォルダなどが含まれます)
COPY . .

# 5. コンテナが起動したときに、api.jsを実行するよう指示します
CMD ["node", "api.js"]

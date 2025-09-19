# 1. ベースとなるNode.js環境を選択します
FROM node:22-slim

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

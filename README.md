# 労働安全ナビゲーター
## 使用技術
- node.js 22.19.0
- HTML
- vertex AI
- firestore
- Cloud run
## フォルダ構成
```
.
├── anzen-analyze
├── anzen-site
├── functions
├── safety-movie
├── translate
└── web-site-cloudrun
```
## フォルダ内容説明
- anzen-site
  - 外部サイト（厚生労働省 あんぜんサイト）をスクレイピング
  - Firestoreに保存
- anzen-analyze
  - anzen-siteで保存したデータから、50個のカテゴリを生成。フィールド名は、name,description,measure。
  - name, description, measureを英語、中国語、ベンガル語に翻訳し、firestoreに結合
  - anzen-siteで保存したデータを50個のカテゴリいずれかに分類。（分類に使われないカテゴリもありました）
- tranlate
  - 無くてもよいフォルダ。
  - anzen-analyzeから翻訳機能を独立させたもの。（自社登録データなどで使えると考えています）
- safety-movie
  - generate-video.js : anzen-analyzeのdescription, measures[0]をVeoでムービー化する
  - 他の.jsはテスト用です。
- web-site-cloudrun
  - メインのファイルです。
  - app.jsでエンドポイントなどを作成。
  - /public/index.html がトップページです。
- functions
  - 自社で登録したデータをjsonにしてfirestoreからstorageに転送するものです。
  - 将来のRAG用（今回搭載無し）
## デプロイ
それぞれのフォルダ内でここにデプロイしてください。

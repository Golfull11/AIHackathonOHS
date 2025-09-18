// functions/index.js

import express from 'express';
import { Storage } from '@google-cloud/storage';

const app = express();
app.use(express.json()); // リクエストボディをJSONとしてパースする

const storage = new Storage();
const BUCKET_NAME = 'safety-contents-safety-recommend-app-2025'; // あなたのバケット名

// Firestoreイベントは、このPOST / エンドポイントに送信される
app.post('/', async (req, res) => {
    try {
        // CloudEvents形式のリクエストから、Firestoreのイベントデータを取得
        const firestoreEvent = req.body;
        console.log("Received Firestore event:", JSON.stringify(firestoreEvent, null, 2));

        const docId = firestoreEvent.document.split('/').pop();

        // ドキュメントが削除された場合は何もしない
        if (!firestoreEvent.value) {
            console.log(`Document ${docId} was deleted. No action taken.`);
            return res.status(204).send();
        }

        const caseData = {};
        for (const key in firestoreEvent.value.fields) {
            // Firestoreのデータ形式から、単純なJSオブジェクトに変換
            caseData[key] = Object.values(firestoreEvent.value.fields[key])[0];
        }

        console.log(`Exporting doc ${docId} to Cloud Storage...`);
        const fileName = `internal-cases-for-rag/${docId}.json`;
        const file = storage.bucket(BUCKET_NAME).file(fileName);

        await file.save(JSON.stringify(caseData, null, 2), {
            contentType: 'application/json',
        });

        console.log(`Successfully exported ${docId} to ${fileName}`);
        res.status(204).send(); // 成功応答 (コンテンツなし)

    } catch (error) {
        console.error("Error processing Firestore event:", error);
        res.status(500).send("Internal Server Error");
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Firestore event handler listening on port ${PORT}`);
});
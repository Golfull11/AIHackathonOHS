import 'dotenv/config';
import { Firestore } from '@google-cloud/firestore';
import { GoogleGenAI } from "@google/genai";

// --- 環境変数 ---
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION;
const CATEGORY_COLLECTION = 'categories';

// --- クライアント初期化 ---
const firestore = new Firestore();
const ai = new GoogleGenAI({
        vertexai: true,
        project: PROJECT_ID,
        location: LOCATION,
    });

async function main() {
    console.log("--- Starting pre-computation of category embeddings ---");
    const snapshot = await firestore.collection(CATEGORY_COLLECTION).get();
    if (snapshot.empty) { console.log("No categories found."); return; }

    const allDocs = snapshot.docs;
    let successCount = 0;

    for (const doc of allDocs) {
        const data = doc.data();
        const shouldUpdate = data.description && data.description !== '生成失敗' && (!data.embedding || data.embedding.length !== 3072);

        if (shouldUpdate) {
            try {
                console.log(`Processing category: "${data.name}"...`);
                
                const result = await ai.models.embedContent({
                    model: 'gemini-embedding-001',
                    contents: data.description,
                });
                
                const embeddingValues = result.embeddings[0].values;
                
                // 1件ずつ、doc.ref.update() で直接更新する
                await doc.ref.update({ embedding: embeddingValues });
                
                console.log(`  -> Successfully updated embedding for "${data.name}".`);
                successCount++;

            } catch (error) {
                console.error(`  -> Failed to process category "${data.name}":`, error);
            }
        }
    }

    console.log(`\n--- Finished pre-computation ---`);
    console.log(`Successfully updated ${successCount} documents.`);
}

main().catch(console.error);
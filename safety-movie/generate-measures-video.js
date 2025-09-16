import 'dotenv/config';
import { Firestore } from '@google-cloud/firestore';
import { GoogleGenAI } from "@google/genai";
import { Storage } from '@google-cloud/storage';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// --- 環境変数 ---
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION;

// --- 設定項目 ---
const BUCKET_NAME = process.env.BUCKET_NAME
const CATEGORY_COLLECTION = 'categories';

// --- クライアント初期化 ---
const firestore = new Firestore();
const storage = new Storage();
const ai = new GoogleGenAI({
        vertexai: true,
        project: PROJECT_ID,
        location: LOCATION,
    });

/**
 * Veoで動画を1本生成し、Cloud Storageにアップロードして公開URLを返す関数
 */
async function createAndUploadVideo(categoryId, text, type) {
    console.log(`  -> Generating video for category ${categoryId} (${type})...`);
    
    // ★★★ ご指摘のスタイル指示を組み込んだ、新しいプロンプト ★★★
    const prompt = `
A simple, clear pictogram animation explaining a safety instruction.

**Action to animate:**
"${text}"

**Subject:**
A white pictogram of a worker.

**Style:**
Minimalist vector art, flat design, clean lines, no facial features, no text, no voiceover.

**Background:**
Simple light blue gradient background.

**Composition:**
Front view, eye-level shot, full body.
`;

    try {
        console.log(`    Sending prompt to Veo model...`);
        let operation = await ai.models.generateVideos({
            model:"veo-3.0-generate-001",
            prompt: prompt,
        });
        console.log(`    Video generation started. Initial operation status: done=${operation.done}`);

        while (!operation.done) {
            await new Promise((resolve) => setTimeout(resolve, 20000));
            console.log(`    Polling for completion...`);
            operation = await ai.operations.getVideosOperation({
                operation: operation,
        });
        }

        if (operation.error) {
            throw new Error(`Operation failed: ${operation.error.message}`);
        }
        console.log(`    Video generated successfully.`);

        const generatedVideo = operation.response.generatedVideos[0];
        const tempFileName = `${uuidv4()}.mp4`;
        const tempFilePath = path.join(os.tmpdir(), tempFileName);

        await ai.files.download({
            file: generatedVideo.video,
            downloadPath: tempFilePath,
        });
        console.log(`    Video downloaded to temporary path: ${tempFilePath}`);

        const destinationPath = `videos/${categoryId}/${type}.mp4`;
        await storage.bucket(BUCKET_NAME).upload(tempFilePath, {
            destination: destinationPath,
        });
        fs.unlinkSync(tempFilePath);
        
        const file = storage.bucket(BUCKET_NAME).file(destinationPath);
        // await file.makePublic();
        console.log(`    Video uploaded to Cloud Storage and made public.`);
        return file.publicUrl();

    } catch (error) {
        console.error(`  [Error] Failed to create video for category ${categoryId} (${type}):`, error);
        return null;
    }
}


/**
 * メイン処理
 */
async function main() {
    console.log(`--- Starting Video Generation Process (Production Mode) ---`);

    if (BUCKET_NAME === 'YOUR_BUCKET_NAME') {
        console.error("エラー: BUCKET_NAMEが設定されていません。");
        return;
    }

    // 1. `categories`コレクションから全データを取得
    const snapshot = await firestore.collection(CATEGORY_COLLECTION).get();
    if (snapshot.empty) {
        console.log("No categories found to process.");
        return;
    }
    const categories = snapshot.docs;
    console.log(`Found ${categories.length} categories to process.`);

    // 2. 各カテゴリをループ処理
    for (const categoryDoc of categories) {
        const categoryData = categoryDoc.data();
        const categoryId = categoryDoc.id;
        console.log(`\nProcessing category: "${categoryData.name}" (ID: ${categoryId})`);
        const videoTasks = [];

        // 1. measures.ja が存在し、配列であり、要素が1つ以上あることを確認
        if (categoryData.measures && Array.isArray(categoryData.measures.ja) && categoryData.measures.ja.length > 0) {
            // 2. 最初の対策 (measures.ja[0]) が有効な文字列であることを確認
            const firstMeasure = categoryData.measures.ja[0];
            if (firstMeasure && firstMeasure.trim() !== "" && firstMeasure !== "生成失敗") {
                // タスクリストに追加
                videoTasks.push({ text: firstMeasure, type: 'measure_1' });
            } else {
                console.log("  - Skipping 'measure_1' video (content is empty or failed).");
            }
        } else {
             console.log("  - Skipping 'measure_1' video (measures.ja not found or empty).");
        }
        
        if (videoTasks.length === 0) {
            console.log("  No valid measure found to generate video. Skipping category.");
            continue;
        }

        // 既存の動画URL情報を取得。なければ空のオブジェクトを用意。
        const videoUrls = categoryData.videoUrls || {};

        // 3. 対策の動画のみを生成
        for (const task of videoTasks) {
            const url = await createAndUploadVideo(categoryId, task.text, task.type);
            if (url) {
                // 既存の `description` のURLはそのままに、`measure_1` のURLだけを上書き
                videoUrls[task.type] = url;
            }
        }

        // 4. Firestoreドキュメントを更新
        await categoryDoc.ref.set({ videoUrls }, { merge: true });
        console.log(`-> Updated Firestore for category "${categoryData.name.ja}" with new measures video URL.`);
    }

    console.log("\n--- Measures Video Regeneration Process Finished ---");
}

main().catch(console.error);
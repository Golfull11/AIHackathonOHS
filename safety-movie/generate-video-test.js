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

const ai = new GoogleGenAI({
        vertexai: true,
        project: PROJECT_ID,
        location: LOCATION,
    });

// --- 設定項目 ---
const BUCKET_NAME = process.env.BUCKET_NAME
const CATEGORY_COLLECTION = 'categories';
const TEST_CATEGORY_ID = '3bjgSwRjX1DO43amne1H'; // ★★★ テストしたいカテゴリIDに置き換えてください ★★

// --- クライアント初期化 ---
const firestore = new Firestore();
const storage = new Storage();

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
    console.log(`--- Starting Video Generation Process (Test Mode for 1 Category) ---`);

    if (BUCKET_NAME === 'YOUR_BUCKET_NAME' || TEST_CATEGORY_ID === 'YOUR_TEST_CATEGORY_ID') {
        console.error("エラー: BUCKET_NAME または TEST_CATEGORY_ID が設定されていません。");
        return;
    }

    const categoryDocRef = firestore.collection(CATEGORY_COLLECTION).doc(TEST_CATEGORY_ID);
    const categoryDoc = await categoryDocRef.get();

    if (!categoryDoc.exists) {
        console.error(`Test category with ID "${TEST_CATEGORY_ID}" not found.`);
        return;
    }

    const categoryData = categoryDoc.data();
    const categoryId = categoryDoc.id;
    console.log(`\nProcessing category: "${categoryData.name}" (ID: ${categoryId})`);

    const videoTasks = [
        { text: categoryData.description, type: 'description' },
        ...categoryData.measures.map((measure, i) => ({ text: measure, type: `measure_${i + 1}` }))
    ];

    const videoUrls = {};
    for (const task of videoTasks) {
        const url = await createAndUploadVideo(categoryId, task.text, task.type);
        if (url) {
            videoUrls[task.type] = url;
        }
    }

    if (Object.keys(videoUrls).length > 0) {
        await categoryDoc.ref.update({ videoUrls });
        console.log(`-> Updated Firestore for category "${categoryData.name}" with video URLs.`);
    }

    console.log("\n--- Video Generation Test Finished ---");
}

main().catch(console.error);

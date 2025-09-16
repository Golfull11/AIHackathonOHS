import 'dotenv/config';
import { Firestore } from '@google-cloud/firestore';
import { GoogleGenAI } from "@google/genai";

// --- 環境変数 ---
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION;
const CATEGORY_COLLECTION = 'categories';
const MODEL_NAME = "gemini-2.5-flash";

// クライアントの初期化
const firestore = new Firestore();

const genAI = new GoogleGenAI({
    vertexai: true,
    project: PROJECT_ID,
    location: LOCATION,
});

/**
 * 1つのカテゴリドキュメントを多言語化する関数
 * @param {object} categoryData - Firestoreから読み込んだカテゴリデータ
 * @returns {Promise<object|null>} 多言語化されたデータオブジェクト
 */
async function translateCategory(categoryData) {
    // 既に新しい形式（nameがオブジェクト）であれば、スキップする
    if (typeof categoryData.name === 'object' && categoryData.name !== null) {
        console.log(`  - Skipping "${categoryData.name.ja}", already in new format.`);
        return null;
    }

    console.log(`  - Translating category: "${categoryData.name}"...`);

    const translationPrompt = `あなたはプロの翻訳家です。以下の日本語のJSONオブジェクトの各値を、英語(en)、ベンガル語(bn)、簡体字中国語(zh)に正確に翻訳してください。回答は指定されたJSON形式のみで、他の言葉は一切含めないでください。

【翻訳対象のJSON】
{
  "name": "${categoryData.name}",
  "description": "${categoryData.description}",
  "measures": ${JSON.stringify(categoryData.measures)}
}

【出力形式のJSON】
{
  "en": { "name": "...", "description": "...", "measures": ["...", "...", "..."] },
  "bn": { "name": "...", "description": "...", "measures": ["...", "...", "..."] },
  "zh": { "name": "...", "description": "...", "measures": ["...", "...", "..."] }
}
`;
    
    try {
        const result = await genAI.models.generateContent({model: MODEL_NAME, contents: translationPrompt});
        const response = result.candidates[0].content.parts[0].text;
        // Geminiの返答からJSON部分だけを抜き出す
        const jsonString = response.match(/\{[\s\S]*\}/)[0];
        const translations = JSON.parse(jsonString);

        // 日本語データと翻訳データをマージして、新しいデータ構造を作成
        const newData = {
            name: {
                ja: categoryData.name,
                en: translations.en.name,
                bn: translations.bn.name,
                zh: translations.zh.name
            },
            description: {
                ja: categoryData.description,
                en: translations.en.description,
                bn: translations.bn.description,
                zh: translations.zh.description
            },
            measures: {
                ja: categoryData.measures,
                en: translations.en.measures,
                bn: translations.bn.measures,
                zh: translations.zh.measures
            },
            // 既存のembeddingは保持する
            embedding: categoryData.embedding || null
        };
        return newData;

    } catch (error) {
        console.error(`  - Error translating "${categoryData.name}":`, error);
        return null;
    }
}


/**
 * メイン処理
 */
async function main() {
    console.log("--- Starting one-time translation process for categories ---");

    const snapshot = await firestore.collection(CATEGORY_COLLECTION).get();
    if (snapshot.empty) {
        console.log("No categories found to translate.");
        return;
    }
    const categories = snapshot.docs;
    console.log(`Found ${categories.length} categories. Starting translation...`);

    // バッチ処理はFirestoreの制限にかかる可能性があるため、1件ずつ更新する方が安全
    let updateCount = 0;
    for (const doc of categories) {
        const translatedData = await translateCategory(doc.data());
        
        if (translatedData) {
            try {
                await doc.ref.set(translatedData);
                updateCount++;
                console.log(`    -> Successfully updated "${translatedData.name.ja}"`);
            } catch (updateError) {
                console.error(`    -> Failed to update "${doc.data().name}":`, updateError);
            }
        }
    }

    console.log(`\n--- Translation process finished. ${updateCount} documents updated. ---`);
}

main().catch(console.error);
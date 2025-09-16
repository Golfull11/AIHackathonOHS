// analyze.js (真の最終確定版：最もシンプルで可読性の高い形式)

import 'dotenv/config';
import { Firestore } from '@google-cloud/firestore';
import { GoogleGenAI } from "@google/genai";

// --- 設定項目 (環境変数から読み込む) ---
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION;

// Firestore設定
const CATEGORY_COLLECTION = 'categories';
const CASES_COLLECTION = 'anzen-site-cases';

// Gemini モデル設定
const MODEL_NAME = "gemini-2.5-flash";

// --- ここからがコード本体 ---
if (!PROJECT_ID) {
    throw new Error("環境変数 'GOOGLE_CLOUD_PROJECT' が設定されていません。");
}

// クライアントの初期化
const firestore = new Firestore();

const genAI = new GoogleGenAI({
    vertexai: true,
    project: PROJECT_ID,
    location: LOCATION,
});

/**
 * カテゴリ名を生成する関数
 */
async function generateCategoryNames(samples) {
    console.log(`\n1. Generating 50 category names from all ${samples.length} valid cases...`);
    const sampleSummaries = samples.map(s => `- タイトル: ${s.title}\n  原因: ${s.原因}`).join('\n\n');
    const prompt = `あなたは経験豊富な労働安全コンサルタントです。以下の労働災害事例リストを分析し、これらの事例を包括的に分類するための、最適なカテゴリを50個作成してください。各カテゴリ名は日本語で最大30文字とし、類似しすぎないように網羅的に作成してください。回答はカテゴリ名だけを番号付きリスト形式（1. カテゴリ名1...）で出力してください。他の文章は一切含めないでください。\n\n【労働災害事例リスト】\n${sampleSummaries}\n\n回答:`;
    
    try {
        const result = await genAI.models.generateContent({model: MODEL_NAME, contents: prompt});
        const rawText = result.candidates[0].content.parts[0].text;
        
        const categories = rawText.split('\n').map(line => line.replace(/^\d+\.\s*/, '').trim()).filter(Boolean);
        if (categories.length < 40) throw new Error("Failed to generate enough categories.");
        console.log("-> Category names generated successfully.");
        return categories;
    } catch (error) {
        console.error("Fatal error during category name generation:", error);
        throw error;
    }
}

/**
 * 個々の事例を分類する関数
 */
async function classifyCase(caseData, categoryNames) {
    const prompt = `あなたは分類のエキスパートです。以下の災害事例を、指定されたカテゴリリストの中から最も適切と思われるものを一つだけ選び、そのカテゴリ名だけを回答してください。\n\n【指定カテゴリリスト】\n${categoryNames.join(", ")}\n\n【分析対象の災害事例】\nタイトル: ${caseData.title}\n原因: ${caseData.原因}\n\n回答（カテゴリ名のみ）:`;
    try {
        const result = await genAI.models.generateContent({model: MODEL_NAME, contents: prompt});
        // ★★★ ご指摘の通り、正しいレスポンスのアクセス方法に修正 ★★★
        return result.candidates[0].content.parts[0].text.trim();
    } catch (error) {
        console.error(`Error classifying case ${caseData.id}:`, error);
        return "その他";
    }
}

/**
 * カテゴリごとの詳細情報（内容記述、対策）を生成する関数
 */
async function generateCategoryDetails(categoryName, cases) {
    console.log(`  Generating details for category: "${categoryName}"...`);
    const caseSummaries = cases.map(c => `タイトル: ${c.title}\n原因: ${c.原因}\n対策: ${c.対策}`).join('\n\n');
    
    const descriptionPrompt = `以下の災害事例群はすべて「${categoryName}」に分類されます。これらの事例に共通する事故の状況を、200文字程度で要約してください。\n\n【事例群】\n${caseSummaries}\n\n要約:`;
    const measuresPrompt = `以下の災害事例群はすべて「${categoryName}」に分類されます。これらの事例から、実施すべき最も重要な対策を3つ、それぞれ50文字程度で抽出・要約してください。回答は番号付きリスト形式（1. 対策1...）で出力してください。番号付きリスト以外の文章は必要ありません。タイトル、全文は省略し、対策のリストのみを出力してください。\n\n【事例群】\n${caseSummaries}\n\n対策:`;
    
    try {
        const [descResult, measuresResult] = await Promise.all([
            genAI.models.generateContent({model: MODEL_NAME, contents: descriptionPrompt}),
            genAI.models.generateContent({model: MODEL_NAME,contents: measuresPrompt})
        ]);
        
        const jaDescription = descResult.candidates[0].content.parts[0].text.trim();
        const jaMeasuresText = measuresResult.candidates[0].content.parts[0].text.trim();
        const jaMeasures = jaMeasuresText.split('\n').map(line => line.replace(/^\d+\.\s*/, '').trim()).filter(Boolean);

        // 2. 生成した日本語のテキストを、他の言語に翻訳させる
        console.log(`    Translating content for "${categoryName}"...`);
        const translationPrompt = `あなたはプロの翻訳家です。以下の日本語のJSONオブジェクトの各値を、英語(en)、ベンガル語(bn)、簡体字中国語(zh)に正確に翻訳してください。回答は指定されたJSON形式のみで、他の言葉は一切含めないでください。\n\n【翻訳対象のJSON】
{
  "name": "${categoryName}",
  "description": "${jaDescription}",
  "measures": ${JSON.stringify(jaMeasures)}
}

【出力形式のJSON】
{
  "en": { "name": "...", "description": "...", "measures": ["...", "...", "..."] },
  "bn": { "name": "...", "description": "...", "measures": ["...", "...", "..."] },
  "zh": { "name": "...", "description": "...", "measures": ["...", "...", "..."] }
}
`;
        const translationResult = await model.generateContent(translationPrompt);
        // Geminiの返答からJSON部分だけを抜き出す
        const jsonString = translationResult.response.text().match(/\{[\s\S]*\}/)[0];
        const translations = JSON.parse(jsonString);

        // 3. 全言語のデータを結合して返す
        const finalData = {
            name: { ja: categoryName, ...Object.fromEntries(Object.entries(translations).map(([lang, data]) => [lang, data.name])) },
            description: { ja: jaDescription, ...Object.fromEntries(Object.entries(translations).map(([lang, data]) => [lang, data.description])) },
            measures: { ja: jaMeasures, ...Object.fromEntries(Object.entries(translations).map(([lang, data]) => [lang, data.measures])) }
        };

        return finalData;

    } catch (error) {
        console.error(`Error generating details for "${categoryName}":`, error);
        return { description: "生成失敗", measures: ["生成失敗", "生成失敗", "生成失敗"] };
    }
}


/**
 * メイン処理
 */
async function main() {
    console.log("--- Starting Full Categorization and Content Generation Process (Corrected) ---");

    // 1. Firestoreから'title','原因','対策'が全て存在するデータを取得
    console.log("Fetching all valid data from Firestore...");
    const query = firestore.collection(CASES_COLLECTION)
        .where('title', '>', '')
        .where('原因', '>', '')
        .where('対策', '>', '');
    const snapshot = await query.get();
    if (snapshot.empty) {
        console.error("No documents with 'title', '原因', and '対策' found.");
        return;
    }
    const allCases = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log(`-> Found ${allCases.length} valid documents.`);

    // 2. カテゴリ名を生成
    const categoryNames = await generateCategoryNames(allCases);

    // 3. 全事例をカテゴリに分類
    console.log("\n2. Classifying all cases into generated categories...");
    const casesByCategory = {};
    categoryNames.forEach(name => { casesByCategory[name] = []; });
    const caseIdToCategoryName = {};

    for (const caseData of allCases) {
        const categoryName = await classifyCase(caseData, categoryNames);
        if (casesByCategory[categoryName]) {
            casesByCategory[categoryName].push(caseData);
        } else {
            casesByCategory["その他"] = casesByCategory["その他"] || [];
            casesByCategory["その他"].push(caseData);
        }
        caseIdToCategoryName[caseData.id] = categoryName;
        console.log(`  Case ${caseData.id} classified as "${categoryName}"`);
    }
    console.log("-> All cases classified.");

    // 4. カテゴリ情報を生成し、`categories`コレクションに保存
    console.log("\n3. Generating and saving details for each category...");
    const categoryNameToId = {};
    for (const categoryName of categoryNames) {
        // ...
        const details = await generateCategoryDetails(categoryName, casesInThisCategory);
        
        if (details) { // ★★★ detailsがnullでない場合のみ保存 ★★★
            const categoryDocRef = firestore.collection(CATEGORY_COLLECTION).doc();
            // ★★★ 多言語対応したdetailsオブジェクトをそのまま保存 ★★★
            await categoryDocRef.set(details); 
            categoryNameToId[categoryName] = categoryDocRef.id;
            console.log(`-> Saved multi-language category: "${categoryName}" with ID: ${categoryDocRef.id}`);
        }
    }

    // 5. 元の事例データにカテゴリIDを書き戻す
    console.log("\n4. Updating original cases with category IDs...");
    const batch = firestore.batch();
    for (const caseData of allCases) {
        const assignedCategoryName = caseIdToCategoryName[caseData.id];
        const assignedCategoryId = categoryNameToId[assignedCategoryName];
        if (assignedCategoryId) {
            const caseDocRef = firestore.collection(CASES_COLLECTION).doc(caseData.id);
            batch.update(caseDocRef, { categoryId: assignedCategoryId });
        }
    }
    await batch.commit();
    console.log(`-> Updated ${allCases.length} documents with category IDs.`);

    console.log("\n--- Process Finished ---");
}

main().catch(console.error);
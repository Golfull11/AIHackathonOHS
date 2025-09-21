import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Firestore } from '@google-cloud/firestore';
import { GoogleGenAI } from "@google/genai";
import fetch from 'node-fetch';
import puppeteer from 'puppeteer';
import { Storage } from '@google-cloud/storage';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

// --- 設定 ---
const PORT = process.env.PORT || 8080;
const CATEGORY_COLLECTION = 'categories';
const EMBEDDING_MODEL_NAME = "gemini-embedding-001";
const TEXT_MODEL_NAME = "gemini-2.5-flash"
const IMAGE_MODEL_NAME = "imagen-4.0-generate-001"
const MIN_VIDEO_SIZE_BYTES = 51200; // 50KB
const storage = new Storage();

// --- 環境変数 ---
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION;
const BUCKET_NAME = process.env.BUCKET_NAME
// const RAG_CORPUS = process.env.RAG_CORPUS_NAME

// --- クライアント初期化 ---
const app = express();
const firestore = new Firestore();
const genAI = new GoogleGenAI({
        vertexai: true,
        project: PROJECT_ID,
        location: LOCATION,
    });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// 'public' フォルダの中身をウェブサイトとして公開します
app.use(express.static(path.join(__dirname, 'public')));

app.use(cors());
app.use(express.json());

let categoryCache = [];

function cosineSimilarity(vecA, vecB) {
    const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
    if (magnitudeA === 0 || magnitudeB === 0) return 0;
    return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * ファイルサイズをチェックする関数 (修正版)
 */
async function filterValidVideos(videoUrls) {
    if (!videoUrls) return {};

    const checks = Object.entries(videoUrls).map(async ([type, url]) => {
        if (!url) return { type, url: null, isValid: false };
        try {
            const response = await fetch(url, { method: 'HEAD' });
            const contentLength = response.headers.get('content-length');
            if (contentLength && parseInt(contentLength, 10) > MIN_VIDEO_SIZE_BYTES) {
                return { type, url, isValid: true };
            }
        } catch (error) {
            console.error(`Error checking video size for ${url}:`, error);
        }
        return { type, url, isValid: false };
    });

    const results = await Promise.all(checks);

    const validVideoUrls = results
        .filter(result => result.isValid)
        .reduce((obj, result) => {
            obj[result.type] = result.url;
            return obj;
        }, {});
    
    console.log("Original URLs:", videoUrls);
    console.log("Filtered Valid URLs:", validVideoUrls);

    return validVideoUrls;
}

/**
 * ★★★ 新しい関数：テキストを日本語に翻訳する ★★★
 */
async function translateToJapanese(text) {
    if (!text) return "";
    const prompt = `以下のテキストを日本語に翻訳してください。翻訳結果のテキストだけを返してください。専門用語はできるだけ正確に翻訳してください。\n\nテキスト：\n"${text}"\n\n日本語訳:`;
    try {
        const result = await genAI.models.generateContent({model: TEXT_MODEL_NAME, contents: prompt});
        // ★★★ ご指摘の通り、一貫性のある正しいレスポンス処理に修正 ★★★
        if (result && result.response && result.response.candidates && result.response.candidates.length > 0) {
            return result.text.trim();
        } else {
            // 万が一、予期しないレスポンス構造だった場合のフォールバック
            console.error("Unexpected response structure from translation API:", JSON.stringify(result, null, 2));
            throw new Error("Invalid response structure from translation API.");
        }
    } catch (error) {
        console.error("Error during translation to Japanese:", error);
        return text; // 翻訳に失敗した場合は、元のテキストをそのまま返す
    }
}

/**
 * APIエンドポイント: /search
 */
app.post('/search', async (req, res) => {
    const { query, lang = 'ja' } = req.body;
    if (!query) return res.status(400).send({ error: 'Query text is required.' });

    try {
        console.log(`Original query: "${query}" (lang: ${lang})`);
        const japaneseQuery = (lang === 'ja') ? query : await translateToJapanese(query);
        console.log(`Translated query (ja): "${japaneseQuery}"`);

        const queryResult = await genAI.models.embedContent({ model: EMBEDDING_MODEL_NAME, contents: japaneseQuery });
        const queryEmbedding = queryResult.embeddings[0].values;

        let bestMatch = { score: -1, category: null };
        for (const category of categoryCache) {
            if (category.embedding && category.embedding.length === 3072) {
                const score = cosineSimilarity(queryEmbedding, category.embedding);
                if (score > bestMatch.score) {
                    bestMatch = { score, category };
                }
            }
        }
        
        if (!bestMatch.category) return res.status(404).send({ error: 'No matching category found.' });

        const matchedCategory = bestMatch.category;
        const validVideoUrls = await filterValidVideos(matchedCategory.videoUrls);
        const responseData = {
            id: matchedCategory.id,
            name: matchedCategory.name[lang] || matchedCategory.name.ja,
            description: matchedCategory.description[lang] || matchedCategory.description.ja,
            measures: matchedCategory.measures[lang] || matchedCategory.measures.ja,
            videoUrls: validVideoUrls,
            additionalSuggestions: [],
        };

        // ★★★ ここからが簡易RAGの実装部分です ★★★

        // 1. Firestoreから最新5件の事故事例を取得
        let recentCasesContext = "社内で最近発生した関連事故事例はありません。";
        try {
            const snapshot = await firestore.collection('internal_cases')
                .orderBy('createdAt', 'desc')
                .limit(50)
                .get();
            
            if (!snapshot.empty) {
                const cases = snapshot.docs.map(doc => {
                    const data = doc.data();
                    return `- タイトル: ${data.title}\n  状況: ${data.description}\n  原因: ${data.cause}\n  対策: ${data.measures}`;
                });
                recentCasesContext = `【社内で最近発生した関連事故事例】\n${cases.join('\n\n')}`;
            }
        } catch (firestoreError) {
            console.error("Error fetching recent cases from Firestore:", firestoreError);
        }

        // 1. Geminiに渡すプロンプト (RAGに関する記述を削除)
        const additionalSuggestionPrompt = `
    あなたは非常に慎重な労働安全の専門家です。
    以下の【社内で最近発生した関連事故事例】を最優先で参照し、ユーザーの作業内容に関連性が高い場合は、その教訓を必ず反映させてください。
    その上で、以下の「ユーザーの作業内容」に対して、追加で注意すべき実践的な安全対策を10個、重要な順に、簡潔な箇条書き（- 対策文）で提案してください。
    さらに、各対策文に対して、以下の【アイコンリスト】の中から最も関連性の高いアイコン名を1つだけ選び、"icon: [アイコン名]" の形式で付記してください。

    回答はユーザーが指定した言語（${lang}）で記述してください。

    ${recentCasesContext}

    【アイコンリスト】
    person-falling, bolt, helmet-safety, triangle-exclamation, fire, tools, truck-moving, user-doctor, temperature-high, wind

    【ユーザーの作業内容】
    ${query}

    【関連する災害カテゴリ】
    名前: ${matchedCategory.name[lang] || matchedCategory.name.ja}
    
    【出力形式の例】
    - ヘルメットを必ず着用してください。 icon: helmet-safety
    - 足元が不安定な場所では作業しないでください。 icon: person-falling

    【追加の安全提案】
`;
        
        // 2. コンテンツを生成
        const result = await genAI.models.generateContent({
            model: TEXT_MODEL_NAME,
            contents: additionalSuggestionPrompt
        });
        
        const suggestionText = result.text;

        // ★★★ Geminiの返答をパースして、テキストとアイコンのオブジェクト配列に変換 ★★★
        responseData.additionalSuggestions = suggestionText.trim().split('\n').map(line => {
        const match = line.match(/-\s*(.*?)\s*icon:\s*(\S+)/);
        if (match) {
            return { text: match[1].trim(), icon: match[2].trim() };
        }
        // マッチしなかった場合は、テキストのみを返す
        return { text: line.replace(/-\s*/, '').trim(), icon: 'triangle-exclamation' };
        }).filter(item => item.text);

        console.log(`Matched Category: "${responseData.name}" (Score: ${bestMatch.score})`);
        res.status(200).send(responseData);


    } catch (error) {
        console.error("Error during search:", error);
        res.status(500).send({ error: 'An internal error occurred.' });
    }
});

/**
 * ★★★ 新しい関数：Imagenでピクトグラムを生成し、Storageに保存してURLを返す ★★★
 */
async function generateAndUploadPictogram(text, fileName) {
    console.log(`Generating pictogram for: "${text}"`);
    const prompt = `Create a single, clear, universally understandable safety pictogram.

**Scene to depict:**
Visually represent the core concept of the following safety rule: "${text}"
Simple and clear flat illustration for a safety manual. No text and no characters in this illustration. Vector style. White background. Limited color palette based on blue, yellow, and gray. The characters are simple and gender-neutral.
`;
    
    try {
        const result = await genAI.models.generateImages({model: IMAGE_MODEL_NAME, prompt: prompt, config:{numberOfImages: 1}});
        for (const generatedImage of result.generatedImages){
            let imgBytes = generatedImage.image.imageBytes;
            const buffer = Buffer.from(imgBytes, "base64");
            const tempFilePath = path.join(os.tmpdir(), fileName);
            fs.writeFileSync(tempFilePath, buffer);
            const destinationPath = `pictograms/${fileName}`;
            await storage.bucket(BUCKET_NAME).upload(tempFilePath, { destination: destinationPath });
            fs.unlinkSync(tempFilePath);
            
            const file = storage.bucket(BUCKET_NAME).file(destinationPath);
            await file.makePublic();
            return file.publicUrl();
            }
        }catch (error) {
        console.error(`Error generating pictogram for "${text}":`, error);
        return null;
    }
}

/**
 * ★★★ 新しいエンドポイント：/generate-pdf ★★★
 */
app.post('/generate-pdf', async (req, res) => {
    const { categoryId, userQuery, additionalSuggestions, lang = 'ja' } = req.body;
    if (!categoryId || !userQuery || !additionalSuggestions) {
        return res.status(400).send({ error: 'Required fields are missing.' });
    }

    try {
        console.log(`Generating PDF for categoryId: ${categoryId} in lang: ${lang}`);
        const doc = await firestore.collection(CATEGORY_COLLECTION).doc(categoryId).get();
        if (!doc.exists) return res.status(404).send({ error: 'Category not found.' });
        const category = doc.data();

        const nameText = category.name[lang] || category.name.ja;
        const descriptionText = category.description[lang] || category.description.ja;
        const measuresTexts = category.measures[lang] || category.measures.ja;
        
        const validMeasures = []; 
        const measurePrompts = [];
        (category.measures.ja || []).forEach((measure, i) => {
            const cleanText = measure.replace(/【.*?】/g, '').trim();
            if (cleanText) {
                measurePrompts.push(cleanText);
                validMeasures.push(measuresTexts[i] || measure);
            }
        });

        const validSuggestions = [];
        const suggestionPrompts = [];
        additionalSuggestions.forEach((suggestion) => {
            const cleanText = suggestion.text.replace(/【.*?】/g, '').trim();
            if (cleanText) {
                suggestionPrompts.push(cleanText);
                validSuggestions.push(cleanText);
            }
        });

        const pictogramTasks = [
            ...measurePrompts.map((prompt, i) => generateAndUploadPictogram(prompt, `pictogram_${categoryId}_measure${i}.png`)),
            ...suggestionPrompts.map((prompt, i) => generateAndUploadPictogram(prompt, `pictogram_${categoryId}_add${i}.png`))
        ];
        
        const pictogramUrls = await Promise.all(pictogramTasks);
        
        const pdfLabels = {
            ja: { title: "【安全報告書】", task: "■ 作業内容:", measures: "実施すべき対策", suggestions: "Geminiからの追加提案" },
            en: { title: "【Safety Report】", task: "■ Work Task:", measures: "Measures to be Taken", suggestions: "Additional Suggestions from Gemini" },
            bn: { title: "【নিরাপত্তা প্রতিবেদন】", task: "■ কাজের বিবরণ:", measures: "গ্রহণযোগ্য পদক্ষেপ", suggestions: "Gemini থেকে অতিরিক্ত পরামর্শ" },
            zh: { title: "【安全报告】", task: "■ 工作内容:", measures: "应采取的措施", suggestions: "来自Gemini的额外建议" }
        };
        const labels = pdfLabels[lang] || pdfLabels.ja;

        const headContent = `
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: 'Noto Sans CJK JP', 'Noto Sans Bengali', sans-serif; font-size: 12px; }
                    .page { page-break-after: always; }
                    .pictogram-img { 
                        width: 180px; 
                        height: 180px; 
                        vertical-align: middle; 
                        margin-right: 20px; 
                        flex-shrink: 0;}
                    li { list-style: none; margin-bottom: 25px; display: flex; align-items: center; }
                    h1, h2 { border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 15px; }
                    p { margin-bottom: 10px; line-height: 1.6; }
                </style>
            </head>
        `;

        const page1Content = `
            <div class="page">
                <h1>${labels.title}</h1>
                <p><strong>${labels.task}</strong> ${userQuery}</p>
                <hr>
                <h2>${nameText}</h2>
                <p>${descriptionText}</p>
                <h2>${labels.measures}</h2>
                <ul>
                    ${validMeasures.map((measure, i) => `<li><img class="pictogram-img" src="${pictogramUrls[i] || ''}" alt=""><span>${measure}</span></li>`).join('')}
                </ul>
            </div>
        `;

        let suggestionPagesContent = '';
        const suggestionsPerPage = 4;
        for (let i = 0; i < validSuggestions.length; i += suggestionsPerPage) {
            const chunk = validSuggestions.slice(i, i + suggestionsPerPage);
            const chunkPictogramUrls = pictogramUrls.slice(validMeasures.length + i, validMeasures.length + i + suggestionsPerPage);
            
            const isLastPage = (i + suggestionsPerPage) >= validSuggestions.length;
            const pageClass = isLastPage ? '' : 'page';

            suggestionPagesContent += `
                <div class="${pageClass}">
                    <h2>${labels.suggestions}</h2>
                    <ul>
                        ${chunk.map((suggestion, j) => `<li><img class="pictogram-img" src="${chunkPictogramUrls[j] || ''}" alt=""><span>${suggestion}</span></li>`).join('')}
                    </ul>
                </div>
            `;
        }

        const htmlContent = `
            <!DOCTYPE html>
            <html>
                ${headContent}
                <body>
                    ${page1Content}
                    ${suggestionPagesContent}
                </body>
            </html>
        `;
        
        const footerTemplate = `
          <div style="font-size: 8px; width: 100%; color: #888; padding: 0 40px; display: flex; justify-content: space-between; align-items: center;">
            <div style="text-align: left;">
              「職場のあんぜんサイト」（厚生労働省）を加工して作成
            </div>
            <div style="text-align: right;">
              &copy; 2025 DXGX consult. All Rights Reserved.
            </div>
          </div>
            `;

        const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            displayHeaderFooter: true,
            footerTemplate: footerTemplate,
            margin: {
                top: '40px',
                bottom: '60px',
                left: '40px',
                right: '40px'
            }
        });
        await browser.close();

        const pdfFileName = `reports/${categoryId}_${Date.now()}.pdf`;
        const file = storage.bucket(BUCKET_NAME).file(pdfFileName);
        await file.save(pdfBuffer, { contentType: 'application/pdf' });
        
        res.status(200).send({ pdfUrl: file.publicUrl() });

    } catch (error) {
        console.error("Error generating PDF:", error);
        res.status(500).send({ error: 'Failed to generate PDF.' });
    }
});

/**
 * 事例登録用エンドポイント
 */
app.post('/internal-cases', async (req, res) => {
    // フロントエンドから送信されるデータを全て受け取る
    const { title, description, cause, measures, occurredAt } = req.body;
    
    // 必須項目のチェック
    if (!title || !description || !cause || !measures) {
        return res.status(400).send({ error: 'Required fields are missing.' });
    }

    try {
        const docRef = await firestore.collection('internal_cases').add({
            title,
            description,
            cause,
            measures,
            // 受け取った occurredAt をDateオブジェクトに変換して保存
            occurredAt: occurredAt ? new Date(occurredAt) : null, 
            // 登録日時をサーバーサイドで自動生成
            createdAt: new Date(),
        });
        console.log(`New internal case saved with ID: ${docRef.id}`);
        res.status(201).send({ message: 'Case saved successfully.', id: docRef.id });
    } catch (error) {
        console.error("Error saving internal case:", error);
        res.status(500).send({ error: 'Failed to save case.' });
    }
});

/**
 * サーバーを起動するメイン関数
 */
async function startServer() {
    const snapshot = await firestore.collection(CATEGORY_COLLECTION).get();
    const allCategories = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    categoryCache = allCategories.filter(category => {
        const hasValidDescription = category.description && category.description.ja && category.description.ja !== '生成失敗';
        const hasValidEmbedding = category.embedding && category.embedding.length === 3072;
        return hasValidDescription && hasValidEmbedding;
    });

    console.log(`Loaded and cached ${categoryCache.length} valid categories.`);
    app.listen(PORT, () => {
        console.log(`API server listening on port ${PORT}`);
    });
}

startServer();
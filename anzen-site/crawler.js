// crawler.js (Playwright版 - 全件取得ループ対応)

const { chromium } = require('playwright');
const { Firestore } = require('@google-cloud/firestore');
const lodash = require('lodash');

// --- グローバル設定 ---
const firestore = new Firestore();
const COLLECTION_NAME = 'anzen-site-cases';

/**
 * データをFirestoreに保存する関数。変更があった場合のみ書き込みを行う。
 * (この関数は変更ありません)
 */
async function saveToFirestore(data) {
    if (!data || !data.id) {
        console.error('  [Firestore Error] Data or data.id is missing. Cannot save.');
        return;
    }
    const docRef = firestore.collection(COLLECTION_NAME).doc(data.id);
    try {
        const doc = await docRef.get();
        if (!doc.exists) {
            await docRef.set(data);
            console.log(`  [Firestore CREATED] ID: ${data.id}`);
        } else {
            if (!lodash.isEqual(doc.data(), data)) {
                await docRef.set(data);
                console.log(`  [Firestore UPDATED] ID: ${data.id}`);
            } else {
                console.log(`  [Firestore SKIPPED] ID: ${data.id}`);
            }
        }
    } catch (error) {
        console.error(`  [Firestore Error] ID ${data.id}:`, error);
    }
}

/**
 * メインのクローリング処理
 */
async function main() {
    console.log('--- Starting Playwright Full Scan Crawler ---');

    const browser = await chromium.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        // 1. 全業種のリストを取得
        await page.goto('https://anzeninfo.mhlw.go.jp/anzen_pg/sai_fnd.aspx');
        const industries = await page.$$eval('select[name="gyosyu"] option', options => {
            return options.map(opt => ({ value: opt.value, name: opt.innerText.trim() }))
                          .filter(opt => opt.value !== ''); // 「指定なし」を除外
        });

        let totalScrapedCount = 0;

        // 2. 全業種をループで処理
        for (const industry of industries) {
            console.log(`\n\n=== Processing Industry: ${industry.name} (value: ${industry.value}) ===`);
            
            // 検索ページに戻る（または初期表示）
            await page.goto('https://anzeninfo.mhlw.go.jp/anzen_pg/sai_fnd.aspx');
            
            // 現在の業種を選択して検索
            await page.selectOption('select[name="gyosyu"]', industry.value);
            await page.click('input[value="検索開始"]');

            // 検索結果の有無を確認
            try {
                await page.waitForSelector('ul.sai_lst', { timeout: 15000 });
                console.log(`Navigated to search results for "${industry.name}".`);
            } catch(e) {
                console.log(`No results found for "${industry.name}". Skipping.`);
                continue; // 次の業種へ
            }
            
            // 3. ページネーションループ
            let currentPageNum = 1;
            while (true) {
                console.log(`\n--- Scraping Page ${currentPageNum} for "${industry.name}" ---`);
                
                // ページ内の全事例リンクを取得
                const caseLinks = await page.$$('ul.sai_lst > li a');
                console.log(`Found ${caseLinks.length} cases on this page.`);
                if (caseLinks.length === 0) break;

                // 4. ページ内の全事例をループ
                for (const link of caseLinks) {
                    try {
                        // ポップアップを開いて情報を取得
                        const [popup] = await Promise.all([
                            page.waitForEvent('popup', { timeout: 60000 }),
                            link.click(),
                        ]);
                        await popup.waitForLoadState('networkidle');

                        const caseData = await popup.evaluate(() => {
                            const data = {};
                            const titleElement = document.querySelector('h3');
                            if (titleElement) data.title = titleElement.innerText.trim();
                            const idElement = document.querySelector("section.sai_case_detail > p");
                            if (idElement) {
                                const match = idElement.innerText.match(/\d+/);
                                if (match) data.id = match[0];
                            }
                            document.querySelectorAll('table.tbl_1_1 tr').forEach(row => {
                                const th = row.querySelector('th');
                                const td = row.querySelector('td');
                                if (th && td) data[th.innerText.replace(/\s+/g, ' ').trim()] = td.innerText.trim();
                            });
                            document.querySelectorAll('.detail_item h4').forEach(h4 => {
                                const key = h4.innerText.trim();
                                const contentElement = h4.nextElementSibling;
                                if (contentElement) data[key] = contentElement.innerText.trim();
                            });
                            return data;
                        });
                        
                        await saveToFirestore(caseData);
                        totalScrapedCount++;
                        
                        await popup.close();

                    } catch (popupError) {
                        console.error('  [Error] Failed to process a detail page:', popupError.message);
                        // ポップアップ処理でエラーが起きても、ループは継続する
                    }
                }

                // 「次へ」ボタンを探してクリック
                const nextButton = await page.$('li.next a');
                if (nextButton) {
                    console.log('Navigating to the next page...');
                    // クリック後のナビゲーション完了を待つ
                    await Promise.all([
                        page.waitForNavigation({ waitUntil: 'networkidle' }),
                        nextButton.click(),
                    ]);
                    currentPageNum++;
                } else {
                    console.log('No "Next" button found. This is the last page for this industry.');
                    break; // ページネーションループを終了
                }
            }
        }

        console.log(`\n\n--- Crawling Finished ---`);
        console.log(`Total cases processed and saved/updated: ${totalScrapedCount}`);

    } catch (error) {
        console.error('\n\n--- A critical error occurred during the main process ---', error);
    } finally {
        await browser.close();
        console.log('Browser closed.');
    }
}

main();
// app.js

// ローカルテスト時: 'http://localhost:8080/search'
const API_URL = 'http://localhost:8080/search';
// Cloud Runデプロイ後:
//const API_URL = 'https://safety-api-service-467976745475.asia-northeast1.run.app/search'

const searchInput = document.getElementById('searchInput');
const searchButton = document.getElementById('searchButton');
const loading = document.getElementById('loading');
const resultContainer = document.getElementById('result-container');
const errorMessage = document.getElementById('error-message');

const categoryName = document.getElementById('category-name');
const categoryDescription = document.getElementById('category-description');
const measuresList = document.getElementById('measures-list');
const videoDescription = document.getElementById('video-description');
const videoMeasure = document.getElementById('video-measure');
const langSelect = document.getElementById('lang-select');

const geminiSuggestionsList = document.getElementById('gemini-suggestions-list');

const generateDocButton = document.getElementById('generateDocButton');

// ★★★ APIから返ってきたデータを一時的に保持する変数 ★★★
let currentCategoryData = null;

/**
 * UIのテキストを指定された言語で更新する関数
 */
async function updateUI(lang) {
    // 対応する言語のJSONファイルを読み込む
    const response = await fetch(`./locales/${lang}.json`);
    const resources = await response.json();
    
    // i18nextを初期化
    await i18next.init({
        lng: lang,
        debug: true, // デバッグモードON
        resources: {
            [lang]: resources
        }
    });

    // data-i18n属性を持つ全ての要素のテキストを更新
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        
        // placeholder属性の場合
        if (key.startsWith('[placeholder]')) {
            const placeholderKey = key.replace('[placeholder]', '');
            element.placeholder = i18next.t(placeholderKey);
        } else {
            element.textContent = i18next.t(key);
        }
    });
}

// 言語選択プルダウンの変更イベント
langSelect.addEventListener('change', (event) => {
    updateUI(event.target.value);
});

// ページ読み込み完了時に、デフォルト言語（日本語）でUIを初期化
document.addEventListener('DOMContentLoaded', () => {
    updateUI('ja');
});

searchButton.addEventListener('click', async () => {
    const query = searchInput.value.trim();
    const selectedLang = langSelect.value;
    if (!query) {
        alert('作業内容を入力してください。');
        return;
    }

    resultContainer.classList.add('hidden');
    errorMessage.classList.add('hidden');
    loading.classList.remove('hidden');

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: query, lang: selectedLang }),
        });
        if (!response.ok) { throw new Error(`APIエラー: ${response.statusText}`); }
        const data = await response.json();
        currentCategoryData = data;
        displayResults(data);
    } catch (error) {
        console.error('検索エラー:', error);
        displayError('情報の取得に失敗しました。もう一度お試しください。');
    } finally {
        loading.classList.add('hidden');
    }
});

// ★★★ 文書生成ボタンのクリックイベントを新しく追加 ★★★
generateDocButton.addEventListener('click', async () => {
    if (!currentCategoryData) {
        alert("まず作業内容を検索してください。");
        return;
    }

    // ボタンを無効化し、テキストを変更
    generateDocButton.disabled = true;
    generateDocButton.textContent = "文書を作成中...";

    try {
        const response = await fetch('http://localhost:8080/generate-pdf', { // PDF生成APIのURL
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                categoryId: currentCategoryData.id,
                userQuery: searchInput.value.trim(),
                additionalSuggestions: currentCategoryData.additionalSuggestions, // Geminiの提案も送る
                lang: langSelect.value,
            }),
        });

        if (!response.ok) throw new Error('PDF生成に失敗しました。');

        const result = await response.json();
        // 新しいタブでPDFを開く
        window.open(result.pdfUrl, '_blank');

    } catch (error) {
        console.error("PDF生成エラー:", error);
        alert(error.message);
    } finally {
        // ボタンを元に戻す
        generateDocButton.disabled = false;
        generateDocButton.textContent = i18next.t('generate_doc_button');
    }
});


function displayResults(data) {
    categoryName.textContent = data.name;
    categoryDescription.textContent = data.description;

    measuresList.innerHTML = '';
    data.measures.forEach(measure => {
        const li = document.createElement('li');
        li.textContent = measure;
        measuresList.appendChild(li);
    });

    // description動画の表示制御
    const descriptionVideoContainer = videoDescription.parentElement;
    if (data.videoUrls && data.videoUrls.description) {
        videoDescription.src = data.videoUrls.description;
        descriptionVideoContainer.classList.remove('hidden');
    } else {
        descriptionVideoContainer.classList.add('hidden');
    }

    // measure動画の表示制御
    const measureVideoContainer = videoMeasure.parentElement;
    if (data.videoUrls && data.videoUrls.measure_1) {
        videoMeasure.src = data.videoUrls.measure_1;
        measureVideoContainer.classList.remove('hidden');
    } else {
        measureVideoContainer.classList.add('hidden');
    }
    
    // ★★★ Geminiの追加提案をリストで表示するロジック ★★★
    geminiSuggestionsList.innerHTML = ''; // リストをクリア
    if (data.additionalSuggestions && data.additionalSuggestions.length > 0) {
        data.additionalSuggestions.forEach(suggestion => {
            const li = document.createElement('li');
            // Font Awesomeのアイコンを <i> タグで作成
            const icon = document.createElement('i');
            // APIから返されたアイコン名をクラスとして設定 (例: "fa-solid fa-bolt")
            icon.className = `fa-solid fa-${suggestion.icon}`; 
            
            li.appendChild(icon);
            // テキストノードを追加して、アイコンとテキストの間にスペースを入れる
            li.appendChild(document.createTextNode(` ${suggestion.text}`));
            
            geminiSuggestionsList.appendChild(li);
        });
        geminiSuggestionsList.parentElement.classList.remove('hidden');
    } else {
        geminiSuggestionsList.parentElement.classList.add('hidden');
    }

    resultContainer.classList.remove('hidden');
}

function displayError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
}
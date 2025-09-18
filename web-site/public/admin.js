// ★★★ ここに、あなたのCloud Run APIサービスの基本URLを定義 ★★★
// 末尾にスラッシュは付けないでください
const API_BASE_URL = "https://safety-api-service-467976745475.asia-northeast1.run.app";


document.addEventListener('DOMContentLoaded', () => {

    const auth = firebase.auth();

    // DOM要素
    const loginContainer = document.getElementById('login-container');
    const adminPanel = document.getElementById('admin-panel');
    const loginEmailInput = document.getElementById('login-email');
    const loginPasswordInput = document.getElementById('login-password');
    const loginButton = document.getElementById('login-button');
    const loginError = document.getElementById('login-error');
    const userEmailSpan = document.getElementById('user-email');
    const logoutButton = document.getElementById('logout-button');
    const submitCaseButton = document.getElementById('submit-case-button');
    const submitStatus = document.getElementById('submit-status');

    // フォーム要素
    const caseOccurredAt = document.getElementById('case-occurred-at');
    const caseTitle = document.getElementById('case-title');
    const caseDescription = document.getElementById('case-description');
    const caseCause = document.getElementById('case-cause');
    const caseMeasures = document.getElementById('case-measures');

    // --- 多言語対応 ---
    async function updateUI(lang) {
        try {
            const response = await fetch(`./locales/${lang}.json`);
            if (!response.ok) return;
            const resources = await response.json();
            
            // ユーザー向けサイトの翻訳データもマージする
            const mainSiteResponse = await fetch(`./locales/${lang}.json`);
            if(mainSiteResponse.ok) {
                const mainSiteResources = await mainSiteResponse.json();
                Object.assign(resources.translation, mainSiteResources.translation);
            }

            await i18next.init({ lng: lang, resources: { [lang]: resources } });

            document.querySelectorAll('[data-i18n]').forEach(el => {
                const key = el.getAttribute('data-i18n');
                if (key.startsWith('[placeholder]')) {
                    const placeholderKey = key.replace('[placeholder]', '');
                    el.placeholder = i18next.t(placeholderKey);
                } else {
                    el.textContent = i18next.t(key);
                }
            });
        } catch (error) { console.error("Language load error:", error); }
    }
    // デフォルト言語で初期化
    updateUI('ja');


    // --- 認証処理 ---
    loginButton.addEventListener('click', async () => {
        loginError.textContent = '';
        try {
            await auth.signInWithEmailAndPassword(loginEmailInput.value, loginPasswordInput.value);
        } catch (error) {
            loginError.textContent = 'ログインに失敗しました。';
            console.error("Login error:", error);
        }
    });

    logoutButton.addEventListener('click', async () => {
        await auth.signOut();
    });

    auth.onAuthStateChanged(user => {
        if (user) {
            loginContainer.classList.add('hidden');
            adminPanel.classList.remove('hidden');
            userEmailSpan.textContent = user.email;
        } else {
            loginContainer.classList.remove('hidden');
            adminPanel.classList.add('hidden');
        }
    });


    // --- 事例登録処理 ---
    submitCaseButton.addEventListener('click', async () => {
        const caseData = {
            occurredAt: caseOccurredAt.value ? new Date(caseOccurredAt.value) : null,
            title: caseTitle.value,
            description: caseDescription.value,
            cause: caseCause.value,
            measures: caseMeasures.value,
        };

        if (!caseData.title || !caseData.description || !caseData.cause || !caseData.measures) {
            alert("すべての必須項目を入力してください。");
            return;
        }

        submitCaseButton.disabled = true;
        submitStatus.textContent = '登録中...';
        
        try {
            // ★★★ ここが修正箇所：定義したAPIのURLとパスを結合 ★★★
            const response = await fetch(`${API_BASE_URL}/internal-cases`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(caseData)
            });

        // 1. まず、レスポンスが成功(2xx)したかどうかをチェック
        if (!response.ok) {
            // ★★★ HTMLではなく、ステータスコードとテキストだけを取得 ★★★
            const statusText = response.statusText;
            const statusCode = response.status;
            throw new Error(`サーバーエラーが発生しました (ステータス: ${statusCode} ${statusText})`);
        }

        // 4. 成功した場合のみ、JSONとしてパースする
        const result = await response.json();

        submitStatus.textContent = `登録が完了しました！ (ID: ${result.id})`;
        // フォームをクリア
        // ...

    } catch (error) {
        // ★★★ catchブロックで、エラーオブジェクトの message を表示 ★★★
        // これにより、throwした生のテキストがそのまま表示される
        console.error("Submit error:", error);
        // <pre>タグを使うと、HTMLタグがそのまま表示され、改行も維持される
        submitStatus.textContent = `エラー: ${error.message}`;
    } finally {
        submitCaseButton.disabled = false;
        // 3秒ではなく、エラーが見えるように長めにするか、手動で消すまで残す
        // setTimeout(() => { submitStatus.textContent = ''; }, 3000);
    }
});
});
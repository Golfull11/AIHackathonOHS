// admin.js

// Firebaseの初期化と認証オブジェクトの取得
const auth = firebase.auth();

// DOM要素の取得
const loginContainer = document.getElementById('login-container');
const adminPanel = document.getElementById('admin-panel');
const loginButton = document.getElementById('login-button');
const logoutButton = document.getElementById('logout-button');
const submitCaseButton = document.getElementById('submit-case-button');
// ...その他のフォーム要素...

/**
 * ログイン処理
 */
loginButton.addEventListener('click', async () => {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    try {
        await auth.signInWithEmailAndPassword(email, password);
        // ログイン成功時の処理は authStateObserver が行う
    } catch (error) {
        document.getElementById('login-error').textContent = 'ログインに失敗しました。';
        console.error("Login error:", error);
    }
});

/**
 * ログアウト処理
 */
logoutButton.addEventListener('click', async () => {
    await auth.signOut();
});

/**
 * 事例登録処理
 */
submitCaseButton.addEventListener('click', async () => {
    const caseData = {
        title: document.getElementById('case-title').value,
        description: document.getElementById('case-description').value,
        cause: document.getElementById('case-cause').value,
        measures: document.getElementById('case-measures').value,
    };

    if (!caseData.title || !caseData.description || !caseData.cause || !caseData.measures) {
        alert("すべての項目を入力してください。");
        return;
    }

    submitCaseButton.disabled = true;
    document.getElementById('submit-status').textContent = '登録中...';
    
    try {
        // バックエンドAPIにデータを送信
        const response = await fetch('/internal-cases', { // APIのURL
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(caseData)
        });

        if (!response.ok) throw new Error('サーバーへの保存に失敗しました。');

        document.getElementById('submit-status').textContent = '登録が完了しました！';
        // フォームをクリア
        document.getElementById('case-title').value = '';
        document.getElementById('case-description').value = '';
        document.getElementById('case-cause').value = '';
        document.getElementById('case-measures').value = '';

    } catch (error) {
        document.getElementById('submit-status').textContent = `エラー: ${error.message}`;
    } finally {
        submitCaseButton.disabled = false;
        setTimeout(() => { document.getElementById('submit-status').textContent = ''; }, 3000);
    }
});


/**
 * 認証状態の監視
 */
const authStateObserver = (user) => {
    if (user) {
        // ユーザーがログインしている場合
        loginContainer.classList.add('hidden');
        adminPanel.classList.remove('hidden');
        document.getElementById('user-email').textContent = user.email;
    } else {
        // ユーザーがログアウトしている場合
        loginContainer.classList.remove('hidden');
        adminPanel.classList.add('hidden');
    }
};

// 監視を開始
auth.onAuthStateChanged(authStateObserver);
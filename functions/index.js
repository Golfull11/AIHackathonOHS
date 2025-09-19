// Firebase SDKをインポートします（第2世代の構文）
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

// Firebase Admin SDKを初期化します
admin.initializeApp();

// Cloud Storageのデフォルトバケットを取得します
const bucket = admin.storage().bucket("safety-contents-safety-recommend-app-2025");

/**
 * Firestoreの'documents'コレクションに新しいドキュメントが作成されたときにトリガーされます。
 * 作成されたドキュメントのデータを、Cloud StorageにJSONファイルとして保存します。
 *
 * @param {import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined>} event - イベントに関する情報を含むオブジェクト。
 * @returns {Promise<void>}
 */
exports.saveDataToStorage = onDocumentCreated(
  // オプションオブジェクトでリージョンとドキュメントパスを指定します
  {
    // 日本リージョン(asia-northeast1)で関数を実行
    region: "asia-northeast1",
    // 'documents'コレクションのいずれかのドキュメントが対象
    document: "internal_cases/{docId}",
  },
  async (event) => {
    // 第2世代では、データスナップショットは event.data に格納されています
    const snap = event.data;
    if (!snap) {
      console.log("ドキュメントが削除されたため、処理をスキップします。");
      return;
    }
    // イベントからドキュメントIDを取得します
    const docId = event.params.docId;
    // 新しく作成されたドキュメントのデータを取得します
    const newData = snap.data();


    // 保存するファイル名とパスを指定します
    // 例: "documents/abcdef12345.json"
    const filePath = `internal_cases/${docId}.json`;
    const file = bucket.file(filePath);

    // データをJSON形式の文字列に変換します
    // `null, 2` を指定すると、見やすく整形されたJSONになります
    const jsonString = JSON.stringify(newData, null, 2);

    try {
      // JSON文字列をCloud Storageに保存します
      await file.save(jsonString, {
        contentType: "application/json",
      });

      console.log(
        ` Firestoreドキュメント'${docId}'のデータをCloud Storageの'${filePath}'に正常に保存しました。`
      );
    } catch (error) {
      console.error(
        `Cloud Storageへの保存中にエラーが発生しました: docId='${docId}'`,
        error
      );
      // エラーを再スローして、関数の実行が失敗したことをFirebaseに伝えます。
      throw error;
    }
  }
);


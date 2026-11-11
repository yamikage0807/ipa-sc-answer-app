# SC 答案ノート

情報処理安全確保支援士（SC）午後試験の答案を設問ごとに入力し、端末内に保存して採点用ファイルへ出力する静的Webアプリです。GitHub Pagesでホストできます。

## 開発・ビルド

Node.js 20以降を用意してから実行します。

```bash
npm install
npm run dev
npm run build
npm run preview
```

## GitHub Pages

`main`ブランチへpushすると`.github/workflows/deploy.yml`がビルドしてGitHub Pagesへ公開します。GitHubリポジトリの **Settings → Pages → Build and deployment** で **GitHub Actions** を選択してください。`vite.config.ts`の相対ベース設定により、ユーザーサイトとプロジェクトサイトのどちらにも配置できます。

## 問題データの追加

設問データは`src/exam-data.json`に分離しています。新しい試験を追加する場合は、試験メタデータと`sections`を追加し、`src/App.tsx`の`examData`参照を追加データに切り替えてください。

- `type`: `text`、`choice`、`multiText`、`trueFalse`、`image`
- `maxChars`: 字数制限。制限がない設問では省略します
- `options`: 選択式の`value`と`label`
- `fields`: 複数空欄のラベル
- `questionPdfUrl` / `sourcePageUrl`: IPA公式ページへのリンク

初期データの設問文は画面操作を確認するためのオリジナル例題で、令和6年度秋期の実際の過去問ではありません。実際の問題文や解答例を登録する場合は、IPAの利用条件を確認してください。アプリは問題本文を外部送信せず、PDFも公式サイトを開きます。

## 保存と出力

答案はブラウザーの`localStorage`、添付画像は`IndexedDB`に保存します。ブラウザーデータを消去すると答案と画像も削除されます。TXT/JSONには画像名と設問IDが含まれますが、画像ファイル本体は含まれないため、採点時には画像も別途添付してください。クラウド同期やアプリ内採点は行いません。
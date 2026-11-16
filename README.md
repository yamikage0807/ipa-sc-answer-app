# SC 答案ノート

情報処理安全確保支援士（SC）午後試験の答案を大問ごとにまとめて入力し、端末内に保存して採点用ファイルへ出力する静的Webアプリです。令和5年度春・秋、令和6年度春・秋を選択でき、GitHub Pagesでホストできます。

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

通常試験データは`src/exam-data.json`、添付の45問実力診断データは`src/practice-exam-data.json`にあります。実力試験ではA〜Dの問題セットを選択し、設問文・選択肢・空欄数・文字数条件をJSONから表示します。チェックボックス、ラジオ、複数入力、記述式に対応しています。大問内の入力欄は縦に並ぶため、スマートフォンでも続けて回答できます。

- `type`: `text`、`choice`、`multiText`、`trueFalse`、`image`
- `maxChars`: 字数制限。制限がない設問では省略します
- `options`: 選択式の`value`と`label`
- `fields`: 複数空欄のラベル
- `questionPdfUrl` / `sourcePageUrl`: IPA公式ページへのリンク

IPA過去問の問題冊子は回答画面内で表示でき、別タブでも開けます。令和5年度春期は午後I・午後IIの冊子を切り替えて表示します。実力試験の図・表そのものはJSONに含まれないため、図表参照を表示して冊子の該当箇所を確認できるようにしています。実力試験JSONは添付されたOCR整理データをそのまま元にしています。

## 保存と出力

答案はブラウザーの`localStorage`、添付画像は`IndexedDB`に保存します。ブラウザーデータを消去すると答案と画像も削除されます。TXT/JSONには画像名と設問IDが含まれますが、画像ファイル本体は含まれないため、採点時には画像も別途添付してください。クラウド同期やアプリ内採点は行いません。
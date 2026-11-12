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

試験データは`src/exam-data.json`に分離しています。各期の試験を選び、大問単位のページ内目次から問1〜問4へ移動できます。大問内の入力欄は縦に並ぶため、スマートフォンでもスクロールしながら続けて回答できます。

- `type`: `text`、`choice`、`multiText`、`trueFalse`、`image`
- `maxChars`: 字数制限。制限がない設問では省略します
- `options`: 選択式の`value`と`label`
- `fields`: 複数空欄のラベル
- `questionPdfUrl` / `sourcePageUrl`: IPA公式ページへのリンク

公式問題冊子は回答画面内で表示でき、別タブでも開けます。令和5年度春期は午後I・午後IIの冊子を切り替えて表示します。設問欄は入力用のプレースホルダーで、実際の設問数や本文を転記したものではありません。問題本文はアプリに収録せず、端末から外部送信もしません。字数制限や選択肢などを入力欄に反映するには、IPAの利用条件を確認したうえで、権利上利用可能な設問データを登録してください。

## 保存と出力

答案はブラウザーの`localStorage`、添付画像は`IndexedDB`に保存します。ブラウザーデータを消去すると答案と画像も削除されます。TXT/JSONには画像名と設問IDが含まれますが、画像ファイル本体は含まれないため、採点時には画像も別途添付してください。クラウド同期やアプリ内採点は行いません。
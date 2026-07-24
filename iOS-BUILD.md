# KINMATE を iOS アプリにする手順

Capacitor 8 で Web アプリ（このリポジトリ）をネイティブの iOS アプリに包む。
**Windows 側の下ごしらえは済んでいる。以下は Mac での作業。**

- ガワ = Capacitor 8（`@capacitor/core` / `@capacitor/ios` / `@capacitor/cli`）
- Web の実体は `index.html` ＋ `css/` `js/` `assets/`。`npm run build:www` が `www/` に集める。
- `www/` と `ios/` は `.gitignore` 済み（Mac 側で生成）。**index.html を直しただけではアプリに反映されない。** 必ず sync → Xcode で Build 番号 +1 → Archive。

---

## 0. 最初に：Bundle ID を決める（一度公開したら変更不可）

`capacitor.config.json` の `appId` が **`com.example.kinmate`（仮）** になっている。
**`cap add ios` を実行する前に**、自分のドメイン等に合わせて必ず書き換える。

```json
{ "appId": "com.あなたの識別子.kinmate", "appName": "KINMATE", "webDir": "www", "ios": { "contentInset": "always" } }
```

書き換えてから add すると、その ID で Xcode プロジェクトが生成される。add 後に変えるなら Xcode の Signing & Capabilities → Bundle Identifier も直す。

---

## 1. 取得とセットアップ（初回のみ）

```bash
git clone <このリポジトリ> && cd <フォルダ>
npm install
npm run build:www          # www/ を作る
npx cap add ios            # ios/ を生成（CocoaPods が要る： sudo gem install cocoapods）
npx cap open ios           # Xcode が開く
```

Xcode で：
- Signing & Capabilities → Team を自分の Apple Developer アカウントに。
- まずシミュレータで起動確認（データはこの端末＝アプリ内に保存。オフラインで完結）。

---

## 2. アイコン

- App Store 用 1024×1024（角丸・透過なし）は `assets/app-icon-1024.png` にある。
- Xcode の `Assets.xcassets → AppIcon` にドラッグするか、`Assets.xcassets/AppIcon.appiconset` に置く。
- 単一 1024 で足りない場合は appicon 生成ツール（例：`cordova-res` や Xcode の自動生成）で各サイズを作る。

---

## 3. App Store 提出（初回）

1. App Store Connect でアプリを新規登録（Bundle ID・名前 KINMATE）。
2. スクリーンショット（6.7"／6.1"／iPad など要件サイズ）。
3. Xcode：General → Version 1.0 / Build 1。実機を選び **Product → Archive**。
4. Organizer → Distribute App → App Store Connect にアップロード。
5. App Store Connect でメタデータ・年齢レーティング・プライバシーを入力 → 審査に提出。

### 申告のめやす（このアプリの実態）
- **暗号化：対象外（いいえ）。** 独自暗号・SubtleCrypto・通信なし。端末内で完結。
  - 毎回聞かれるのを止めるなら `ios/App/App/Info.plist` に `ITSAppUsesNonExemptEncryption = false`（`ios/` は gitignore なので Xcode で直接追加）。
- **データ収集：なし。** 外部送信ゼロ。入力はすべて端末の localStorage。
- **IDFA／広告：なし**（初回リリースは広告なし）。
- **年齢レーティング：** ソーシャルメディア機能なし（共有は iOS 標準の共有シートだけ、フィード・UGC なし）→「なし／いいえ」。
- サポート URL・プライバシーポリシー URL が要る。GitHub Pages に置くなら `support.html` / `privacy.html` を用意し、**実 URL が 200 で返ることを確認**（過去に Pages のビルド停止で 404 → リジェクトの例あり。`.nojekyll` を置くと Jekyll 起因の停止を防げる）。

---

## 4. 更新するとき（毎回）

Web（`index.html` など）を直したら：

```bash
git pull
npm run sync               # build:www ＋ cap sync ios。これでアプリ側に反映される
npx cap open ios
```

Xcode で：
- **Build 番号を +1**（`xcrun agvtool next-version -all` でも可）。上げないとアップロードが弾かれる。
- Version は公開済みなら上げる（例 1.0 → 1.0.1）。未公開のリジェクト修正なら Version 据え置きで Build だけ +1。
- Archive → アップロード → 提出。

> **index.html を直して push しただけでは、アプリには入らない。** Web版（GitHub Pages）だけが変わる。アプリは必ず Mac で sync → Archive。

---

## 5. うまくいかないとき

- **起動した瞬間に落ちる：** 広告 SDK を入れた場合は `Info.plist` の `GADApplicationIdentifier` 欠落を疑う（このアプリは初回広告なしなので通常は無関係）。
- **Web の変更が反映されない：** `npm run sync` を忘れている／Build 番号を上げていない。
- **セーフエリア（ノッチ）に潜る：** `capacitor.config.json` の `ios.contentInset: always` と、CSS の `env(safe-area-inset-*)` で対応済み。実機で確認する。
- **サポート／プライバシー URL が 404：** GitHub Pages のビルド状態を `gh api repos/<owner>/<repo>/pages` の `status` で確認（`built` が正常）。

---

## メモ

- Web版とアプリは `index.html` を共有する。Web の見た目・挙動を変えれば、次回 sync でアプリにも入る。
- `?v=N`（キャッシュバスター）は Web版のブラウザキャッシュ対策。アプリ内では毎回ローカルから読むので影響しないが、付けたままで問題ない。
- git identity・コミット規約はこのリポジトリの既存設定に従う。

# KINMATE を iOS アプリにする手順

Capacitor 8 で Web アプリ（このリポジトリ）をネイティブの iOS アプリに包む。
**Windows 側の下ごしらえは済んでいる。以下は Mac での作業。**

- ガワ = Capacitor 8（`@capacitor/core` / `@capacitor/ios` / `@capacitor/cli`）
- Web の実体は `index.html` ＋ `css/` `js/` `assets/`。`npm run build:www` が `www/` に集める。
- `www/` と `ios/` は `.gitignore` 済み（Mac 側で生成）。**index.html を直しただけではアプリに反映されない。** 必ず sync → Xcode で Build 番号 +1 → Archive。

---

## 0. Bundle ID（確定済み・一度公開したら変更不可）

`capacitor.config.json` の `appId` は **`com.loge.kinmate`** で確定。
`cap add ios` するとこの ID で Xcode プロジェクトが生成される。
App Store Connect でも同じ Bundle ID `com.loge.kinmate` でアプリを登録する。

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
- サポート URL・プライバシーポリシー URL は用意済み（下記）。**実 URL が 200 で返ることを確認**してから入力する（過去に Pages のビルド停止で 404 → リジェクトの例あり。`.nojekyll` は配置済み）。
  - プライバシー： https://tmk4men.github.io/shift-maker/privacy.html
  - サポート： https://tmk4men.github.io/shift-maker/support.html

---

## 3.5 TestFlight 外部テスト（ベータ版App審査）

外部テスターに配るには Beta App Review が要る。初回だけ審査があり、以降は同一 Version ならビルドを差し替えても基本ノーチェック。

**App Store Connect に入れる値**

| 場所 | 値 |
|---|---|
| 年齢レーティング | 全項目「なし」→ 4+ |
| Appのプライバシー | データを収集しない |
| コンテンツ配信権 | 第三者コンテンツを含まない → いいえ |
| 輸出コンプライアンス | 暗号化なし（`ITSAppUsesNonExemptEncryption = false`） |
| テスト情報 > フィードバックメール | tomokiskriiiabc@gmail.com |
| テスト情報 > プライバシーポリシーURL | 上記 privacy.html（外部テストは必須） |
| ベータ版App審査情報 > サインインが必要 | **いいえ**（アカウント機能なし＝デモアカウント不要） |
| ベータ版App審査情報 > 連絡先 | 氏名・電話番号・メール |

スクリーンショット・価格・App Store 用の説明文は、外部テストの段階では不要。

**審査メモ（Review Notes）— そのまま貼る**

> 起動直後はデータが空なので、サンプル導線を必ず書く。書かないと「機能がない」と見なされる恐れがある（Guideline 4.2）。

```
ログインやアカウント登録は不要です。起動直後からすべての機能をご利用いただけます。
サーバーとの通信は一切行わず、入力データは端末内(localStorage)にのみ保存されます。

【動作確認の手順】
1. 起動後、「1. 準備」タブの［サンプルの店で動きを見る］を押してください
   （スタッフ10名・1か月分の希望が入ったサンプルデータが読み込まれます）
2. ［シフトを作成する］を押してください
3. 「4. シフト表」タブに1か月分のシフト表が表示されます。
   セルをタップして担当者を変更すると、その場で法令違反を判定して表示します
4. 「5. 集計」タブで、出勤日数・労働時間・深夜/時間外・人件費を確認できます

【補足】
・本アプリは労働基準法等のルールに基づく計算を行う労務管理の補助ツールであり、
  法令適合を保証するものではありません。その旨はアプリ内およびサポートページに記載しています。
・AI・機械学習、外部API、第三者SDK、広告、アプリ内課金は使用していません。
・カメラ・位置情報・連絡先など、権限を要求する機能はありません。
```

**ベータ版Appの説明（テスト情報）**

```
飲食店・小売・介護などの現場で、スタッフのシフト表を自動作成するアプリです。

スタッフから「行ける日と時間」を集め、労働基準法（週40時間、週1日の休日、
18歳未満の深夜勤務禁止、勤務間インターバルなど）と、必要人数・責任者の配置・
新人の教育ペア・扶養の範囲といった現場のルールを守りながら、1か月分の
シフト表を組み立てます。できたシフト表は画像・CSVで保存して配れます。

AI・機械学習は使用していません。同じ入力からは必ず同じ結果が出る、
ルールに基づく計算です。通信は行わず、入力内容は端末内にのみ保存されます。
```

**テスト対象（What to Test／ビルドごと）**

```
初回ビルドです。以下をご確認ください。

・「1. 準備」→［サンプルの店で動きを見る］でサンプルデータを読み込めます
・［シフトを作成する］で1か月分のシフト表が生成されます
・シフト表のセルをタップして手直しすると、その場でルール違反を判定します
・画像／CSVでの保存、集計タブの労働時間・人件費
・iPhone上の表示崩れ、ノッチ・ホームインジケータまわりの余白
```

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

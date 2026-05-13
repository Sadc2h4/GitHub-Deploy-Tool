# GitHub Deploy Tool
![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron&logoColor=white)
![platform](https://img.shields.io/badge/platform-Windows-informational)
![version](https://img.shields.io/badge/version-1.00-brightgreen)

<img width="700" height="525" alt="Card_image1" src="https://github.com/user-attachments/assets/e5468866-44d0-41ac-a913-ecae6c52ee89" />

## ダウンロード

<a href="https://github.com/P2-Lab-C2H4/GitHub-Deploy-Tool/releases/tag/v1.0">
  <img
    src="https://raw.githubusercontent.com/Sadc2h4/brand-assets/main/button/Download_Button_1.png"
    alt="Download .zip"
    height="48"
  />
</a>

## 概要

GitHub Deploy Tool は，ローカルフォルダの内容を GitHub リポジトリへ GUI でアップロードするための Windows 向けツールです．  
Git コマンドや GitHub CLI の操作に慣れていない場合でも，アカウント認証，リポジトリ選択，フォルダ選択，コミット，プッシュまでを画面上で順番に実行できます．

当初は `起動.bat` から `npm start` で起動する開発用構成でしたが，ver1.00 からは配布用 exe を入口にした形式へ変更しています．  
配布版では Node.js や npm install は不要です．

細かい指定コマンドは実装していませんが，デプロイ時の作業工数を減らす目的で活用できる想定です．
>・ローカルフォルダを GitHub リポジトリへアップロード  
>・GitHub リポジトリの新規作成  
>・既存リポジトリへの差分デプロイ  
>・.gitignore を考慮したファイル選択  
>・履歴を保持した通常 push と force push の切り替え  

## 動作環境

・Windows 10 / Windows 11  
・Git  
・GitHub CLI (`gh`)  

> [!NOTE]
> 配布用 exe 版では Node.js と npm は不要です．  
> ただし，本ツールは内部で `git` と `gh` コマンドを呼び出すため，Git と GitHub CLI は配布先 PC にインストールされている必要があります．

## 配布版の構成

ver1.00 の配布版は以下の構成です．

```text
release-package/
  GitHub Deploy Tool.exe
  resources/
    GitHub Deploy Tool Core.exe
    definitions/
    locales/
    resources/
    *.dll
    *.pak
```

起動時はフォルダ直下の `GitHub Deploy Tool.exe` を実行してください．  
`resources` フォルダには Electron アプリ本体と起動に必要なファイルが含まれています．

> [!WARNING]
> `resources` フォルダ内のファイル名や配置は変更しないでください．  
> 特に `GitHub Deploy Tool Core.exe` や `resources/app.asar` を移動すると起動できなくなります．

## 使い方

### 1. GitHub アカウント認証

アプリを起動すると GitHub アカウントの確認画面が表示されます．  
未ログインの場合は画面の案内に従って GitHub CLI の認証を行ってください．

認証には GitHub CLI (`gh`) を使用します．  
認証後，アプリは Git の push 認証設定も確認します．

### 2. リポジトリ選択

<img width="700" height="430" alt="Card_image2" src="https://github.com/user-attachments/assets/26c43de1-ab51-482e-8232-dbe46a96e8f7" />

既存の GitHub リポジトリを一覧から選択できます．  
push 権限のあるリポジトリが対象です．

新規リポジトリを作成することも可能です．  
公開設定は Public / Private を選択できます．

### 3. フォルダ選択

<img width="600" height="432" alt="Card_image3" src="https://github.com/user-attachments/assets/30b41f51-25a4-4aef-afd8-9667d3d67eb4" />

GitHub へアップロードするローカルフォルダを選択します．  
フォルダ内のファイル一覧が表示され，デプロイに含めるファイルを選択できます．

.gitignore に含まれるファイルは表示上で薄くなり，実際のデプロイ対象からも除外されます．  
日本語名のファイルを除外するオプションも用意しています．

### 4. デプロイ設定

<img width="800" height="184" alt="mode" src="https://github.com/user-attachments/assets/3a9a0b03-8fef-4399-bb33-61e77b5436a1" />

コミットメッセージとブランチ名を指定してデプロイします．  
プッシュ方式は以下の 2 種類から選択できます．

#### ①履歴を保持

リモートブランチの履歴を取得し，その履歴をベースに差分だけをコミットして通常 push します．  
変更がないファイルはステージングされないため，不要な全ファイル更新は避けられます．

通常はこちらを使用してください．

#### ②force push

より確実にデプロイを実行したい際に使用するモードです  
通常 push が non-fast-forward などで失敗した場合に force push でリモートを上書きします．

> [!WARNING]
> force push はリモート側の履歴を失わせる可能性があります．  
> 複数人で共有しているリポジトリでは，基本的に `履歴を保持` モードを使用してください．

## 削除方法

・配布フォルダごと削除してください．  
・GitHub CLI の認証情報を削除したい場合は，別途 `gh auth logout` を実行してください．  

## 開発者向け起動

ソースから起動する場合は Node.js が必要です．

```bash
npm install
npm start
```

配布用フォルダを生成する場合は以下を実行します．

```bash
npm run build:dir
```

## 配布条件

・本ファイルはフリーです．  
・配布先 PC の Git / GitHub CLI / GitHub アカウント設定に依存するため，使用前に環境確認を行ってください．  
・配布により発生した如何なる損害も作者は責任を負いません．  

## 免責

・本ファイルを使用したことにより生じた損害については，一切の責任を負いません．  

// 紹介画像をレイヤー別PNGとして書き出すスクリプト
// 実行方法: npx electron DLpage_info/intro_card/render_card.js [対象フォルダ]
//   対象フォルダ省略時はこのスクリプトと同じフォルダの card.html を書き出す
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const WIDTH = 1100;
const HEIGHT = 710;
const OUT_DIR = process.argv[2] ? path.resolve(process.argv[2]) : __dirname;

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();

//-------------------------------------------------------------------------------
// 指定レイヤーのみ表示した状態でページをPNGにキャプチャする処理
//-------------------------------------------------------------------------------
async function captureLayers(win, layers, outFile) {
  await win.webContents.executeJavaScript(`showLayers(${JSON.stringify(layers)})`);
  await new Promise(resolve => setTimeout(resolve, 600));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
  fs.writeFileSync(outFile, image.toPNG());
  const size = image.getSize();
  console.log(`saved: ${path.basename(outFile)} (${size.width}x${size.height})`);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true }
  });

  await win.loadFile(path.join(OUT_DIR, 'card.html'));
  await new Promise(resolve => setTimeout(resolve, 1000)); // フォント読み込み待ち

  const layersDir = path.join(OUT_DIR, 'layers');
  fs.mkdirSync(layersDir, { recursive: true });

  await captureLayers(win, ['bg', 'art', 'text'], path.join(OUT_DIR, '紹介画像_1100x710.png'));
  await captureLayers(win, ['bg'], path.join(layersDir, '01_背景.png'));
  await captureLayers(win, ['art'], path.join(layersDir, '02_画像.png'));
  await captureLayers(win, ['text'], path.join(layersDir, '03_文字.png'));

  app.quit();
}).catch(err => {
  console.error(err);
  app.exit(1);
});

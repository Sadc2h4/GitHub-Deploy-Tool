// レイヤー別PNGからレイヤー付きPSDを組み立てるスクリプト
// 実行方法: node DLpage_info/intro_card/build_psd.js [対象フォルダ]
//   （先に render_card.js を実行しておく。対象フォルダ省略時はこのスクリプトと同じフォルダ）
const fs = require('fs');
const path = require('path');
const { writePsdBuffer, readPsd } = require('ag-psd');
const { PNG } = require('pngjs');

const WIDTH = 1100;
const HEIGHT = 710;
const OUT_DIR = process.argv[2] ? path.resolve(process.argv[2]) : __dirname;

//-------------------------------------------------------------------------------
// PNGファイルをPSDレイヤー用のImageData形式に読み込む処理
//-------------------------------------------------------------------------------
function loadPngAsImageData(filePath) {
  const png = PNG.sync.read(fs.readFileSync(filePath));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
}

const layersDir = path.join(OUT_DIR, 'layers');
const psd = {
  width: WIDTH,
  height: HEIGHT,
  channels: 4,
  bitsPerChannel: 8,
  colorMode: 3,
  children: [
    { name: '背景', imageData: loadPngAsImageData(path.join(layersDir, '01_背景.png')) },
    { name: '画像', imageData: loadPngAsImageData(path.join(layersDir, '02_画像.png')) },
    { name: '文字', imageData: loadPngAsImageData(path.join(layersDir, '03_文字.png')) }
  ],
  imageData: loadPngAsImageData(path.join(OUT_DIR, '紹介画像_1100x710.png'))
};

const outFile = path.join(OUT_DIR, '紹介画像_1100x710.psd');
fs.writeFileSync(outFile, writePsdBuffer(psd, { generateThumbnail: false }));

// 書き出したPSDを読み戻して検証
const verify = readPsd(fs.readFileSync(outFile), { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true });
console.log(`saved: ${path.basename(outFile)} (${verify.width}x${verify.height})`);
console.log('layers:', verify.children.map(c => c.name).join(' / '));

/**
 * 아이콘 생성 스크립트
 * 실행: node scripts/generate-icons.js
 */
const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

const SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];
const OUT_DIR = path.join(__dirname, '..', 'assets');
fs.mkdirSync(OUT_DIR, { recursive: true });

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const r = size * 0.22; // border-radius

  // Background gradient (indigo)
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#6366f1');
  grad.addColorStop(1, '#818cf8');

  // Rounded rect
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0);
  ctx.quadraticCurveTo(size, 0, size, r);
  ctx.lineTo(size, size - r);
  ctx.quadraticCurveTo(size, size, size - r, size);
  ctx.lineTo(r, size);
  ctx.quadraticCurveTo(0, size, 0, size - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Letter Q
  ctx.fillStyle = 'white';
  ctx.font = `700 ${size * 0.58}px -apple-system, BlinkMacSystemFont, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Q', size * 0.5, size * 0.52);

  return canvas;
}

async function main() {
  console.log('아이콘 생성 중...');
  for (const size of SIZES) {
    const canvas = drawIcon(size);
    const buf = canvas.toBuffer('image/png');
    const outPath = path.join(OUT_DIR, `icon-${size}.png`);
    fs.writeFileSync(outPath, buf);
    console.log(`  ✓ icon-${size}.png`);
  }

  // Main icon used by electron-builder
  const main = drawIcon(1024);
  fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), main.toBuffer('image/png'));
  console.log('  ✓ icon.png (1024x1024)');
  console.log('\n완료! npm run build:win 으로 빌드하세요.');
}

main().catch(e => { console.error(e); process.exit(1); });

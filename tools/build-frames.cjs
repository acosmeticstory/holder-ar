#!/usr/bin/env node
/**
 * 빌드 스크립트 — 스크롤 시퀀스 PNG 원본을 모바일 친화 WebP로 변환.
 *
 * 입력:  ../스크롤인터랙션/20260526_test.79.{N}.png  (151장)
 * 출력:  ../frames/test/frame-{NNN}.webp           (151장, WebP 78%)
 *
 * 실행: cd webapp && npm i sharp && node tools/build-frames.cjs
 *
 * 옵션 (env):
 *   FRAME_WIDTH   기본 600 (모바일 폭. retina도 충분)
 *   FRAME_QUALITY 기본 78  (WebP quality. 디자이너 화질 보존하면서 ~40KB/장)
 *   SRC_DIR       기본 ../스크롤인터랙션
 *   OUT_DIR       기본 ../frames/test
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = process.env.SRC_DIR
  ? path.resolve(process.env.SRC_DIR)
  : path.resolve(ROOT, '..', '스크롤인터랙션');
const OUT_DIR = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.resolve(ROOT, 'frames', 'test');
const TARGET_WIDTH = parseInt(process.env.FRAME_WIDTH || '600', 10);
const QUALITY = parseInt(process.env.FRAME_QUALITY || '78', 10);

if (!fs.existsSync(SRC_DIR)) {
  console.error('SRC_DIR not found:', SRC_DIR);
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

const files = fs.readdirSync(SRC_DIR)
  .filter(f => /\.png$/i.test(f))
  .map(f => {
    const m = f.match(/\.(\d+)\.png$/);
    return { name: f, num: m ? parseInt(m[1], 10) : 0 };
  })
  .filter(f => f.num > 0)
  .sort((a, b) => a.num - b.num);

if (!files.length) {
  console.error('No frames found in', SRC_DIR);
  process.exit(1);
}

console.log(`Processing ${files.length} frames`);
console.log(`  src:     ${SRC_DIR}`);
console.log(`  out:     ${OUT_DIR}`);
console.log(`  width:   ${TARGET_WIDTH}px`);
console.log(`  quality: WebP ${QUALITY}`);

(async () => {
  let totalBytes = 0;
  for (const f of files) {
    const src = path.join(SRC_DIR, f.name);
    const num = String(f.num).padStart(3, '0');
    const out = path.join(OUT_DIR, `frame-${num}.webp`);
    await sharp(src)
      .resize({ width: TARGET_WIDTH })
      .webp({ quality: QUALITY })
      .toFile(out);
    totalBytes += fs.statSync(out).size;
    process.stdout.write('.');
  }
  const totalMb = (totalBytes / 1024 / 1024).toFixed(2);
  const avgKb = (totalBytes / files.length / 1024).toFixed(1);
  console.log(`\nDone. ${files.length} frames, ${totalMb} MB total (avg ${avgKb} KB/frame)`);

  // manifest 파일 — 컴포넌트가 동적으로 frame URL 목록을 받을 수 있도록
  const manifest = {
    count: files.length,
    width: TARGET_WIDTH,
    quality: QUALITY,
    pattern: 'frame-{NNN}.webp',
    frames: files.map(f => `frame-${String(f.num).padStart(3, '0')}.webp`)
  };
  fs.writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  console.log(`manifest.json written.`);
})().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});

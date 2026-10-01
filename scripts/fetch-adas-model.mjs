#!/usr/bin/env node
/**
 * fetch-adas-model.mjs — Sürüş Asistanı araç dedektörü modelini üretir.
 *
 * Kaynak: TensorFlow.js COCO-SSD "lite_mobilenet_v2" (SSDLite MobileNetV2,
 * COCO), Google — Apache License 2.0. Upstream dosyalar SHA-256 ile SABİTLİDİR;
 * içerik değişmişse script durur (sessizce farklı model paketlenmez).
 *
 * Dönüşüm: float32 ağırlıklar → float16 (TF.js manifest'inin yerel
 * `quantization: { dtype: 'float16' }` biçimi; yüklemede float32'ye açılır,
 * çıkarım aynı hassasiyette çalışır). Boyut 18 MB → ~9 MB. float16 aralığı
 * dışına taşan bir tensör olursa o tensör float32 KALIR. int32 tensörlere
 * dokunulmaz.
 *
 * Çıktı (git'te izlenir, APK ile çevrimdışı gelir):
 *   public/models/ssdlite_mobilenet_v2/model.json
 *   public/models/ssdlite_mobilenet_v2/group1-shard{N}of{M}.bin
 *   public/models/ssdlite_mobilenet_v2/LICENSE · SOURCE.txt
 *
 * Kullanım:
 *   node scripts/fetch-adas-model.mjs                 # upstream'den indir
 *   node scripts/fetch-adas-model.mjs --from <klasör> # önceden indirilmiş dosyalar
 *
 * Çıkış kodu: 0 = üretildi · 1 = indirme/doğrulama hatası.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'models', 'ssdlite_mobilenet_v2');
const BASE_URL = 'https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/';
const SHARD_BYTES = 4 * 1024 * 1024;

/** Upstream dosyaların SHA-256'sı (2026-10-01'de indirilen sürüm). */
const UPSTREAM = {
  'model.json': '3770b2528339b1e3340cb74360e1e40401816b009779aeb8d0cce3a4353ea3a9',
  'group1-shard1of5': '0e7af0f713e98521252321f7f84892c31cefccccec3ac64c84e5065b75ed5646',
  'group1-shard2of5': '74cc6cfc2c4510c9cd81b8ad4cebf6f6a8f305119bb365ce0eb96276da38519a',
  'group1-shard3of5': '50383033f893eae136392a403e8f70ade5efd90867df5695c4ca5ac640e14f38',
  'group1-shard4of5': 'd856dc534c780068bbf6c666ce1516df2c8433d87578aa31fcdf197de7058cc2',
  'group1-shard5of5': '3d356f1fb6dfca6af78c56db34d9326706d0196e303f9de6b04f236ca79ed309',
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function readUpstream(name, fromDir) {
  let buf;
  if (fromDir) {
    buf = readFileSync(join(fromDir, name));
  } else {
    const res = await fetch(BASE_URL + name);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  const got = sha256(buf);
  if (got !== UPSTREAM[name]) throw new Error(`${name}: SHA-256 uyuşmuyor (${got})`);
  return buf;
}

/** IEEE-754 float32 → float16 bitleri (en yakına yuvarla, eşitlikte çifte). */
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function toHalf(v) {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);       // inf / NaN
  let e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;                                // taşma → inf
  if (e <= 0) {                                                       // alt-normal
    if (e < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - e;
    let half = mant >>> shift;
    const rem = mant & ((1 << shift) - 1);
    const mid = 1 << (shift - 1);
    if (rem > mid || (rem === mid && (half & 1))) half++;
    return sign | half;
  }
  let half = (e << 10) | (mant >>> 13);
  const rem = mant & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (half & 1))) half++;         // taşarsa üs artar (doğru)
  return sign | half;
}

async function main() {
  const fromIdx = process.argv.indexOf('--from');
  const fromDir = fromIdx > 0 ? process.argv[fromIdx + 1] : null;

  const model = JSON.parse((await readUpstream('model.json', fromDir)).toString('utf8'));
  const group = model.weightsManifest[0];
  const parts = [];
  for (const p of group.paths) parts.push(await readUpstream(p, fromDir));
  const data = Buffer.concat(parts);

  const outChunks = [];
  const weights = [];
  let off = 0;
  let halved = 0;
  let kept = 0;
  for (const w of group.weights) {
    const n = w.shape.reduce((a, b) => a * b, 1);
    const bytes = n * 4;
    const slice = data.subarray(off, off + bytes);
    off += bytes;
    if (w.dtype !== 'float32' || w.quantization) {
      outChunks.push(Buffer.from(slice));
      weights.push(w);
      continue;
    }
    const src = new Float32Array(slice.buffer.slice(slice.byteOffset, slice.byteOffset + bytes));
    if (src.some((v) => Number.isFinite(v) && Math.abs(v) > 65504)) {
      outChunks.push(Buffer.from(slice));
      weights.push(w);
      kept++;
      continue;
    }
    const half = new Uint16Array(n);
    for (let i = 0; i < n; i++) half[i] = toHalf(src[i]);
    outChunks.push(Buffer.from(half.buffer));
    weights.push({ ...w, quantization: { dtype: 'float16', original_dtype: 'float32' } });
    halved++;
  }
  if (off !== data.length) throw new Error(`ağırlık boyutu tutmuyor: ${off} ≠ ${data.length}`);

  const out = Buffer.concat(outChunks);
  const count = Math.ceil(out.length / SHARD_BYTES);
  const paths = [];
  if (existsSync(OUT)) {
    for (const f of readdirSync(OUT)) if (f.startsWith('group1-shard')) rmSync(join(OUT, f));
  }
  mkdirSync(OUT, { recursive: true });
  for (let k = 0; k < count; k++) {
    const name = `group1-shard${k + 1}of${count}.bin`;
    writeFileSync(join(OUT, name), out.subarray(k * SHARD_BYTES, (k + 1) * SHARD_BYTES));
    paths.push(name);
  }
  model.weightsManifest = [{ paths, weights }];
  writeFileSync(join(OUT, 'model.json'), JSON.stringify(model));

  writeFileSync(join(OUT, 'SOURCE.txt'), [
    'SSDLite MobileNetV2 (COCO) — TensorFlow.js COCO-SSD "lite_mobilenet_v2"',
    `Kaynak: ${BASE_URL}`,
    'Lisans: Apache License 2.0 (bkz. LICENSE) — Copyright Google LLC.',
    'Değişiklik: float32 ağırlıklar float16 olarak saklandı (scripts/fetch-adas-model.mjs).',
    'Upstream SHA-256:',
    ...Object.entries(UPSTREAM).map(([k, v]) => `  ${v}  ${k}`),
    '',
  ].join('\n'));

  console.log(`[adas-model] ${halved} tensör float16, ${kept} float32 kaldı; ${(out.length / 1048576).toFixed(1)} MB, ${count} parça → ${OUT}`);
}

main().catch((e) => {
  console.error('[adas-model] HATA:', e.message);
  process.exit(1);
});

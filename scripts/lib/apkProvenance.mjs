/**
 * apkProvenance.mjs — `apk-dev.mjs`in SAF yardımcıları (IO yok → kilit testleri).
 *
 *   readZipEntry      : APK (zip) içinden tek dosya — bağımlılıksız (Windows'ta `unzip` yok).
 *   versionTag        : `src/utils/buildStamp.ts › stampVersionTag` ve build.gradle ile
 *                       AYNI biçim (eşitlik testle kilitli).
 *   parseDumpsysPackage: `adb shell dumpsys package <id>` çıktısından versionName/lastUpdateTime.
 *   sameStamp         : iki damga aynı derlemeye mi ait.
 */

import { inflateRawSync } from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/**
 * Zip arşivinden `name` girdisini okur (stored/deflate). Yoksa null.
 * ZIP64 gerektirmeyen arşivler (APK) için yeterlidir; bozuk yapıda hata fırlatır.
 * @param {Buffer} buf
 * @param {string} name
 * @returns {Buffer | null}
 */
export function readZipEntry(buf, name) {
  // EOCD: sondan geriye (yorum en fazla 64 KB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: merkezi dizin sonu bulunamadı');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== CEN_SIG) throw new Error('zip: bozuk merkezi dizin');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const entryName = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (entryName === name) {
      if (buf.readUInt32LE(localOff) !== LOC_SIG) throw new Error('zip: bozuk yerel başlık');
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error(`zip: desteklenmeyen sıkıştırma yöntemi ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** buildStamp.ts › stampVersionTag ile AYNI. */
export function versionTag(stamp) {
  const id = String(stamp.time).replace(/[-:]/g, '').slice(0, 15);
  const base = stamp.dirty === true ? `${stamp.commit}.dirty` : stamp.commit;
  return `${base}.${id}`;
}

/** İki damga AYNI derlemeye mi ait (commit + dirty + zaman). */
export function sameStamp(a, b) {
  return !!a && !!b && a.commit === b.commit && a.dirty === b.dirty && a.time === b.time;
}

/**
 * `dumpsys package` çıktısı → { versionName, lastUpdateTime } (bulunamayan alan null).
 * @param {string} text
 */
export function parseDumpsysPackage(text) {
  const vn = /versionName=([^\s]+)/.exec(text);
  const lu = /lastUpdateTime=([^\r\n]+)/.exec(text);
  return { versionName: vn ? vn[1] : null, lastUpdateTime: lu ? lu[1].trim() : null };
}

/** `adb install` çıktısı başarı bildiriyor mu (Android "Success" satırı). */
export function installSucceeded(output) {
  return /^\s*Success\s*$/m.test(String(output));
}

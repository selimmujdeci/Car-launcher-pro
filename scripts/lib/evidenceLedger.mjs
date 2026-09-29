/**
 * evidenceLedger.mjs — DEVICE_VALIDATION_LEDGER'a kanıt yazan SAF fonksiyonlar.
 *
 * Neden: kütük "saha kanıtının tek kaynağı" ama elle yazımı pahalı olduğu için
 * cihazda kanıtlanan işler kütüğe geçmiyor, kütük gerçeğin gerisinde kalıyordu
 * (2026-09-29). Bu modül kaydı tek komuta indirir; dosya G/Ç'si ve cihaz bilgisi
 * `scripts/evidence-record.mjs`te, burada yalnız metin dönüşümü vardır (test edilir).
 *
 * Kütük sözleşmesi (dosya başı):
 *  - Numara bir KİMLİKTİR: yeni numara = dosyadaki en büyük numara + 1.
 *  - 🔴 tablosu: | # | Özellik | Nerede | Kabul ölçütü | Eklendi |
 *  - 🟢 / ❌ tabloları: | # | Özellik | Nasıl kanıtlandı | Doğrulandı |
 */

export const SECTION = {
  gecti: '## 🟢 CİHAZDA DOĞRULANDI',
  dustu: '## ❌ TEST EDİLDİ / DÜŞTÜ',
};

const ROW_RE = /^\| (\d+) \|/;

/** Dosyadaki en büyük madde numarası. */
export function maxEntryNumber(text) {
  let max = 0;
  for (const line of text.split('\n')) {
    const m = ROW_RE.exec(line);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** Tablo hücresine güvenli metin: satır sonu ve `|` tabloyu bozmasın. */
export function cell(s) {
  return String(s ?? '').replace(/\r?\n+/g, ' ').replace(/\|/g, '/').trim();
}

/** Kanıt künyesi — kim, ne zaman, hangi derleme, hangi cihaz. Bilinmeyen alan "alınamadı". */
export function provenance({ date, source, commit, version, device }) {
  const d = device ?? {};
  const dev = [d.model, d.android && `Android ${d.android}`, d.webview && `WebView ${d.webview}`]
    .filter(Boolean).join(' · ') || 'cihaz bilgisi alınamadı (adb yok)';
  return `Kaynak: ${source} · ${date} · derleme ${version ?? '?'} (${commit ?? '?'}) · ${dev}`;
}

/** Tek satırlık yeni kanıt maddesi (🟢 ya da ❌ tablosu biçimi). */
export function buildRow({ no, result, area, note, closes = [], prov, date }) {
  const mark = result === 'gecti' ? '🟢' : '❌';
  const verb = result === 'gecti' ? 'CİHAZDA DOĞRULANDI' : 'CİHAZDA DÜŞTÜ';
  const ref = closes.length ? ` Kapattığı madde(ler): ${closes.map((n) => `#${n}`).join(', ')}.` : '';
  // Büyük harf içeren giriş (OBD-DID) kısaltmadır, olduğu gibi kalır; küçük harfle
  // yazılan ad Türkçe kuralıyla büyütülür (mavi → MAVİ, navigasyon → NAVİGASYON).
  const a = cell(area);
  const label = /[A-ZÇĞİÖŞÜ]/.test(a) ? a : a.toLocaleUpperCase('tr-TR');
  const title = `**${mark} ${label} — ${verb}**`;
  return `| ${no} | ${title} — ${cell(note)}${ref} | ${cell(prov)} | ${date} |`;
}

/** 🔴 satırını çözümle: numara + hücreler. */
function splitRow(line) {
  return line.split(' | ').map((s) => s.replace(/^\| ?/, '').replace(/ ?\|$/, ''));
}

/**
 * Var olan bir maddeyi 🔴'dan hedef tabloya taşır. Özellik metnindeki ilk 🔴 işareti
 * sonuca göre değiştirilir; eski "Kabul ölçütü" kanıt hücresine korunur (bilgi kaybı yok).
 */
export function moveEntry(text, no, { result, prov, date }) {
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => l.startsWith(`| ${no} |`));
  if (idx < 0) throw new Error(`#${no} kütükte bulunamadı`);
  const cells = splitRow(lines[idx]);
  if (cells.length < 4) throw new Error(`#${no} beklenen tablo biçiminde değil`);
  const mark = result === 'gecti' ? '🟢' : '❌';
  const verb = result === 'gecti' ? 'CİHAZDA DOĞRULANDI' : 'CİHAZDA DÜŞTÜ';
  // Başlıktaki eski "TEST EDİLMEDİ" ifadesi tarihsel kalır; güncel hüküm sona eklenir.
  const feature = `${cells[1].replace('🔴', mark)} **→ ${verb} (${date})**`;
  const acceptance = cells.length >= 5 ? cells[3] : '';
  const proof = acceptance ? `Kabul ölçütü: ${cell(acceptance)} — ${cell(prov)}` : cell(prov);
  const moved = `| ${no} | ${feature} | ${proof} | ${date} |`;
  lines.splice(idx, 1);
  return insertAtTop(lines.join('\n'), result, moved);
}

/** Satırı hedef bölümün tablo başlığının hemen altına ekler (en yeni üstte). */
export function insertAtTop(text, result, row) {
  const lines = text.split('\n');
  const h = lines.findIndex((l) => l.startsWith(SECTION[result]));
  if (h < 0) throw new Error(`Bölüm bulunamadı: ${SECTION[result]}`);
  const sep = lines.findIndex((l, i) => i > h && /^\|-{2,}/.test(l));
  if (sep < 0) throw new Error(`Tablo ayırıcısı bulunamadı: ${SECTION[result]}`);
  lines.splice(sep + 1, 0, row);
  return lines.join('\n');
}

/**
 * Tüm kaydı uygular: kapatılan maddeleri taşır, ardından yeni özet maddesini ekler.
 * Dönen `no`, eklenen yeni maddenin numarasıdır.
 */
export function applyEvidence(text, { result, area, note, closes = [], prov, date }) {
  if (!SECTION[result]) throw new Error(`Geçersiz sonuç: ${result} (gecti | dustu)`);
  if (!cell(area)) throw new Error('--alan zorunlu');
  if (!cell(note)) throw new Error('--not zorunlu (ne gözlemlendi?)');
  let out = text;
  for (const n of closes) out = moveEntry(out, n, { result, prov, date });
  const no = maxEntryNumber(out) + 1;
  out = insertAtTop(out, result, buildRow({ no, result, area, note, closes, prov, date }));
  return { text: out, no };
}

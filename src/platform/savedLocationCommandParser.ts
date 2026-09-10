/**
 * savedLocationCommandParser.ts — "Özel Konumlar" fiillerini serbest metinden
 * çıkarır (`addressParser.ts` ile AYNI desen: sesli komut sözlüğünden ÖNCE
 * denenir, isim SERBEST METİNDİR — sabit anahtar kelime listesiyle eşleşmez).
 *
 * Desteklenen kalıplar (görev sözleşmesi §5):
 *   KAYDET   "Burayı kaydet, adı Mavi Göl olsun" · "Konumumu Mavi Göl olarak
 *            kaydet" · "Burasını Annemler diye kaydet" · "Burayı kaydet"
 *   YENİDEN  "Mavi Göl'ün adını Piknik Alanı yap" · "Depo konumunu Atölye
 *   ADLANDIR olarak değiştir"
 *   SİL      "Mavi Göl'ü sil" · "Depo konumunu sil"
 *   PAYLAŞ   "Mavi Göl'ü paylaş" · "Annemlerin konumunu paylaş"
 *
 * İsim ÇÖZÜMLENMEZ burada (hangi kayıtla eşleştiği bir liste sorgusudur) —
 * yalnız serbest metinden AD çıkarılır. Eşleştirme `savedLocationsService.
 * findSavedLocationByName` işidir (TEK otorite, paralel kopya YOK).
 *
 * ⚠️ TÜRKÇE `\b` TUZAĞI: JS regex `\b`, `\w` = `[A-Za-z0-9_]` tanımına göre
 * çalışır — Türkçe ı/ö/ü/ş/ğ/ç bu kümede DEĞİLDİR ve ASCII-katlama (ör.
 * `normalizeWakeText`) apostrofu SİLİP kelime sayısını değiştirir. Bu yüzden
 * eşleşme `toLocaleLowerCase('tr-TR')` (Türkçe karakterleri KORUYAN, 1:1
 * uzunluk/pozisyon eşlemesi) üzerinde, sınırlar `\b` yerine açık
 * `(?:^|\s)…(?:\s|$)` desenleriyle yapılır — eşleşme İNDEKSİ doğrudan
 * orijinal `raw` dizgeyi dilimlemek için kullanılır (küçük harfe çevirme
 * Türkçe'de karakter sayısını DEĞİŞTİRMEZ).
 */

function clean(s: string): string {
  return s.replace(/^['"]+|['"]+$/g, '').trim().replace(/\s+/g, ' ');
}

/** "Mavi Göl'ü" / "Mavi Göl'ün" → "Mavi Göl" (yalnız apostroflu ek soyulur). */
function stripApostropheSuffix(s: string): string {
  const t = clean(s);
  const idx = Math.max(t.lastIndexOf("'"), t.lastIndexOf('’'), t.lastIndexOf('‘'));
  return idx > 0 ? clean(t.slice(0, idx)) : t;
}

export type SavedLocationVerb = 'save' | 'rename' | 'delete' | 'share';

export interface ParsedSavedLocationCommand {
  readonly verb: SavedLocationVerb;
  /** save: null olabilir (fallback isim kullanılır). rename/delete/share: hedef kaydın adı. */
  readonly name: string | null;
  /** yalnız rename: yeni ad. */
  readonly newName?: string;
  readonly feedback: string;
}

export function tryParseSavedLocationCommand(rawText: string): ParsedSavedLocationCommand | null {
  const raw = rawText.trim();
  if (!raw) return null;
  // Türkçe-doğru küçük harf — uzunluk/pozisyon `raw` ile 1:1 (indeks paylaşımı güvenli).
  const lower = raw.toLocaleLowerCase('tr-TR');

  /* ── YENİDEN ADLANDIR ────────────────────────────────────────────────── */
  {
    const m = /(?:^|\s)adını\s+(.+?)\s+(?:yap|değiştir)\s*$/.exec(lower);
    if (m) {
      const nameRaw = stripApostropheSuffix(raw.slice(0, m.index));
      const newStart = lower.indexOf(m[1], m.index);
      const newNameRaw = newStart >= 0 ? clean(raw.slice(newStart, newStart + m[1].length)) : '';
      if (nameRaw && newNameRaw) {
        return {
          verb: 'rename', name: nameRaw, newName: newNameRaw,
          feedback: `${nameRaw} konumunun adı ${newNameRaw} yapılıyor`,
        };
      }
    }
    const m2 = /(?:^|\s)(.+?)\s+konumunu\s+(.+?)\s+olarak\s+değiştir\s*$/.exec(lower);
    if (m2) {
      const nameStart = lower.indexOf(m2[1], m2.index);
      const newStart = lower.indexOf(m2[2], nameStart + m2[1].length);
      if (nameStart >= 0 && newStart >= 0) {
        const nameRaw = clean(raw.slice(nameStart, nameStart + m2[1].length));
        const newNameRaw = clean(raw.slice(newStart, newStart + m2[2].length));
        if (nameRaw && newNameRaw) {
          return {
            verb: 'rename', name: nameRaw, newName: newNameRaw,
            feedback: `${nameRaw} konumunun adı ${newNameRaw} yapılıyor`,
          };
        }
      }
    }
  }

  /* ── KAYDET ────────────────────────────────────────────────────────────
   * "kaydet" ASCII olduğu için `\b` burada güvenlidir (tuzak yalnız Türkçe
   * karaktere bitişik sınırlarda oluşur) — cümlenin HERHANGİ bir yerinde
   * olabilir ("Burayı kaydet, adı X olsun" → "kaydet" ortada). */
  if (/\bkaydet\b/.test(lower)) {
    const hasSubject = /(?:^|\s)(burayı|burasını|konumumu|konumu)(?:\s|$)/.test(lower);
    if (hasSubject || lower.trim() === 'kaydet') {
      let name: string | null = null;
      const adiOlsun = /adı\s+(.+?)\s+olsun/.exec(lower);
      const olarakKaydet = /(?:^|\s)(.+?)\s+olarak\s+kaydet/.exec(lower);
      const diyeKaydet = /(?:^|\s)(.+?)\s+diye\s+kaydet/.exec(lower);
      const m = adiOlsun ?? olarakKaydet ?? diyeKaydet;
      if (m) {
        const capStart = lower.indexOf(m[1], m.index);
        if (capStart >= 0) {
          let cand = raw.slice(capStart, capStart + m[1].length);
          cand = cand.replace(/^(burayı|burasını|konumumu|konumu)\s*/i, '');
          cand = clean(cand);
          name = cand.length > 0 ? cand : null;
        }
      }
      return {
        verb: 'save', name,
        feedback: name ? `${name} olarak kaydediliyor` : 'Konum kaydediliyor',
      };
    }
  }

  /* ── SİL ─────────────────────────────────────────────────────────────── */
  {
    const m = /^(.+?)(?:\s+konumunu)?\s+sil\s*$/.exec(lower);
    if (m && m[1].trim().length > 0) {
      const nameRaw = stripApostropheSuffix(raw.slice(0, m[1].length));
      if (nameRaw) return { verb: 'delete', name: nameRaw, feedback: `${nameRaw} silinecek` };
    }
  }

  /* ── PAYLAŞ ──────────────────────────────────────────────────────────── */
  {
    const m = /^(.+?)(?:'[a-zçğıöşü]*)?\s+konumunu\s+paylaş\s*$/.exec(lower)
      ?? /^(.+?)\s+paylaş\s*$/.exec(lower);
    if (m && m[1].trim().length > 0) {
      const nameRaw = stripApostropheSuffix(raw.slice(0, m[1].length));
      if (nameRaw) return { verb: 'share', name: nameRaw, feedback: `${nameRaw} paylaşılıyor` };
    }
  }

  return null;
}

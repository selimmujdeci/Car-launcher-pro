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

/**
 * "Şu anki konumu" ifade eden ÖZNELER — kaydet fiilinin konum kaydı olduğunu
 * gösteren tek kanıt budur (fiil tek başına müzik favorisi de olabilir:
 * "bu şarkıyı kaydet"). Liste BİLİNÇLİ olarak konum-özgüdür; şarkı/favori/
 * çalma listesi gibi medya özneleri BURAYA GİRMEZ.
 */
const SAVE_SUBJECT_RE =
  /(?:^|\s)(buray[ıi]|burasını|burası|buraya|burada|burda|şuray[ıi]|şurası|konumumuzu|konumumu|konumu|yerimizi|yerimi|yeri)(?:\s|$)/;

/**
 * İsim adayının başındaki konum ÖNEKLERİNİ soyar ("bulunduğum konumu ev" →
 * "ev"). Birden fazla önek zincirlenebilir ("şu an bulunduğum yeri annemler"),
 * bu yüzden eşleşme kalmayana kadar tekrarlanır. Bounded: her tur dizgeyi
 * KISALTIR, dolayısıyla döngü sonludur.
 */
const SAVE_NAME_PREFIX_RE =
  /^(şu\s+anki|şu\s+an|şuanki|şuan|mevcut|bulunduğumuz|bulunduğum|buradaki|buray[ıi]|burasını|burası|buraya|burada|burda|şuray[ıi]|şurası|konumumuzu|konumumu|konumu|yerimizi|yerimi|yeri|bu)\s+/i;

function stripLocationPrefixes(s: string): string {
  let out = clean(s);
  for (let i = 0; i < 8; i++) {
    const next = out.replace(SAVE_NAME_PREFIX_RE, '');
    if (next === out) break;
    out = clean(next);
  }
  return out;
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
   * olabilir ("Burayı kaydet, adı X olsun" → "kaydet" ortada).
   *
   * ── SAHA KUSURU (2026-09-11, ölçülen) ────────────────────────────────
   * Özne listesi yalnız `burayı|burasını|konumumu|konumu` idi. Doğal Türkçe
   * varyantlar (`yerimi` · `bulunduğum yeri` · `buraya` · `burada` · `şurayı`)
   * bu kapıdan GEÇEMİYOR ve cümle aşağıdaki komut sözlüğüne düşüyordu.
   * Ölçülen sonuç (parseCommand çıktısı):
   *   "yerimi kaydet"                → add_music_favorite (0.82)  ← MÜZİK!
   *   "bulunduğum yeri kaydet"       → add_music_favorite (0.82)
   *   "buraya ev diye kaydet"        → navigate_home      (0.82)  ← NAVİGASYON!
   *   "şu an bulunduğum yeri annemler olarak kaydet" → add_music_favorite
   * 0.82 < AUTO_DISPATCH_MIN (0.7) DEĞİLDİR → yanlış komut doğrudan YÜRÜTÜLÜR.
   * Özne listesi genişletilerek konum cümleleri kanonik `save_location`
   * yoluna geri alınır (yeni otorite/store YOK — aynı `savedLocationsService`).
   *
   * ── SAHA KUSURU 2 (2026-09-11, CAROS LAB gerçek cihaz kaydı) ───────────
   * FİİL kendisi de tek biçimli değildi: yalnız BİTİŞİK "kaydet" yakalanıyordu.
   * "örnek konumu KAYIT ET" (isim + yardımcı fiil — eşit derecede doğal, günlük
   * konuşmada YAYGIN) bu deseni HİÇ tetiklemiyordu → `tryParseSavedLocationCommand`
   * `null` dönüyor, cümle komut sözlüğüne/beyne düşüyor ve TUR TURTAN farklı
   * sonuç üretiyordu: bazen (deterministik "kaydet" biçimiyle) gerçekten kaydediyor,
   * bazen (AI beyni "kayıt et"i REMEMBER/hafıza fiili sanıp) "aklımda tutuyorum"
   * diyordu — AYNI NİYET, İKİ FARKLI DAVRANIŞ. `kayıt et` artık `kaydet` ile
   * TAM EŞDEĞER kabul edilir (aynı özne kapısı, aynı isim-çıkarma desenleri). */
  const kaydetVerb = /\bkaydet\b/.test(lower);
  /* Emir kipi "kayıt et" + kibar istek biçimi "kayıt eder misin(iz)" — komutlar
   * pazarlıksız EMİR/İSTEK kipindedir ("kayıt ediyorum" bir KOMUT değil, bir
   * BİLDİRİMDİR; buraya bilerek alınmadı). "et" kökü ünsüz yumuşamasıyla
   * "ed-" olur (ediyorum) — imperative/istek formunda bu YUMUŞAMA olmaz, "et"
   * sabit kalır (et · ettim değil, komut için yalnız "et" ve "eder misin"). */
  const kayitEtVerb = /\bkay[ıi]t\s+et\b/.test(lower)
    || /\bkay[ıi]t\s+eder\s+mi(?:sin|siniz)\b/.test(lower);
  if (kaydetVerb || kayitEtVerb) {
    const hasSubject = SAVE_SUBJECT_RE.test(lower);
    if (hasSubject || lower.trim() === 'kaydet' || /^kay[ıi]t\s+et$/.test(lower.trim())) {
      let name: string | null = null;
      const adiOlsun = /adı\s+(.+?)\s+olsun/.exec(lower);
      /* "… adıyla kaydet" (SAHA: "Burayı Mavi Göl adıyla kaydet" → isim
         KAYBOLUYORDU, kayıt varsayılan adla oluşuyordu). "adıyla kayıt et"
         eşdeğeri de aynı gerekçeyle desteklenir. */
      const adiylaKaydet = /(?:^|\s)(.+?)\s+ad[ıi]yla\s+kaydet/.exec(lower)
        ?? /(?:^|\s)(.+?)\s+ad[ıi]yla\s+kay[ıi]t\s+et/.exec(lower);
      const olarakKaydet = /(?:^|\s)(.+?)\s+olarak\s+kaydet/.exec(lower)
        ?? /(?:^|\s)(.+?)\s+olarak\s+kay[ıi]t\s+et/.exec(lower);
      const diyeKaydet = /(?:^|\s)(.+?)\s+diye\s+kaydet/.exec(lower)
        ?? /(?:^|\s)(.+?)\s+diye\s+kay[ıi]t\s+et/.exec(lower);
      const m = adiOlsun ?? adiylaKaydet ?? olarakKaydet ?? diyeKaydet;
      if (m) {
        const capStart = lower.indexOf(m[1], m.index);
        if (capStart >= 0) {
          const cand = stripLocationPrefixes(raw.slice(capStart, capStart + m[1].length));
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

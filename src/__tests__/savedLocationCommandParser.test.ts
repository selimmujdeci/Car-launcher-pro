import { describe, it, expect } from 'vitest';
import { tryParseSavedLocationCommand } from '../platform/savedLocationCommandParser';

describe('savedLocationCommandParser', () => {
  it('KAYDET — "adı X olsun"', () => {
    const r = tryParseSavedLocationCommand('Burayı kaydet, adı Mavi Göl olsun');
    expect(r?.verb).toBe('save');
    expect(r?.name).toBe('Mavi Göl');
  });

  it('KAYDET — "X olarak kaydet"', () => {
    const r = tryParseSavedLocationCommand('Konumumu Mavi Göl olarak kaydet');
    expect(r?.verb).toBe('save');
    expect(r?.name).toBe('Mavi Göl');
  });

  it('KAYDET — "X diye kaydet"', () => {
    const r = tryParseSavedLocationCommand('Burasını Annemler diye kaydet');
    expect(r?.verb).toBe('save');
    expect(r?.name).toBe('Annemler');
  });

  it('KAYDET — isimsiz fallback', () => {
    const r = tryParseSavedLocationCommand('Burayı kaydet');
    expect(r?.verb).toBe('save');
    expect(r?.name).toBeNull();
  });

  it('SİL — "X\'i sil"', () => {
    const r = tryParseSavedLocationCommand("Mavi Göl'ü sil");
    expect(r?.verb).toBe('delete');
    expect(r?.name).toBe('Mavi Göl');
  });

  it('SİL — "X konumunu sil"', () => {
    const r = tryParseSavedLocationCommand('Depo konumunu sil');
    expect(r?.verb).toBe('delete');
    expect(r?.name).toBe('Depo');
  });

  it('PAYLAŞ — "X\'i paylaş"', () => {
    const r = tryParseSavedLocationCommand("Mavi Göl'ü paylaş");
    expect(r?.verb).toBe('share');
    expect(r?.name).toBe('Mavi Göl');
  });

  it('PAYLAŞ — "X\'in konumunu paylaş"', () => {
    const r = tryParseSavedLocationCommand("Annemlerin konumunu paylaş");
    expect(r?.verb).toBe('share');
    expect(r?.name).toBe('Annemlerin');
  });

  it('YENİDEN ADLANDIR — "X\'in adını Y yap"', () => {
    const r = tryParseSavedLocationCommand("Mavi Göl'ün adını Piknik Alanı yap");
    expect(r?.verb).toBe('rename');
    expect(r?.name).toBe('Mavi Göl');
    expect(r?.newName).toBe('Piknik Alanı');
  });

  it('YENİDEN ADLANDIR — "X konumunu Y olarak değiştir"', () => {
    const r = tryParseSavedLocationCommand('Depo konumunu Atölye olarak değiştir');
    expect(r?.verb).toBe('rename');
    expect(r?.name).toBe('Depo');
    expect(r?.newName).toBe('Atölye');
  });

  it('eşleşmeyen metin null döner', () => {
    expect(tryParseSavedLocationCommand('bugün hava nasıl')).toBeNull();
    expect(tryParseSavedLocationCommand("Mavi Göl'e git")).toBeNull();
  });

  it('boş girdi null döner', () => {
    expect(tryParseSavedLocationCommand('')).toBeNull();
    expect(tryParseSavedLocationCommand('   ')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SAHA KUSURU (2026-09-11) — doğal Türkçe konum özneleri kapıdan geçemiyordu
 *
 * Ölçülen (parseCommand çıktısı, düzeltme ÖNCESİ):
 *   "yerimi kaydet"                                → add_music_favorite (0.82)
 *   "bulunduğum yeri kaydet"                       → add_music_favorite (0.82)
 *   "buraya ev diye kaydet"                        → navigate_home      (0.82)
 *   "şu an bulunduğum yeri annemler olarak kaydet" → add_music_favorite (0.82)
 *   "Bulunduğum konumu ev olarak kaydet"           → name "Bulunduğum konumu ev"
 *   "Burayı Mavi Göl adıyla kaydet"                → name null (isim KAYBOLUYOR)
 * 0.82 ≥ AUTO_DISPATCH_MIN (0.7) olduğu için yanlış komut ONAYSIZ yürütülüyordu.
 * ════════════════════════════════════════════════════════════════════════ */
describe('savedLocationCommandParser — doğal Türkçe konum özneleri (SAHA 2026-09-11)', () => {
  const SAVE_CASES: ReadonlyArray<readonly [string, string | null]> = [
    ['Şu anki konumumu kaydet',                      null],
    ['Burayı kaydet',                                null],
    ['yerimi kaydet',                                null],
    ['şu anki yerimi kaydet',                        null],
    ['bulunduğum yeri kaydet',                       null],
    ['şurayı kaydet',                                null],
    ['konumumuzu kaydet',                            null],
    ['Burayı ev olarak kaydet',                      'ev'],
    ['Konumumu ev diye kaydet',                      'ev'],
    ['buraya ev diye kaydet',                        'ev'],
    ['Konumumu annemler olarak kaydet',              'annemler'],
    ['Bulunduğum konumu ev olarak kaydet',           'ev'],
    ['Şu an bulunduğum yeri annemler olarak kaydet', 'annemler'],
    ['Burayı Mavi Göl adıyla kaydet',                'Mavi Göl'],
  ];

  for (const [text, expectedName] of SAVE_CASES) {
    it(`"${text}" → save${expectedName ? ` (ad: ${expectedName})` : ' (isimsiz)'}`, () => {
      const r = tryParseSavedLocationCommand(text);
      expect(r).not.toBeNull();
      expect(r?.verb).toBe('save');
      expect(r?.name).toBe(expectedName);
    });
  }

  it('MEDYA cümleleri konum kaydına DÜŞMEZ (çapraz kirlenme yok)', () => {
    expect(tryParseSavedLocationCommand('bu şarkıyı kaydet')).toBeNull();
    expect(tryParseSavedLocationCommand('şarkıyı favorilere kaydet')).toBeNull();
    expect(tryParseSavedLocationCommand('beğendim ekle')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * "KAYIT ET" FİİL VARYANTI (SAHA 2026-09-11, kullanıcı bildirimi)
 *
 * KULLANICI ŞİKAYETİ: "örnek konumu kayıt et diyorum bazen kayıt ediyor bazen
 * aklımda diyor". Kök neden: `tryParseSavedLocationCommand` yalnız BİTİŞİK
 * "kaydet" fiilini tanıyordu; "kayıt et" (isim + yardımcı fiil — eşit derecede
 * doğal, günlük konuşmada YAYGIN) bu deseni HİÇ tetiklemiyordu. Sonuç: cümle bu
 * deterministik kapıdan GEÇEMİYOR, AI beynine düşüyor ve TUR TURDAN farklı
 * sonuç üretiyordu — bazen doğru (`save_location`), bazen YANLIŞ (`REMEMBER` /
 * "aklımda tutuyorum"). AYNI NİYET, İKİ FARKLI DAVRANIŞ — artık `kayıt et`
 * `kaydet` ile TAM EŞDEĞER: aynı özne kapısı, aynı isim-çıkarma desenleri.
 * ════════════════════════════════════════════════════════════════════════ */
describe('savedLocationCommandParser — "kayıt et" fiil varyantı (SAHA 2026-09-11)', () => {
  const KAYIT_ET_CASES: [string, string | null][] = [
    // Kullanıcının BİREBİR kendi örneği:
    ['örnek konumu kayıt et',           null],
    ['Şu anki konumumu kayıt et',       null],
    ['Burayı kayıt et',                 null],
    ['yerimi kayıt et',                 null],
    ['bulunduğum yeri kayıt et',        null],
    ['Burayı ev olarak kayıt et',       'ev'],
    ['Konumumu ev diye kayıt et',       'ev'],
    ['Burayı Mavi Göl adıyla kayıt et', 'Mavi Göl'],
    // Kibar istek biçimi — komutlar emir/istek kipindedir (pazarlıksız).
    ['Burayı kayıt eder misin',         null],
  ];

  for (const [text, expectedName] of KAYIT_ET_CASES) {
    it(`"${text}" → save${expectedName ? ` (ad: ${expectedName})` : ' (isimsiz)'} — "kaydet" İLE BİREBİR AYNI DAVRANIR`, () => {
      const r = tryParseSavedLocationCommand(text);
      expect(r).not.toBeNull();
      expect(r?.verb).toBe('save');
      expect(r?.name).toBe(expectedName);
    });
  }

  it('"kaydet" ve "kayıt et" AYNI cümlede AYNI isim ve verb üretir (tutarlılık kilidi)', () => {
    const a = tryParseSavedLocationCommand('Burayı ev olarak kaydet');
    const b = tryParseSavedLocationCommand('Burayı ev olarak kayıt et');
    expect(b?.verb).toBe(a?.verb);
    expect(b?.name).toBe(a?.name);
  });

  it('"kayıt" (fiilsiz, yalnız isim) konum kaydı OLARAK yorumlanmaz — sahte tetik yok', () => {
    // "kayıt" başlı başına bir fiil DEĞİLDİR (ör. "kayıt ol", "ses kaydı" gibi
    // bağlamlarda geçer) — yalnız "kayıt et" (+ kibar istek biçimi) tetikler.
    expect(tryParseSavedLocationCommand('burayı kayıt')).toBeNull();
  });

  it('MEDYA cümleleri "kayıt et" ile de konum kaydına DÜŞMEZ', () => {
    expect(tryParseSavedLocationCommand('bu şarkıyı kayıt et')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GÖNDER (WhatsApp) — ÜRÜN KARARI (2026-09-11)
 *
 * "Ev konumunu Ahmet'e gönder" → konum + alıcı METNİ çıkarılır. Kişi/konum
 * ÇÖZÜMÜ ve WhatsApp dispatch BURADA YAPILMAZ (bkz. `useVoiceCommandHandler`,
 * `whatsappShare.ts`) — bu blok YALNIZ deterministik metin ayrıştırmayı
 * kilitler: doğru konum türü (current/saved) + doğru alıcı adı + generic
 * "gönder" cümlelerine (konum içermeyen) YANLIŞLIKLA düşmeme.
 * ════════════════════════════════════════════════════════════════════════ */
describe('savedLocationCommandParser — GÖNDER (WhatsApp, ÜRÜN KARARI 2026-09-11)', () => {
  it('"Bu konumu Ahmet\'e gönder" → şu anki konum, alıcı Ahmet', () => {
    const r = tryParseSavedLocationCommand("Bu konumu Ahmet'e gönder");
    expect(r?.verb).toBe('send');
    expect(r?.isCurrentLocation).toBe(true);
    expect(r?.name).toBeNull();
    expect(r?.recipient).toBe('Ahmet');
  });

  it('"Şu anki konumumu Ahmet\'e gönder" → şu anki konum, alıcı Ahmet', () => {
    const r = tryParseSavedLocationCommand("Şu anki konumumu Ahmet'e gönder");
    expect(r?.verb).toBe('send');
    expect(r?.isCurrentLocation).toBe(true);
    expect(r?.recipient).toBe('Ahmet');
  });

  it('"Bulunduğum konumu anneme gönder" → şu anki konum, alıcı "anne" (iyelik+yönelme soyulur)', () => {
    const r = tryParseSavedLocationCommand('Bulunduğum konumu anneme gönder');
    expect(r?.verb).toBe('send');
    expect(r?.isCurrentLocation).toBe(true);
    expect(r?.recipient).toBe('anne');
  });

  it('"Ev konumunu Ahmet\'e gönder" → KAYITLI "Ev" konumu, alıcı Ahmet', () => {
    const r = tryParseSavedLocationCommand("Ev konumunu Ahmet'e gönder");
    expect(r?.verb).toBe('send');
    expect(r?.isCurrentLocation).toBe(false);
    expect(r?.name).toBe('Ev');
    expect(r?.recipient).toBe('Ahmet');
  });

  it('"Kayıtlı ev konumunu Ahmet\'e gönder" → "kayıtlı" filler soyulur, ad "ev"', () => {
    const r = tryParseSavedLocationCommand("Kayıtlı ev konumunu Ahmet'e gönder");
    expect(r?.verb).toBe('send');
    expect(r?.isCurrentLocation).toBe(false);
    expect(r?.name).toBe('ev');
    expect(r?.recipient).toBe('Ahmet');
  });

  it('"Mavi Göl konumunu Mehmet\'e gönder" → çok kelimeli kayıtlı ad KORUNUR', () => {
    const r = tryParseSavedLocationCommand("Mavi Göl konumunu Mehmet'e gönder");
    expect(r?.verb).toBe('send');
    expect(r?.isCurrentLocation).toBe(false);
    expect(r?.name).toBe('Mavi Göl');
    expect(r?.recipient).toBe('Mehmet');
  });

  it('"Konumumu sevgilime WhatsApp\'tan gönder" → şu anki konum, alıcı "sevgili", "whatsapp\'tan" dolgu kelimesi yutulur', () => {
    const r = tryParseSavedLocationCommand("Konumumu sevgilime WhatsApp'tan gönder");
    expect(r?.verb).toBe('send');
    expect(r?.isCurrentLocation).toBe(true);
    expect(r?.recipient).toBe('sevgili');
  });

  it('konum içermeyen genel "gönder" cümlesine YANLIŞLIKLA düşmez (ör. mesaj gönderme)', () => {
    expect(tryParseSavedLocationCommand("Ahmet'e mesaj gönder")).toBeNull();
    expect(tryParseSavedLocationCommand("Ahmet'e hediye gönder")).toBeNull();
  });

  it('CALL_CONTACT / REMEMBER cümleleri GÖNDER\'e düşmez (çapraz kirlenme yok)', () => {
    expect(tryParseSavedLocationCommand("Ahmet'i ara")).toBeNull();
    expect(tryParseSavedLocationCommand('yarın Ahmeti arayacağımı hatırla')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * "X OLAN KİŞİYE" — SAHA KUSURU (2026-09-11, kullanıcı bildirdi, GERÇEK CİHAZ)
 *
 * Kullanıcı BİREBİR: "Konumumu aşkım olan kişiye gönder" → hiç eşleşmiyordu
 * (alıcı ifadesi tek TOKEN değildi), cümle AI beynine düşüyor, beyin "böyle
 * bir özelliğim yok" diyordu — konum-gönderme desteği VARDI ama bu doğal
 * tanımlayıcı-yan-cümle kalıbını hiç GÖRMEDİ. "X olan kişiye/kişisine" artık
 * "X'e" ile EŞDEĞER kabul edilir.
 * ════════════════════════════════════════════════════════════════════════ */
describe('savedLocationCommandParser — "X olan kişiye" tanımlayıcı alıcı (SAHA 2026-09-11)', () => {
  it('"Konumumu aşkım olan kişiye gönder" → KULLANICININ BİREBİR cümlesi, şu anki konum + alıcı "aşkım"', () => {
    const r = tryParseSavedLocationCommand('Konumumu aşkım olan kişiye gönder');
    expect(r?.verb).toBe('send');
    expect(r?.isCurrentLocation).toBe(true);
    expect(r?.recipient).toBe('aşkım');
  });

  it('"Ev konumunu sevgilim olan kişiye gönder" → kayıtlı "Ev" konumu, alıcı "sevgilim"', () => {
    const r = tryParseSavedLocationCommand('Ev konumunu sevgilim olan kişiye gönder');
    expect(r?.verb).toBe('send');
    expect(r?.isCurrentLocation).toBe(false);
    expect(r?.name).toBe('Ev');
    expect(r?.recipient).toBe('sevgilim');
  });

  it('"kişisine" varyantı da desteklenir', () => {
    const r = tryParseSavedLocationCommand("Mavi Göl konumunu eşim olan kişisine gönder");
    expect(r?.verb).toBe('send');
    expect(r?.name).toBe('Mavi Göl');
    expect(r?.recipient).toBe('eşim');
  });

  it('normal tek-token alıcı deseni ETKİLENMEZ (regresyon kilidi)', () => {
    const r = tryParseSavedLocationCommand("Bu konumu Ahmet'e gönder");
    expect(r?.verb).toBe('send');
    expect(r?.recipient).toBe('Ahmet');
  });
});

/**
 * carosLabCopy.test.tsx — CAROS LAB "TÜMÜNÜ KOPYALA" kilitleri.
 *
 * Kopyalama bir DIŞA AKTARIM yüzeyidir: en büyük risk sızıntıdır (VIN · API anahtarı ·
 * MAC · koordinat). Bu yüzden kilitler sırasıyla şunları korur:
 *   1) maskeleme GERÇEKTEN uygulanır (ham VIN/anahtar/MAC metne GİRMEZ),
 *   2) maskelenemeyen kayıt fail-closed DÜŞER ve sayısı dürüstçe BEYAN edilir,
 *   3) okunamayan kaynak "okunamadı" yazar — boş küme VARSAYILMAZ,
 *   4) çıktı BOUNDED (satır + toplam karakter tavanı) ve kırpma açıkça yazılır,
 *   5) model SAF: saat okumaz, servis import etmez (girdi yapısal).
 */

import { describe, it, expect } from 'vitest';
import {
  buildCarosLabCopy,
  CAROS_LAB_COPY_SCHEMA,
  MAX_COPY_ROWS_PER_SECTION,
  MAX_COPY_CHARS,
  type CarosLabCopyInput,
} from '../platform/devtools/carosLabCopyModel';

const META: CarosLabCopyInput['meta'] = {
  generatedAtWallMs: 1_700_000_000_000,
  platform: 'android',
  appVersion: '1.0.2',
  category: 'vehicle',
  activeTool: null,
  captureRefs: { obd: 1, can: 1 },
};

function input(over: Partial<CarosLabCopyInput> = {}): CarosLabCopyInput {
  return {
    meta: META,
    catalog: [{ id: 'live-data', ad: 'Canlı Veri', category: 'vehicle', status: 'AVAILABLE' }],
    session: { connectionState: 'connected' },
    scheduling: { readAt: 1 },
    evidence: [],
    obdTraffic: [],
    canRaw: [],
    discovery: [],
    obdData: { speed: 0 },
    blackBox: [],
    errorLog: [],
    sourceHealth: { canAlive: null, obdAlive: null, gpsAlive: null, updatedAt: null },
    ...over,
  };
}

describe('KİLİT 1 — sızıntı yok (maskeleme gerçekten uygulanır)', () => {
  it('VIN yanıtı ham olarak kopyaya GİRMEZ', () => {
    const r = buildCarosLabCopy(input({
      obdTraffic: [{ cmd: '0902', resp: '49 02 01 57 46 30 41 58 58 54 54 52 41 35 52 31 32 33 34 35', ms: 40, ts: 1 }],
    }));
    expect(r.text).not.toContain('WF0AXXTTRA5R12345');
    expect(r.text).not.toContain('57 46 30 41 58');
  });

  it('sağlayıcı anahtarı / MAC / e-posta metne SIZMAZ', () => {
    const r = buildCarosLabCopy(input({
      evidence: [
        { id: 'e1', payload: 'authorization: bearer_abcdef1234567890xyz' },
        { id: 'e2', payload: 'adapter 00:1D:A5:68:98:8B bağlandı' },
        { id: 'e3', payload: 'destek: selim@example.com' },
        { id: 'e4', payload: 'apiKey=AIzaSyDUMMYKEYVALUE1234567890' },
      ],
    }));
    expect(r.text).not.toContain('bearer_abcdef1234567890xyz');
    expect(r.text).not.toContain('00:1D:A5:68:98:8B');
    expect(r.text).not.toContain('selim@example.com');
    expect(r.text).not.toContain('AIzaSyDUMMYKEYVALUE1234567890');
  });
});

describe('KİLİT 2 — fail-closed: maskelenemeyen kayıt DÜŞER ve beyan edilir', () => {
  it('cmd/resp string değilse kayıt kopyalanmaz, sayısı yazılır', () => {
    const r = buildCarosLabCopy(input({
      obdTraffic: [
        { cmd: 10, resp: null, ms: 1, ts: 1 } as never,    // bozuk: cmd sayı, resp null
        { cmd: '0100', resp: '41 00 BE', ms: 20, ts: 2 },  // sağlam
      ],
    }));
    expect(r.droppedCount).toBeGreaterThanOrEqual(1);
    expect(r.text).toContain('maskelenemediği için düşürüldü');
    expect(r.text).toContain('0100');   // sağlam kayıt kaybolmadı
  });
});

describe('KİLİT 3 — okunamayan kaynak "okunamadı" yazar (boş VARSAYILMAZ)', () => {
  it('null kaynak için "veri yok" DEĞİL "okunamadı" beyan edilir', () => {
    const r = buildCarosLabCopy(input({ session: null, canRaw: null }));
    expect(r.text).toContain('okunamadı');
    // Gerçekten boş olan kaynak ise AYRI ifadeyle yazılır — ikisi karıştırılmaz.
    expect(r.text).toContain('(kayıt yok)');
  });

  it('kaynak dizi değilse sessizce yutulmaz', () => {
    const r = buildCarosLabCopy(input({ evidence: { bozuk: true } as never }));
    expect(r.text).toContain('beklenen dizi biçiminde değil');
  });
});

describe('KİLİT 4 — bounded çıktı, kırpma açıkça yazılır', () => {
  it('bölüm satır tavanı aşılırsa kırpma BEYAN edilir ve son kayıtlar korunur', () => {
    const many = Array.from({ length: MAX_COPY_ROWS_PER_SECTION + 50 }, (_, i) => ({ id: `row-${i}` }));
    const r = buildCarosLabCopy(input({ evidence: many }));
    expect(r.truncated).toBe(true);
    expect(r.text).toContain('kırpıldı');
    expect(r.text).toContain(`row-${MAX_COPY_ROWS_PER_SECTION + 49}`); // en YENİ korunur
    expect(r.text).not.toContain('"row-0"');                            // en eski düşer
  });

  it('toplam karakter tavanı aşılmaz', () => {
    const huge = Array.from({ length: MAX_COPY_ROWS_PER_SECTION }, (_, i) => ({ id: i, blob: 'x'.repeat(5_000) }));
    const r = buildCarosLabCopy(input({ evidence: huge, discovery: huge, canRaw: huge as never }));
    expect(r.chars).toBeLessThanOrEqual(MAX_COPY_CHARS + 200); // + kesme notu
    expect(r.text.length).toBe(r.chars);
  });
});

describe('KİLİT 5 — model SAF ve bağlam dürüst', () => {
  it('başlıkta şema + maskeleme beyanı + açık araç bağlamı vardır', () => {
    const r = buildCarosLabCopy(input({ meta: { ...META, activeTool: 'session-inspector' } }));
    expect(r.text).toContain(CAROS_LAB_COPY_SCHEMA);
    expect(r.text).toContain('maskeleme    : AÇIK');
    expect(r.text).toContain('session-inspector');
    // 14 bölüm: katalog · anlık araç verisi · kaynak sağlığı · SNAPSHOT YAŞI ·
    //   KAZA ALGILAMA ·
    // oturum · zamanlama · kanıt · ham OBD · CAN · keşif · BlackBox ·
    // H-A DENEYİ · hata kütüğü.
    // 2026-08-07: kütük #456 ile "kaza algılama" sayaçları eklendi (yalnız ADET
    // ve eşik; kaza kaydının içeriği LAB'a TAŞINMAZ). Kilit kaldırılmadı —
    // bölüm sayısı yeni doğru değere taşındı.
    // 2026-08-10: kütük #523 ile H-A deneyi bölümü eklendi. Sahada deney gerçek
    // araçta koştu ama kopyada YOKTU → ölçüm okunamadan gitti. Kilit yine
    // kaldırılmadı, yeni doğru değere taşındı.
    // 2026-08-10 (#526): NATIVE SAYAÇ SNAPSHOT YAŞI bölümü eklendi — sahada
    // 5 dakikalık bir önbellek canlı sanılıp "poll durdu" hükmü verilmişti.
    // 2026-08-11 (#535): NAVİGASYON ÇEKİRDEĞİ + ETA SIÇRAMA DEFTERİ eklendi —
    // saha koşumu yapıldı ama fixAgeMs (#508) ve ETA defteri (#530) kopyada
    // YOKTU; ölçüm alınamadı. Kilit kaldırılmadı, yeni doğru değere taşındı.
    expect(r.sectionCount).toBe(16);
    expect(r.text).toContain('ANLIK ARAÇ VERİSİ');
    expect(r.text).toContain('KAYNAK SAĞLIĞI');
    expect(r.text).toContain('BLACKBOX ÖRNEKLERİ');
    expect(r.text).toContain('HATA KÜTÜĞÜ');
    /* #523 — deney bölümü kopyada HER ZAMAN görünür: veri yoksa bile "okunmadı"
       gerekçesiyle. Bölümün hiç olmaması, sahada olanın ta kendisiydi. */
    expect(r.text).toContain('H-A DENEYİ');
    /* #535 — navigasyon ölçümü kopyada HER ZAMAN görünür (veri yoksa 'okunamadı'). */
    expect(r.text).toContain('NAVİGASYON ÇEKİRDEĞİ');
    expect(r.text).toContain('ETA SIÇRAMA DEFTERİ');
  });

  it('aynı girdi → aynı çıktı (saat/rastgelelik okumaz)', () => {
    const a = buildCarosLabCopy(input());
    const b = buildCarosLabCopy(input());
    expect(a.text).toBe(b.text);
  });

  it('girdi tamamen bozuksa bile THROW ETMEZ', () => {
    expect(() => buildCarosLabCopy({} as never)).not.toThrow();
    expect(() => buildCarosLabCopy(null as never)).not.toThrow();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   KİLİT 7 — SAHA ÇIKTISINDA BULUNAN 5 KUSUR (2026-07-25, gerçek cihaz kopyası)
   Kullanıcının yapıştırdığı gerçek çıktı beşini birden ortaya çıkardı. Hepsi
   burada kilitlenir; biri geri gelirse test kırmızıya döner.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('KİLİT 7 — saha kopyasında bulunan kusurlar geri gelmez', () => {
  it('D1: snapshot bölümleri 240 karakterde KESİLMEZ', () => {
    // Gerçek snapshot'lar 240'tan uzundur; eskiden `"fuelLevel":-1,"t` diye kesiliyordu.
    const big: Record<string, number> = {};
    for (let i = 0; i < 120; i++) big[`alan${i}`] = i;
    const r = buildCarosLabCopy(input({ obdData: big }));
    const line = r.text.split('\n')[r.text.split('\n').findIndex((l) => l.startsWith('## ANLIK')) + 1];
    expect(line.length, 'snapshot yine 240\'ta kesiliyor').toBeGreaterThan(240);
    expect(line).toContain('alan119');   // son alan da geldi
  });

  it('D2: araç adları deny-key\'e takılıp DÜŞMEZ', () => {
    const r = buildCarosLabCopy(input({
      catalog: [{ id: 'live-data', ad: 'Canlı Veri', category: 'vehicle', status: 'AVAILABLE' }],
    }));
    expect(r.text, 'araç adı kopyada yok — `name` deny-key\'ine geri dönülmüş')
      .toContain('Canlı Veri');
  });

  it('D3: sürüm verildiyse "bilinmiyor" YAZMAZ', () => {
    const r = buildCarosLabCopy(input({ meta: { ...META, appVersion: '1.0.2' } }));
    expect(r.text).toContain('sürüm        : 1.0.2');
    expect(r.text).not.toContain('sürüm        : bilinmiyor');
  });

  /**
   * KİLİT GÜNCELLENDİ (T10 · 2026-08-01) — davranış BİLİNÇLİ değişti, kilit kalkmadı.
   *
   * Eskiden bu bölümün kaynağı `debugStore.errorLog` idi ve onu besleyen
   * `dbgPushError`in hiç çağıranı yoktu → metin "kanal ÖLÜ" diye uyarıyordu.
   * Artık kaynak canonical `crashLogger` kütüğüdür (`trail:error` ile AYNI
   * otorite), yani kanal ölü DEĞİL. Korunması gereken asıl davranış aynı kalır:
   * BOŞ kütük "hata yok" olarak OKUNMAMALIDIR.
   */
  it('D4: hata kütüğü boşken "hata yok" izlenimi VERMEZ', () => {
    const r = buildCarosLabCopy(input({ errorLog: [] }));
    expect(r.text).toContain('ANLAMINA GELMEZ');
    // Kanal artık canonical otoriteye bağlı — "ölü kanal" iddiası ARTIK YANLIŞ olur.
    expect(r.text).not.toContain('kanal ÖLÜ');
    expect(r.text).toMatch(/crashLogger|trail:error/);
  });

  it('D5: yakalama AÇIK/KAPALI durumu başlıkta BEYAN edilir', () => {
    const acik = buildCarosLabCopy(input({ meta: { ...META, captureRefs: { obd: 2, can: 1 } } }));
    expect(acik.text).toContain('OBD trafiği AÇIK (ref 2)');
    expect(acik.text).toContain('CAN AÇIK (ref 1)');

    const kapali = buildCarosLabCopy(input({ meta: { ...META, captureRefs: { obd: 0, can: 0 } } }));
    expect(kapali.text).toContain('OBD trafiği KAPALI (ref 0)');
    // Boş trafik bölümünün yanlış okunmasına karşı uyarı şart.
    expect(kapali.text).toContain('"trafik yoktu" ANLAMINA GELMEZ');

    const bilinmiyor = buildCarosLabCopy(input({ meta: { ...META, captureRefs: null } }));
    expect(bilinmiyor.text).toContain('yakalama     : BİLİNMİYOR');
  });

  it('D1 yan etkisi: uzun snapshot yine de gizlilik kapısından geçer', () => {
    const r = buildCarosLabCopy(input({
      obdData: { blob: 'x'.repeat(300), token: 'gizli', not: 'mail: selim@example.com' },
    }));
    expect(r.text).not.toContain('selim@example.com');
    expect(r.text).not.toContain('"token"');   // deny-key düşer
  });
});

describe('KİLİT 6 — kaynak okuyucu yeni motor başlatmaz', () => {
  it('carosLabCopySources yalnız senkron getter kullanır (kaynak taraması)', async () => {
    const src = await import('../platform/devtools/carosLabCopySources?raw').then((m) => m.default as string);
    // Yeni timer / abonelik / native pull / komut gönderimi YASAK.
    expect(src).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
    expect(src).not.toMatch(/\.subscribe\(/);
    expect(src).not.toMatch(/sendCommand|startPolling|performHandshake|connect\(/);
    // Her kaynak fail-soft sarmalayıcıdan geçmeli.
    expect(src).toMatch(/function safe</);
  });
});

/* ─────────────────────────────────────────────────────────────────
   KİLİT 8 (S2 · #505) — "BU RAPOR TAZELENMEDİ" UYARISI

   Telefonda ölçüldü (2026-08-01): bu kopya yolu SENKRONDUR ve native kanıtı
   ÇEKMEZ (`refreshExtendedPollEvidence` bilinçli çağrılmaz), bu yüzden temiz
   boot'ta alınan rapor SAĞLAM bir extended poll borusunu ÖLÜ gösterebiliyordu.
   Hüküm katmanı zaten dürüst ("ölçmedik"), ama raporu OKUYAN kişi bunu bölümün
   derinliğinde kaçırıyordu → yanlış teşhis. Uyarı artık raporun BAŞINDA ve
   çağırana bayrak olarak döner (ekranda da gösterilir).
   ───────────────────────────────────────────────────────────────── */
describe('KİLİT 8 — tazelenmemiş kanıtla alınan rapor UYARI taşır', () => {
  it('never_refreshed → metnin başında uyarı + pollEvidenceStale bayrağı', () => {
    const r = buildCarosLabCopy(input({
      meta: { ...META, pollEvidenceCacheState: 'never_refreshed' },
    }));
    expect(r.pollEvidenceStale).toBe(true);
    expect(r.text).toContain('TAZELENMEDİ');
    expect(r.text).toContain('Runtime');
    // Uyarı GÖVDEDE değil BAŞLIKTA olmalı — ilk bölümden önce görünsün.
    expect(r.text.indexOf('TAZELENMEDİ')).toBeLessThan(r.text.indexOf('## KATALOG DURUMU'));
  });

  it('refreshed → uyarı YOK, tazelik durumu dürüstçe yazılır', () => {
    const r = buildCarosLabCopy(input({
      meta: { ...META, pollEvidenceCacheState: 'refreshed' },
    }));
    expect(r.pollEvidenceStale).toBe(false);
    expect(r.text).not.toContain('TAZELENMEDİ');
    expect(r.text).toContain('extended poll önbelleği = refreshed');
  });

  it('tazelik durumu OKUNAMADIYSA "bayat" İDDİA EDİLMEZ (uydurma yok)', () => {
    const r = buildCarosLabCopy(input({ meta: { ...META, pollEvidenceCacheState: null } }));
    expect(r.pollEvidenceStale).toBe(false);
    expect(r.text).toContain('BİLİNMİYOR');
  });
});

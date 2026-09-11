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
  buildCarosLabDomainCopy,
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
    // 2026-08-11 (#536/#537): KOPMA KANIT DEFTERİ + KONUM FIX YAŞI DAĞILIMI
    // eklendi. GÖREV A'nın kökü ölçülmeden bulunamaz (dört aday aynı `timeout`
    // sayısını üretiyor); #508 ise tek anlık örnekle KAPANAMAZ, dağılım gerekir.
    // Kilit yine kaldırılmadı — bölüm sayısı yeni doğru değere taşındı.
    // 2026-08-25 (P0-OBD-FINAL-02): ECU KEŞİF / ADRESLENEBİLİRLİK KANITI bölümü
    // eklendi. Sahada ekranda `ECU 7A (KWP)` · rx 86F17A · tx 817AF1 · rol
    // UNKNOWN GÖRÜNÜYORDU ama kopyada bu kanıt HİÇ YOKTU → gönderilen tam
    // dökümden teşhis çıkarılamadı (#535/#523 ile AYNI sınıf kusur).
    // Kilit yine kaldırılmadı — bölüm sayısı yeni doğru değere taşındı.
    // 2026-08-27 (P0-VDK-F2A): KANONİK TANI İZİ — ÖZET bölümü eklendi. Kopyada
    // olay adedi · sıra boşluğu · tekrar · düşen olay · export engeli YOKTU →
    // gönderilen dökümden "kanıt tam mı, kırpıldı mı" sorusu YANITLANAMIYORDU
    // (#535/P0-OBD-FINAL-02 ile AYNI sınıf kusur). İzin TAMAMI kopyaya
    // GİRMEZ (kullanılamaz hâle gelirdi); ÖZET girer ve kırpma SESSİZ DEĞİLDİR.
    // Kilit yine kaldırılmadı — bölüm sayısı yeni doğru değere taşındı.
    // 2026-08-30 (P0-VDK-FIELD-FIX-A · D): GPS OTORİTE SÖZLEŞMESİ bölümü eklendi.
    // Kopyada `hal.gpsAlive:false` ile `connectivity[GPS].connected:true` YAN YANA
    // duruyor ve çelişki sanılıyordu; üçü FARKLI ekseni ölçer. Ayrışma artık
    // kopyanın KENDİSİ tarafından açıklanır. Kilit yine kaldırılmadı.
    // P0-MAVI-FORENSIC (2026-09-11, ÇOK ÖNEMLİ): 9 Mavi bölümü eklendi (CURRENT
    // STATE · WAKE FORENSICS · LAST TURN · LATENCY · STT/MIC · TTS · ACTION/TOOL
    // · ANOMALIES · EVENT TIMELINE). Öncesinde CAROS LAB kataloğunda Mavi
    // kartları AVAILABLE görünüyordu ama içerikleri kopyaya HİÇ GİRMİYORDU.
    // Kilit yine kaldırılmadı — bölüm sayısı yeni doğru değere (21+9=30) taşındı.
    // BÖLÜM-BAZLI KOPYA (2026-09-11): PHONE LINK bölümü eklendi (Phone Hub canlı
    // bağlantı, kaynak `phoneHubLinkSources` — kanonik TEK okuma noktası).
    // TAM KOPYA bu bölümü de içerir (domain süzme yalnız bölüm-kopyasında
    // devreye girer, TAM KOPYA hep tüm domainleri taşır). 30 → 31.
    expect(r.sectionCount).toBe(31);
    expect(r.text).toContain('PHONE LINK');
    expect(r.text).toContain('GPS OTORİTE SÖZLEŞMESİ');
    expect(r.text).toContain('KANONİK TANI İZİ');
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
    /* P0-OBD-FINAL-02 — ECU kanıt bölümü kopyada HER ZAMAN görünür: kaynak
       okunamadıysa bile "okunamadı" gerekçesiyle. Bölümün HİÇ OLMAMASI,
       sahada olanın ta kendisiydi. */
    expect(r.text).toContain('ECU KEŞİF / ADRESLENEBİLİRLİK KANITI');
    /* P0-MAVI-FORENSIC — Mavi bölümleri kopyada HER ZAMAN görünür: veri yoksa
       bile "okunamadı" gerekçesiyle (bölümün HİÇ OLMAMASI sahada olanın kendisiydi). */
    expect(r.text).toContain('MAVİ CURRENT STATE');
    expect(r.text).toContain('MAVİ WAKE FORENSICS');
    expect(r.text).toContain('MAVİ LAST TURN');
    expect(r.text).toContain('MAVİ LATENCY');
    expect(r.text).toContain('MAVİ STT / MIC');
    expect(r.text).toContain('MAVİ TTS');
    expect(r.text).toContain('MAVİ ACTION / TOOL');
    expect(r.text).toContain('MAVİ ANOMALIES');
    expect(r.text).toContain('MAVİ EVENT TIMELINE');
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

/* ─────────────────────────────────────────────────────────────────
   KİLİT 9 (P0-MAVI-FORENSIC · §11 · ÇOK ÖNEMLİ) — Mavi verisi kopyaya
   GERÇEKTEN girer.

   SAHA KUSURU: CAROS LAB kataloğunda Mavi kartları (Mavi Konsolu · Mavi
   Latency · wake forensics) AVAILABLE görünüyordu ama "TÜMÜNÜ KOPYALA"
   çıktısında içerikleri HİÇ YOKTU — kod tabanında `carosLabCopyModel`/
   `carosLabCopySources` dosyalarında tek bir Mavi/wake/latency/TTS referansı
   yoktu. Bu kilit üç şeyi kanıtlar: (1) veri VARSA gerçekten metne girer,
   (2) kaynak okunamadıysa "okunamadı" yazar, (3) dizi GERÇEKTEN boşsa
   "okunamadı" ile KARIŞTIRILMAZ ("kayıt yok" yazar) — ikisi ASLA aynı satırla
   ifade edilmez.
   ───────────────────────────────────────────────────────────────── */
describe('KİLİT 9 — Mavi forensic verisi kopyaya GERÇEKTEN girer (§11)', () => {
  it('veri VARSA Mavi bölümleri gerçek içerikle dolar (uydurma yok)', () => {
    const r = buildCarosLabCopy(input({
      maviCurrentState: { voice: { status: 'listening', micAvailable: true }, surface: null },
      maviWakeForensics: { summary: { total: 3, evicted: 0 }, recent: [{ atMs: 1, reason: 'ACCEPTED', path: 'GRAMMAR' }] },
      maviLastTurn: { turn: { activeTurnId: 7, activeState: 'active' }, speech: null },
      maviLatency: { enabled: true, traceCount: 2, verdict: 'CONFIRMED' },
      maviSttMic: { diag: [], micAvailable: true, volumeLevel: 0.4 },
      maviTts: { ttsEngine: { requested: 4, engineDone: 4 }, bargeIn: null },
      maviActionTool: { summary: { recorded: 5, dropped: 0 }, records: [] },
      maviAnomalies: [{ id: 'TTS_ENGINE_SILENT', severity: 'critical', evidence: 'noEngineReport=2' }],
      maviEventTimeline: [{ atMs: 1, source: 'wake', label: 'wake:ACCEPTED@GRAMMAR' }],
    }));
    expect(r.text).toContain('listening');
    expect(r.text).toContain('activeTurnId');
    expect(r.text).toContain('CONFIRMED');
    expect(r.text).toContain('TTS_ENGINE_SILENT');
    expect(r.text).toContain('wake:ACCEPTED@GRAMMAR');
  });

  it('kaynak okunamadıysa (null) Mavi bölümü "okunamadı" yazar — boş VARSAYILMAZ', () => {
    const r = buildCarosLabCopy(input({
      maviCurrentState: null, maviWakeForensics: null, maviAnomalies: null, maviEventTimeline: null,
    }));
    const anomaliesBlock = r.text.split('## MAVİ ANOMALIES')[1]?.split('## ')[0] ?? '';
    expect(anomaliesBlock).toContain('okunamadı');
    const timelineBlock = r.text.split('## MAVİ EVENT TIMELINE')[1]?.split('## ')[0] ?? '';
    expect(timelineBlock).toContain('okunamadı');
  });

  it('anomali listesi GERÇEKTEN boşsa "kayıt yok" yazar — "okunamadı" ile KARIŞTIRILMAZ', () => {
    const r = buildCarosLabCopy(input({ maviAnomalies: [], maviEventTimeline: [] }));
    const anomaliesBlock = r.text.split('## MAVİ ANOMALIES')[1]?.split('## ')[0] ?? '';
    expect(anomaliesBlock).toContain('kayıt yok');
    expect(anomaliesBlock).not.toContain('okunamadı');
  });

  it('sağlayıcı anahtarı Mavi bölümüne de sızmaz (üç maskeleme kapısı burada da çalışır)', () => {
    const r = buildCarosLabCopy(input({
      maviLastTurn: { note: 'authorization: bearer_abcdef1234567890xyz' },
    }));
    expect(r.text).not.toContain('bearer_abcdef1234567890xyz');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 10 — BÖLÜM-BAZLI KOPYA (domain projeksiyonu)
 *
 * `buildCarosLabDomainCopy` YENİ bir teşhis otoritesi DEĞİLDİR — `buildSections()`
 * AYNI bölümleri AYNI kaynaklardan AYNI maskeleme zinciriyle üretir; domain
 * yalnız bir SÜZGEÇtir. Kilitler bunu doğrular: bölüm kopyasındaki bir satır
 * TAM KOPYA'daki satırla BİREBİR aynı · yabancı domain sızmaz · maskeleme/
 * fail-closed/unreadable/size-cap davranışı SÜZÜLMÜŞ küme için de AYNEN sürer.
 * ══════════════════════════════════════════════════════════════════════════ */
describe('KİLİT 10 — bölüm-bazlı kopya (domain süzgeci)', () => {
  it('MAVİ KOPYASI yalnız Mavi bölümlerini içerir — OBD/CAN/Navigasyon/Runtime SIZMAZ', () => {
    const full = input({
      maviCurrentState: { voice: { status: 'listening' } },
      obdData: { speed: 77 },
      canRaw: [{ ts: 1, frameId: '7E8', payload: '02 10 03' }],
      navigationCore: { navStatus: 'ACTIVE' },
      scheduling: { readAt: 42 },
    });
    const r = buildCarosLabDomainCopy(full, 'mavi');
    expect(r.text).toContain('# CAROS LAB — MAVİ KOPYASI');
    expect(r.text).toContain('MAVİ CURRENT STATE');
    expect(r.text).toContain('listening');
    // Yabancı domainlerin BÖLÜM BAŞLIKLARI da, İÇERİKLERİ de görünmez.
    expect(r.text).not.toContain('ANLIK ARAÇ VERİSİ');
    expect(r.text).not.toContain('CAN KÜTÜĞÜ');
    expect(r.text).not.toContain('NAVİGASYON ÇEKİRDEĞİ');
    expect(r.text).not.toContain('ÇALIŞMA ZAMANI ZAMANLAMA');
    expect(r.text).not.toContain('"speed":77');
    expect(r.text).not.toContain('7E8');
  });

  it('OBD KOPYASI yalnız OBD bölümlerini içerir — Mavi/CAN SIZMAZ', () => {
    const full = input({
      maviCurrentState: { voice: { status: 'idle' } },
      obdData: { speed: 42, rpm: 900 },
      obdTraffic: [{ cmd: '0100', resp: '41 00 BE', ms: 5, ts: 1 }],
      canRaw: [{ ts: 1, frameId: '123', payload: 'AA BB' }],
    });
    const r = buildCarosLabDomainCopy(full, 'obd');
    expect(r.text).toContain('# CAROS LAB — OBD KOPYASI');
    expect(r.text).toContain('ANLIK ARAÇ VERİSİ');
    expect(r.text).toContain('"rpm":900');
    expect(r.text).toContain('0100');
    expect(r.text).not.toContain('MAVİ CURRENT STATE');
    expect(r.text).not.toContain('CAN KÜTÜĞÜ');
  });

  it('CAN KOPYASI yalnız CAN kütüğünü içerir', () => {
    const full = input({
      canRaw: [{ ts: 1, frameId: '7E8', payload: '02 10 03' }],
      obdData: { speed: 10 },
    });
    const r = buildCarosLabDomainCopy(full, 'can');
    expect(r.text).toContain('# CAROS LAB — CAN KOPYASI');
    expect(r.text).toContain('CAN KÜTÜĞÜ');
    expect(r.text).toContain('7E8');
    expect(r.text).not.toContain('ANLIK ARAÇ VERİSİ');
  });

  it('NAVİGASYON KOPYASI yalnız navigasyon/GPS bölümlerini içerir', () => {
    const full = input({
      navigationCore: { navStatus: 'ACTIVE', etaSeconds: 120 },
      gpsAuthority: { tazelikPenceresiMs: 10_000 },
      obdData: { speed: 5 },
    });
    const r = buildCarosLabDomainCopy(full, 'navigation');
    expect(r.text).toContain('# CAROS LAB — NAVİGASYON KOPYASI');
    expect(r.text).toContain('NAVİGASYON ÇEKİRDEĞİ');
    expect(r.text).toContain('GPS OTORİTE SÖZLEŞMESİ');
    expect(r.text).not.toContain('ANLIK ARAÇ VERİSİ');
  });

  it('RUNTIME KOPYASI yalnız çalışma zamanı bölümlerini içerir', () => {
    const full = input({
      scheduling: { readAt: 99 },
      crashDetection: { written: 2, rejected: 0 },
      obdData: { speed: 5 },
    });
    const r = buildCarosLabDomainCopy(full, 'runtime');
    expect(r.text).toContain('# CAROS LAB — RUNTIME KOPYASI');
    expect(r.text).toContain('ÇALIŞMA ZAMANI ZAMANLAMA');
    expect(r.text).toContain('KAZA ALGILAMA');
    expect(r.text).not.toContain('ANLIK ARAÇ VERİSİ');
  });

  it('PHONE LINK KOPYASI yalnız Phone Hub bağlantı anlık görüntüsünü içerir', () => {
    const full = input({
      phoneLink: { snapshot: { present: true, server: { state: 'LISTENING' } }, cachedAtMs: 123 },
      obdData: { speed: 5 },
    });
    const r = buildCarosLabDomainCopy(full, 'phoneLink');
    expect(r.text).toContain('# CAROS LAB — PHONE LINK KOPYASI');
    expect(r.text).toContain('PHONE LINK');
    expect(r.text).toContain('LISTENING');
    expect(r.text).not.toContain('ANLIK ARAÇ VERİSİ');
  });

  it('kaynak yoksa domain kopyasında da "okunamadı" yazar — boş VARSAYILMAZ', () => {
    const r = buildCarosLabDomainCopy(input({ phoneLink: null }), 'phoneLink');
    expect(r.text).toContain('okunamadı');
  });

  it('maskeleme domain kopyasında da AYNEN çalışır (sızıntı yok)', () => {
    const r = buildCarosLabDomainCopy(input({
      obdTraffic: [{ cmd: '0902', resp: '49 02 01 57 46 30 41 58 58 54 54 52 41 35 52 31 32 33 34 35', ms: 40, ts: 1 }],
    }), 'obd');
    expect(r.text).not.toContain('WF0AXXTTRA5R12345');
  });

  it('fail-closed düşürme domain kopyasında da beyan edilir', () => {
    const r = buildCarosLabDomainCopy(input({
      obdTraffic: [{ cmd: 10, resp: null, ms: 1, ts: 1 } as never],
    }), 'obd');
    expect(r.droppedCount).toBeGreaterThanOrEqual(1);
    expect(r.text).toContain('maskelenemediği için düşürüldü');
  });

  it('satır/toplam karakter tavanı domain kopyasında da uygulanır', () => {
    const bigTraffic = Array.from({ length: 400 }, (_, i) => ({
      cmd: '0100', resp: '41 00 BE', ms: i, ts: i,
    }));
    const r = buildCarosLabDomainCopy(input({ obdTraffic: bigTraffic }), 'obd');
    expect(r.truncated).toBe(true);
    expect(r.text).toContain(`yalnız son ${MAX_COPY_ROWS_PER_SECTION} kayıt`);
    expect(r.chars).toBeLessThanOrEqual(MAX_COPY_CHARS + 200); // kesme notu payı
  });

  it('kapsam satırı süzülen/toplam bölüm sayısını dürüstçe beyan eder', () => {
    const r = buildCarosLabDomainCopy(input(), 'can');
    expect(r.text).toMatch(/kapsam\s+: yalnız CAN \(\d+\/\d+ bölüm\)/);
  });

  it('bölüm kopyasındaki satır TAM KOPYA\'daki satırla BİREBİR AYNIDIR (ikinci üretim yolu yok)', () => {
    const full = input({ obdData: { speed: 88, rpm: 1234 } });
    const tam = buildCarosLabCopy(full);
    const obd = buildCarosLabDomainCopy(full, 'obd');
    const tamBlock = tam.text.split('## ANLIK ARAÇ VERİSİ')[1]?.split('## ')[0] ?? '';
    const obdBlock = obd.text.split('## ANLIK ARAÇ VERİSİ')[1]?.split('## ')[0] ?? '';
    expect(obdBlock).toBe(tamBlock);
  });

  it('TAM KOPYA hâlâ TÜM domainleri içerir — domain süzgeci yalnız BÖLÜM kopyasında devreye girer', () => {
    const r = buildCarosLabCopy(input({
      maviCurrentState: { voice: { status: 'idle' } },
      obdData: { speed: 1 },
      canRaw: [{ ts: 1, frameId: 'AAA', payload: '00' }],
      phoneLink: { snapshot: { present: false } },
    }));
    expect(r.text).toContain('MAVİ CURRENT STATE');
    expect(r.text).toContain('ANLIK ARAÇ VERİSİ');
    expect(r.text).toContain('CAN KÜTÜĞÜ');
    expect(r.text).toContain('PHONE LINK');
  });
});

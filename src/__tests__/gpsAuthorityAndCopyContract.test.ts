/**
 * P0-VDK-FIELD-FIX-A · D + E kilitleri.
 *
 * D — GPS OTORİTE SÖZLEŞMESİ: `hal.gpsAlive:false` ile
 *     `connectivity[GPS].connected:true` aynı kopyada çelişki gibi okunuyordu.
 *     Üç eksen (sağlayıcı bağlantısı · taze fix · nav-tüketilebilir fix) ayrı
 *     isimlerle sunulur; ayrışma AÇIKLANIR, gizlenmez.
 *
 * E — TAM KOPYA SELF-DESCRIBING: bounded liste tek başına TAM liste gibi
 *     görünemez (`gatedCount:25` + 16 elemanlı `gatedPids` sahte çelişkisi).
 *
 * Bu modüller SAF: I/O yok, saat okuma yok, karar üretme yok (LAB ikinci
 * otorite OLAMAZ) — testler de öyle çalışır.
 */
import { describe, it, expect } from 'vitest';
import {
  describeGpsAuthorities,
  explainGpsAuthorityDivergence,
  type GpsAuthorityInput,
} from '../platform/gps/gpsHealthReconcile';

/** Saha kopyası 1788096650111'den birebir alınan değerler. */
function fieldInput(over: Partial<GpsAuthorityInput> = {}): GpsAuthorityInput {
  return {
    connectivityConnected: true,     // connectivity[GPS].connected
    halGpsAlive:           false,    // hal.gpsAlive  ← görünen "çelişki"
    locationFixAgeMs:      735,      // konumFixYasMs
    navFixAgeMs:           null,     // fixAgeMs (nav aktif değil)
    fixFreshWindowMs:      10_000,
    ...over,
  };
}

describe('D · GPS otorite sözleşmesi — üç eksen ayrı', () => {
  it('🔒 üç eksen ayrı isim ve ayrı kaynakla sunulur', () => {
    const views = describeGpsAuthorities(fieldInput());
    expect(views.map((v) => v.axis)).toEqual(['PROVIDER_LINK', 'RECENT_FIX', 'NAV_CONSUMABLE']);
    /* Her eksen KENDİ kanonik kaynağını taşır → LAB kendi gerçeğini üretmez. */
    expect(views[0].source).toContain('connectivity[GPS].connected');
    expect(views[1].source).toContain('locationFixAgeMs');
    expect(views[2].source).toContain('fixAgeMs');
    expect(new Set(views.map((v) => v.source)).size).toBe(3);
  });

  it('🔒 SAHA vakası: bağlantı CANLI · fix TAZE · nav fix ÖLÇÜLMEDİ', () => {
    const v = describeGpsAuthorities(fieldInput());
    expect(v[0].value).toBe(true);    // sağlayıcı bağlı
    expect(v[1].value).toBe(true);    // 735 ms < 10 sn → taze
    expect(v[2].value).toBeNull();    // nav aktif değil → ÖLÇÜLMEDİ (false DEĞİL)
  });

  it('🔒 nav fix yokluğu ARIZA olarak raporlanmaz (null ≠ false)', () => {
    const v = describeGpsAuthorities(fieldInput({ navFixAgeMs: null }));
    expect(v[2].value).toBeNull();
    expect(v[2].note).toContain('ARIZA DEĞİL');
  });

  it('🔒 bayat konum fix\'i taze GÖSTERİLMEZ', () => {
    const v = describeGpsAuthorities(fieldInput({ locationFixAgeMs: 45_000 }));
    expect(v[1].value).toBe(false);
  });

  it('🔒 ölçülmemiş eksen `null` kalır — "sağlıklı" varsayılmaz', () => {
    const v = describeGpsAuthorities(fieldInput({
      connectivityConnected: null, locationFixAgeMs: null, navFixAgeMs: null,
    }));
    expect(v.every((x) => x.value === null)).toBe(true);
  });

  it('🔒 SAHA ayrışması AÇIKLANIR ve otoriteyi adıyla söyler', () => {
    const msg = explainGpsAuthorityDivergence(fieldInput());
    expect(msg).not.toBeNull();
    expect(msg!).toContain('sistem görüşü CANLI');
    expect(msg!).toContain('worker-yerel görüş ÖLÜ');
    expect(msg!).toContain('ARIZA DEĞİL');
    expect(msg!).toContain('#517');
  });

  it('🔒 ayrışma yoksa açıklama ÜRETİLMEZ (gürültü yok)', () => {
    expect(explainGpsAuthorityDivergence(fieldInput({ halGpsAlive: true }))).toBeNull();
  });

  it('🔒 taraflardan biri ölçülmediyse ayrışma İDDİA EDİLMEZ', () => {
    expect(explainGpsAuthorityDivergence(fieldInput({ halGpsAlive: null }))).toBeNull();
    expect(explainGpsAuthorityDivergence(fieldInput({ connectivityConnected: null }))).toBeNull();
  });

  it('🔒 SAF: aynı girdi aynı çıktıyı verir (saat/I/O okumaz)', () => {
    const a = JSON.stringify(describeGpsAuthorities(fieldInput()));
    const b = JSON.stringify(describeGpsAuthorities(fieldInput()));
    expect(a).toBe(b);
  });
});

describe('E · TAM KOPYA bounded alanları dürüstçe açıklar', () => {
  it('🔒 kırpılmış gated PID listesi TAM LİSTE gibi görünemez', async () => {
    const { buildSchedChannels } = await import('../platform/devtools/runtimeSchedulingBuild');
    const pids = Array.from({ length: 16 }, (_, i) => `P${i}`);
    const channels = buildSchedChannels({
      readAt: 1_000,
      pollEvidence: null,
      elimState: 'ok', elimRefreshedAt: null, pollEvidenceRefreshedAt: null, elim: null,
      extGate: {
        supportedKnown: true, supportedCount: 15, watchedCount: 33, gatedCount: 25,
        gatedPids: pids, gatedPidsShown: 16, gatedPidsTotal: 25, gatedPidsTruncated: true,
        discoveryPending: 0, nativeListCount: 8, burst: false, discoveryCompleteness: 'complete',
      },
      timeline: null, sessionHealth: null, obdStatus: null, health: null,
      freshWindowMs: null, handshake: null, kwp: null, deepScan: null,
      canCollect: null, capture: null,
    } as never);
    const row = channels.flatMap((c) => c.fields).find((f) => f.id === 'cmdGatePids');
    expect(row).toBeDefined();
    expect(String(row!.value)).toContain('16/25 gösteriliyor');
    expect(row!.note).toContain('TAM LİSTE DEĞİLDİR');
  });
});

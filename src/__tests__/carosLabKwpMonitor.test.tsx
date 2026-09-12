/**
 * carosLabKwpMonitor.test.tsx — CAROS LAB · KWP İzleyici (Faz A4) KİLİTLERİ.
 *
 * ANA İLKE: bu ekran KWP kurtarma merdivenini İZLER, YÖNETMEZ. Kilitler şunları
 * doğrular: (a) native/keep-alive kaynağı olmayan alanlar UYDURULMAZ, (b) hüküm
 * FAIL-CLOSED (kanıt yoksa "sağlıklı" DEĞİL), (c) ekran komut/motor yüzeyi açmaz,
 * (d) timer/abonelik kurmaz ve unmount sonrası setState yapmaz.
 *
 * Model TAMAMEN SAF (servis importu yok) → mock'suz test edilir.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  buildKwpSections, deriveKwpActivity, countByKwpClass,
  KWP_SECTION_ORDER, KWP_SECTION_TITLE, KWP_ACTIVITY_LABEL,
  KWP_RECOVERY_STATUS_LABEL, MAX_FIELDS_PER_KWP_SECTION,
  type KwpRawSnapshot, type KwpRecoveryRaw, type KwpSection,
} from '../platform/devtools/kwpMonitorModel';
import { getCarosLabTool } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';

/* ══════════════════════════════════════════════════════════════════════════
 * Fixture
 * ════════════════════════════════════════════════════════════════════════ */

const NOW = 1_700_000_000_000;

function recovery(over: Partial<KwpRecoveryRaw> = {}): KwpRecoveryRaw {
  return {
    status: 'NOT_ATTEMPTED',
    coreNoDataStreak: 0,
    maxCoreNoDataStreak: 0,
    recoveryCount: 0,
    suppressedCount: 0,
    atpcSendFailures: 0,
    lastRecoveryAt: 0,
    lastRecoveryToFirstPidMs: -1,
    killedByDataGate: 0,
    protocolAtRecovery: null,
    threshold: 3,
    maxPerSession: 5,
    ...over,
  };
}

/** Varsayılan: KWP (proto 5) aktif, veri taze, kurtarma gerekmemiş. */
function snapshot(over: Partial<KwpRawSnapshot> = {}): KwpRawSnapshot {
  return {
    readAt: NOW,
    protocolActive: '5',
    protocolTried: '5',
    protocolClass: 'kwp',
    slowSerial: true,
    transportConnected: true,
    connectionState: 'connected',
    dataFresh: true,
    lastRxAt: NOW - 800,
    freshWindowMs: 12_000,
    pollingActive: true,
    recovery: recovery(),
    ...over,
  };
}

function findField(sections: readonly KwpSection[], id: string) {
  for (const s of sections) {
    const f = s.fields.find((x) => x.id === id);
    if (f) return f;
  }
  return undefined;
}

function sectionOf(sections: readonly KwpSection[], id: string) {
  return sections.find((s) => s.id === id);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1. YAPI — bölümler sabit ve bounded
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 1 — bölüm yapısı deterministik ve bounded', () => {
  it('bölümler SABİT sırada üretilir', () => {
    const ids = buildKwpSections(snapshot()).map((s) => s.id);
    expect(ids).toEqual([...KWP_SECTION_ORDER]);
  });

  it('her bölümün başlığı sözlükten gelir (ekranda undefined basmaz)', () => {
    for (const s of buildKwpSections(snapshot())) {
      expect(s.title, `${s.id} başlığı yok`).toBe(KWP_SECTION_TITLE[s.id]);
      expect(s.title.length).toBeGreaterThan(0);
    }
  });

  it('hiçbir bölüm alan tavanını AŞMAZ (Mali-400 render bütçesi)', () => {
    for (const s of buildKwpSections(snapshot())) {
      expect(s.fields.length).toBeLessThanOrEqual(MAX_FIELDS_PER_KWP_SECTION);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. KEEP-ALIVE — ATWM/ATSW/ATST ASLA uydurulmaz
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 2 — ATWM/ATSW/ATST kaynağı YOK, uydurulmaz', () => {
  it('keep-alive bölümündeki HER alan UNAVAILABLE', () => {
    const sec = sectionOf(buildKwpSections(snapshot()), 'keepalive')!;
    expect(sec.fields.length).toBeGreaterThanOrEqual(3);
    for (const f of sec.fields) {
      expect(f.klass, `${f.id} UNAVAILABLE değil — ölçülmemiş değer gösteriliyor olabilir`).toBe('UNAVAILABLE');
      expect(f.value, `${f.id} bir değer basıyor`).toBe('—');
      expect(f.note.length, `${f.id} gerekçesiz`).toBeGreaterThan(0);
    }
  });

  it('ATWM · ATSW · ATST üçü de ayrı ayrı beyan edilir', () => {
    const sections = buildKwpSections(snapshot());
    for (const id of ['kwpKeepAliveMsg', 'kwpKeepAliveInterval', 'kwpResponseTimeout']) {
      expect(findField(sections, id), `${id} alanı yok`).toBeDefined();
    }
  });

  it('KANIT: kurtarma verisi TAM olsa bile keep-alive UNAVAILABLE kalır', () => {
    // Kanıt zenginliği, ölçülmemiş keep-alive alanlarını "doldurma" bahanesi OLAMAZ.
    const sections = buildKwpSections(snapshot({
      recovery: recovery({ status: 'RECOVERED', recoveryCount: 4, lastRecoveryToFirstPidMs: 900 }),
    }));
    const sec = sectionOf(sections, 'keepalive')!;
    expect(sec.fields.every((f) => f.klass === 'UNAVAILABLE')).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. SENTINEL DEĞERLER — 0 ve -1 ham gösterilmez
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 3 — sentinel değerler tarih/süre gibi GÖSTERİLMEZ', () => {
  it('lastRecoveryAt=0 → UNAVAILABLE (epoch 0 tarihi basılmaz)', () => {
    const f = findField(buildKwpSections(snapshot()), 'lastRecoveryAt')!;
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.value).toBe('—');
    expect(f.value).not.toContain('1970');
  });

  it('lastRecoveryAt>0 → ISO damga + updatedAt taşır', () => {
    const at = NOW - 30_000;
    const f = findField(buildKwpSections(snapshot({ recovery: recovery({ lastRecoveryAt: at }) })), 'lastRecoveryAt')!;
    expect(f.klass).toBe('OBSERVED');
    expect(f.value).toBe(new Date(at).toISOString());
    expect(f.updatedAt).toBe(at);
  });

  it('lastRecoveryToFirstPidMs=-1 → UNAVAILABLE (-1 ms diye basılmaz)', () => {
    const f = findField(buildKwpSections(snapshot()), 'lastRecoveryToFirstPidMs')!;
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.value).not.toContain('-1');
  });

  it('lastRecoveryToFirstPidMs>=0 → ÖLÇÜLDÜ olarak gösterilir', () => {
    const f = findField(
      buildKwpSections(snapshot({ recovery: recovery({ lastRecoveryToFirstPidMs: 0 }) })),
      'lastRecoveryToFirstPidMs',
    )!;
    expect(f.klass).toBe('OBSERVED');
    expect(f.value).toBe('0');
  });

  it('threshold/maxPerSession 0 ise UNAVAILABLE (native sabiti gelmemiş)', () => {
    const sections = buildKwpSections(snapshot({ recovery: recovery({ threshold: 0, maxPerSession: 0 }) }));
    expect(findField(sections, 'threshold')!.klass).toBe('UNAVAILABLE');
    expect(findField(sections, 'maxPerSession')!.klass).toBe('UNAVAILABLE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. KANIT YOKLUĞU — sayaçlar 0 diye UYDURULMAZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 4 — native kanıt yoksa sayaç UYDURULMAZ', () => {
  it('recovery=null → tek bir UNAVAILABLE beyanı, sahte 0 sayaç YOK', () => {
    const sec = sectionOf(buildKwpSections(snapshot({ recovery: null })), 'recovery')!;
    expect(sec.fields).toHaveLength(1);
    expect(sec.fields[0].klass).toBe('UNAVAILABLE');
    // "0" gösteren hiçbir sayaç alanı üretilmemeli.
    expect(sec.fields.some((f) => f.value === '0')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. BAYATLIK — yalnız gerçek damga + tanımlı eşik
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 5 — bayatlık uydurma eşikle HESAPLANMAZ', () => {
  it('eşik yoksa (freshWindowMs=null) alan STALE olmaz', () => {
    const sections = buildKwpSections(snapshot({ freshWindowMs: null, lastRxAt: NOW - 600_000 }));
    expect(findField(sections, 'lastRxAt')!.klass).not.toBe('STALE');
    expect(findField(sections, 'freshWindowMs')!.klass).toBe('UNAVAILABLE');
  });

  it('eşik VARSA ve damga eskiyse STALE olur', () => {
    const sections = buildKwpSections(snapshot({ freshWindowMs: 5_000, lastRxAt: NOW - 60_000 }));
    expect(findField(sections, 'lastRxAt')!.klass).toBe('STALE');
  });

  it('damga yoksa (lastRxAt=null) bayatlık hesaplanmaz → UNAVAILABLE', () => {
    const f = findField(buildKwpSections(snapshot({ lastRxAt: null })), 'lastRxAt')!;
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.updatedAt).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6. HÜKÜM — FAIL-CLOSED
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 6 — genel hüküm fail-closed', () => {
  it('protokol bilinmiyorsa UNKNOWN (sağlıklı VARSAYILMAZ)', () => {
    const r = deriveKwpActivity(snapshot({ slowSerial: null, protocolClass: null, protocolActive: null }));
    expect(r.status).toBe('UNKNOWN');
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it('CAN aracında NOT_APPLICABLE — boş ekran arıza DEĞİL', () => {
    const r = deriveKwpActivity(snapshot({ slowSerial: false, protocolClass: 'can', protocolActive: '6' }));
    expect(r.status).toBe('NOT_APPLICABLE');
    expect(r.reasons.join(' ')).toMatch(/CAN|yavaş seri DEĞİL/);
  });

  it('KWP aktif ama kanıt yoksa UNKNOWN (0 sayaç "sorun yok" DEĞİL)', () => {
    const r = deriveKwpActivity(snapshot({ recovery: null }));
    expect(r.status).toBe('UNKNOWN');
    expect(r.reasons.join(' ')).toMatch(/GELMEZ|okunamadı/);
  });

  it('IN_PROGRESS → RECOVERING', () => {
    expect(deriveKwpActivity(snapshot({ recovery: recovery({ status: 'IN_PROGRESS' }) })).status)
      .toBe('RECOVERING');
  });

  it('FAILED · bastırılan · gate yıkımı · seri · bayat veri → DEGRADED', () => {
    const vakalar: Partial<KwpRawSnapshot>[] = [
      { recovery: recovery({ status: 'FAILED' }) },
      { recovery: recovery({ status: 'RECOVERED', recoveryCount: 1 }) },
      { recovery: recovery({ suppressedCount: 2 }) },
      { recovery: recovery({ atpcSendFailures: 1 }) },
      { recovery: recovery({ killedByDataGate: 3 }) },
      { recovery: recovery({ coreNoDataStreak: 2 }) },
      { dataFresh: false },
    ];
    for (const v of vakalar) {
      const r = deriveKwpActivity(snapshot(v));
      expect(r.status, `bu vaka DEGRADED olmalıydı: ${JSON.stringify(v)}`).toBe('DEGRADED');
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });

  it('temiz KWP oturumu → HEALTHY (tek gerekçeyle)', () => {
    const r = deriveKwpActivity(snapshot());
    expect(r.status).toBe('HEALTHY');
    expect(r.reasons).toHaveLength(1);
  });

  it('her hüküm için Türkçe etiket EKSİKSİZ', () => {
    for (const k of ['UNKNOWN', 'NOT_APPLICABLE', 'HEALTHY', 'RECOVERING', 'DEGRADED'] as const) {
      expect(KWP_ACTIVITY_LABEL[k], `${k} etiketi yok`).toBeTruthy();
    }
  });

  it('her native kurtarma durumu için Türkçe etiket EKSİKSİZ', () => {
    for (const k of ['NOT_ATTEMPTED', 'IN_PROGRESS', 'RECOVERED', 'FAILED']) {
      expect(KWP_RECOVERY_STATUS_LABEL[k], `${k} etiketi yok`).toBeTruthy();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7. SAYIM + FAIL-SOFT
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 7 — sayım ve bozuk girdi dayanıklılığı', () => {
  it('countByKwpClass sınıfları doğru sayar', () => {
    const c = countByKwpClass(buildKwpSections(snapshot()));
    expect(c.OBSERVED + c.DERIVED + c.UNAVAILABLE + c.STALE)
      .toBe(buildKwpSections(snapshot()).reduce((n, s) => n + s.fields.length, 0));
    expect(c.UNAVAILABLE).toBeGreaterThanOrEqual(4); // en az keep-alive dörtlüsü
  });

  it('tüm kaynaklar null iken model PATLAMAZ (fail-soft)', () => {
    const bos: KwpRawSnapshot = {
      readAt: NOW,
      protocolActive: null, protocolTried: null, protocolClass: null, slowSerial: null,
      transportConnected: null, connectionState: null, dataFresh: null, lastRxAt: null,
      freshWindowMs: null, pollingActive: null, recovery: null,
    };
    expect(() => buildKwpSections(bos)).not.toThrow();
    expect(() => deriveKwpActivity(bos)).not.toThrow();
    expect(deriveKwpActivity(bos).status).toBe('UNKNOWN');
  });

  it('countByKwpClass bozuk girdide sıfır döner', () => {
    expect(countByKwpClass(undefined as unknown as KwpSection[]))
      .toEqual({ OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0 });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8. KATALOG + EKRAN EŞLEMESİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 8 — katalog ve ekran eşlemesi tutarlı', () => {
  it('kwp-monitor AVAILABLE ve gerçek bir ekrana eşlenir', () => {
    const tool = getCarosLabTool('kwp-monitor')!;
    expect(tool.status, 'kwp-monitor yine PLACEHOLDER').toBe('AVAILABLE');
    expect(renderAvailableTool('kwp-monitor'), 'AVAILABLE ama ekran eşlemesi YOK → sahte "çalışıyor"')
      .not.toBeNull();
  });

  it('katalog notu keep-alive kaynağının YOK olduğunu beyan eder', () => {
    const tool = getCarosLabTool('kwp-monitor')!;
    expect(tool.note ?? '').toMatch(/ATWM/);
    expect(tool.note ?? '').toMatch(/KAYNAK YOK|AÇILMAMIŞ/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9. EKRAN — salt-okunur, timer/abonelik/komut YOK (kaynak taraması)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 9 — ekran bileşeni salt-okunur ve zero-leak', () => {
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('timer/abonelik/polling kurmaz (tek atış sayaç tazelemesi hariç)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(
      readFileSync('src/components/devtools/screens/KwpMonitorScreen.tsx', 'utf8'));
    for (const f of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'subscribe', 'addListener']) {
      expect(src, `${f} bulundu — periyodik/abonelikli yol açılmış`).not.toContain(f);
    }
  });

  it('komut / motor / kurtarma tetikleme yüzeyi YOK', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(
      readFileSync('src/components/devtools/screens/KwpMonitorScreen.tsx', 'utf8'));
    // Not: 'ATPC'/'ATWM' metinleri ekranda ETİKET olarak geçer; burada aranan
    // ÇAĞRI yüzeyidir — bu yüzden fonksiyon adları ve komut kanalları denetlenir.
    for (const f of [
      'sendCommand', 'connectOBD', 'disconnectOBD', 'reconnect(',
      'notifyKwpDataGateTeardown', 'startDeepScan', 'clearDTC', 'setDiagnosticBurst',
      'CarLauncher',
    ]) {
      expect(src, `${f} çağrısı var — ekran artık salt-okunur DEĞİL`).not.toContain(f);
    }
    // Komut kanalına giden HİÇBİR import olmamalı (native plugin / obdService).
    expect(src, 'native plugin import edilmiş — komut yolu açılmış').not.toMatch(/from '.*nativePlugin'/);
    expect(src, 'obdService doğrudan import edilmiş — okuma kaynak katmanından geçmeli')
      .not.toMatch(/from '.*\/obdService'/);
  });

  it('izin verilen TEK async çağrı salt-okunur native sayaç tazelemesidir', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(
      readFileSync('src/components/devtools/screens/KwpMonitorScreen.tsx', 'utf8'));
    expect(src).toContain('refreshKwpRecoveryEvidence');
    // Açılış efekti TEK ATIŞ olmalı — polling'e dönüşmesin.
    expect(src).toMatch(/useEffect\(\(\) => \{ refresh\(\); \}, \[refresh\]\)/);
  });

  it('ZERO-LEAK: unmount sonrası setState yapılmaz', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/devtools/screens/KwpMonitorScreen.tsx', 'utf8');
    expect(src, 'mountedRef temizliği yok — unmount sonrası setState riski').toContain('mountedRef.current = false');
    expect(src, 'setSnap mountedRef kapısından geçmiyor').toMatch(/if \(mountedRef\.current\) setSnap/);
    // Temizlik fonksiyonu GERÇEKTEN dönülmeli.
    expect(src).toMatch(/return \(\) => \{ mountedRef\.current = false; \};/);
  });

  it('sabit hex renk KULLANMAZ — yalnız --oem-* tokenları', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(
      readFileSync('src/components/devtools/screens/KwpMonitorScreen.tsx', 'utf8'));
    expect(src, 'sabit hex renk geri geldi (aydınlık temada bozulur)').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src, 'tailwind palet rengi kullanılmış').not.toMatch(
      /\b(?:text|bg|border)-(?:cyan|emerald|amber|rose|sky|slate|zinc|gray|neutral)-\d{2,3}\b/);
    expect(src).toContain('var(--oem-');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10. RENDER — kaynak yokken bile çökmeden basar
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 10 — ekran render', () => {
  it('OBD servisi hiç bağlı değilken bile çökmeden render olur', async () => {
    vi.resetModules();
    // Native yok → refreshKwpRecoveryEvidence no-op, getKwpRecoveryEvidence null döner.
    const { KwpMonitorScreen } = await import('../components/devtools/screens/KwpMonitorScreen');
    let html = '';
    expect(() => { html = renderToStaticMarkup(<KwpMonitorScreen />); }).not.toThrow();
    expect(html).toContain('kwp-monitor');
    expect(html).toContain('SALT OKUNUR');
  });

  it('ham hüküm enum\'u DOM\'da beyan edilir (dile bağımsız makine sözleşmesi)', async () => {
    const { KwpMonitorScreen } = await import('../components/devtools/screens/KwpMonitorScreen');
    const html = renderToStaticMarkup(<KwpMonitorScreen />);
    expect(html).toMatch(/data-activity="(UNKNOWN|NOT_APPLICABLE|HEALTHY|RECOVERING|DEGRADED)"/);
  });

  it('keep-alive bölümü ekranda "GÖZLEM KANALI YOK" ile işaretlenir', async () => {
    const { KwpMonitorScreen } = await import('../components/devtools/screens/KwpMonitorScreen');
    const html = renderToStaticMarkup(<KwpMonitorScreen />);
    expect(html).toContain('kwp-section-keepalive');
    expect(html).toContain('GÖZLEM KANALI YOK');
  });
});

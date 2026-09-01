/**
 * ARCH-06/F7 — MAVI + MEDIA + PHONE LINK + LAB · KİLİT TESTLERİ.
 *
 * F7'nin ana riski **sahte kazanç** ve **ikinci otorite**dir:
 *  (a) sırf "8/8 bağlandı" demek için var olmayan tüketiciye tavan bağlamak,
 *  (b) ARM'ın zaten yönettiği yüzeye ikinci bir kapı takmak,
 *  (c) performans uğruna Mavi doğruluğunu / Media truth'unu / Phone Link
 *      güvenlik semantiğini bozmak.
 *
 * Bu dosya üçünü de yapısal olarak engeller.
 * Referans: CLAUDE.md §CROSS-DOMAIN ARCHITECTURE RULES §1 · §5 · §7 · §8 · §15.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

import {
  ceilingOwnership, boundWorkloads, workloadOrder,
  type WorkloadCeiling,
} from '../platform/perf/workloadCeilings';
import {
  labSamplingStride, LAB_CLOSED_BEHAVIOR, getLabSamplingEvidence,
  _resetCarosLabRefreshForTest,
} from '../platform/devtools/carosLabRefreshRuntime';
import { DEFAULT_CONTEXT_BUDGET } from '../platform/ai/context/contextPolicy';
import { getPerformanceDiagnosticsSnapshot } from '../platform/perf/performanceAggregator';
import { getPerfCounters } from '../platform/perf/perfCounters';

const CEILINGS = readFileSync('src/platform/perf/workloadCeilings.ts', 'utf8');
const LAB_RUNTIME = readFileSync('src/platform/devtools/carosLabRefreshRuntime.ts', 'utf8');
const LAB_BAR = readFileSync('src/components/devtools/CarosLabRefreshBar.tsx', 'utf8');
const SERIALIZER = readFileSync('src/platform/ai/context/contextSerializer.ts', 'utf8');
const MAVI_CHAT = readFileSync('src/platform/ai/orchestrator/concrete/maviOrchestratedChat.ts', 'utf8');
const PLAYBACK_TRUTH = readFileSync('src/platform/media/authority/playbackTruth.ts', 'utf8');
const MEDIA_GATEWAY = readFileSync('src/platform/media/authority/mediaCommandGateway.ts', 'utf8');
const COMPANION_SESSION = readFileSync('src/platform/companion/companionSessionManager.ts', 'utf8');

function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

beforeEach(() => { _resetCarosLabRefreshForTest(); });

/* ═══════════════════════════════════════════════════════════════════════════
   A) TAVAN SAHİPLİĞİ — sahte kazanç iddiası yasağı
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F7/A · tavanı kim uyguluyor, dürüstçe yazılı', () => {
  it('A1 · her iş yükü için TAM BİR sahiplik satırı var', () => {
    const rows = ceilingOwnership();
    expect(rows.map((r) => r.workload).sort()).toEqual([...workloadOrder()].sort());
    expect(new Set(rows.map((r) => r.workload)).size).toBe(rows.length);
  });

  it('A2 · WORKLOAD_CEILING diyen satır GERÇEK bir tüketici ADLANDIRMALI', () => {
    /* "Bağlandı" demek ama tüketici gösterememek, ölçülmemiş bir kazanç
       iddiasıdır — F7'nin yasakladığı tam olarak budur. */
    for (const r of ceilingOwnership()) {
      if (r.enforcer !== 'WORKLOAD_CEILING') continue;
      expect(r.consumer, `${r.workload} tüketici adlandırmıyor`).not.toBeNull();
      expect(r.consumer!.length).toBeGreaterThan(3);
    }
  });

  it('A3 · bağlanmayan satır tüketici İDDİA ETMEZ', () => {
    for (const r of ceilingOwnership()) {
      if (r.enforcer === 'NO_CONSUMER' || r.enforcer === 'DELIBERATELY_UNBOUND') {
        expect(r.consumer, `${r.workload} olmayan tüketici iddia ediyor`).toBeNull();
      }
      expect(r.rationale.length, `${r.workload} gerekçesiz`).toBeGreaterThan(20);
    }
  });

  it('A4 · boundWorkloads() sahiplik tablosuyla TUTARLI', () => {
    const fromTable = ceilingOwnership()
      .filter((r) => r.enforcer === 'WORKLOAD_CEILING')
      .map((r) => r.workload).sort();
    expect([...boundWorkloads()].sort()).toEqual(fromTable);
  });

  it('A5 · ARM’ın yönettiği kategoriye İKİNCİ tavan bağlanmaz (Cross-Domain §1/§8)', () => {
    /* `enableAnimations`/`enableBlur`/`enableShadows` ARM otoritesindedir ve
       MainLayout · MediaScreen · livingThemeState tarafından GERÇEKTEN okunur.
       Aynı yüzeye ikinci kapı takmak çelişki üretirdi. */
    const armOwned = ceilingOwnership()
      .filter((r) => r.enforcer === 'ARM_RUNTIME_CONFIG')
      .map((r) => r.workload);
    expect(armOwned.length).toBeGreaterThan(0);
    for (const w of armOwned) {
      expect(boundWorkloads(), `${w} ikinci otorite kurmuş`).not.toContain(w);
    }
  });

  it('A6 · en az bir kategori GERÇEKTEN bağlı (tablo tamamen dekoratif değil)', () => {
    expect(boundWorkloads().length).toBeGreaterThan(0);
    expect(boundWorkloads()).toContain('backgroundIndexing');
    expect(boundWorkloads()).toContain('labSampling');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) LAB ÖRNEKLEME ADIMI — saf ve monoton
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F7/B · labSamplingStride', () => {
  it('B1 · tavan → adım eşlemesi sabit', () => {
    expect(labSamplingStride('FULL')).toBe(1);
    expect(labSamplingStride('REDUCED')).toBe(2);
    expect(labSamplingStride('MINIMAL')).toBe(4);
    expect(labSamplingStride('OFF')).toBeNull();
  });

  it('B2 · daha sıkı tavan asla DAHA SIK örneklemez', () => {
    const order: WorkloadCeiling[] = ['FULL', 'REDUCED', 'MINIMAL', 'OFF'];
    let prev = 0;
    for (const c of order) {
      const st = labSamplingStride(c);
      if (st === null) { expect(c).toBe('OFF'); break; }
      expect(st, `${c} daha sık örnekliyor`).toBeGreaterThanOrEqual(prev);
      prev = st;
    }
  });

  it('B3 · adım hiçbir zaman 0 değildir (modulo tuzağı)', () => {
    for (const c of ['FULL', 'REDUCED', 'MINIMAL'] as WorkloadCeiling[]) {
      expect(labSamplingStride(c)).toBeGreaterThan(0);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) LAB KAPALI DAVRANIŞI — sözleşme kilidi
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F7/C · labClosedBehavior', () => {
  it('C1 · sözleşmenin her alanı kilitli', () => {
    expect(LAB_CLOSED_BEHAVIOR.autoRefreshTimer).toBe('STOPPED');
    expect(LAB_CLOSED_BEHAVIOR.subscriptions).toBe('DETACHED');
    expect(LAB_CLOSED_BEHAVIOR.probes).toBe('NOT_INVOKED');
    expect(LAB_CLOSED_BEHAVIOR.backgrounded).toBe('STOPPED');
  });

  it('C2 · LAB ÜRETİM davranışı üretmez (LAB ikinci otorite olamaz)', () => {
    expect(LAB_CLOSED_BEHAVIOR.productionEffect).toBe('NONE');
  });

  it('C3 · zamanlayıcı ve dinleyici unmount’ta SÖKÜLÜR (zero-leak)', () => {
    const code = codeOnly(LAB_BAR);
    const ret = code.slice(code.indexOf('return () => {', code.indexOf('onVisibility')));
    expect(ret.slice(0, 300)).toMatch(/stop\(\)/);
    expect(ret.slice(0, 300)).toMatch(/removeEventListener/);
  });

  it('C4 · arka plana geçince örnekleme DURUR', () => {
    /* Olay ADI bir string literalidir → HAM kaynakta aranır; akış (durdurma
       dalı) ise kod üzerinde doğrulanır. İkisi ayrı ayrı kanıttır. */
    expect(LAB_BAR).toMatch(/addEventListener\('visibilitychange'/);
    expect(LAB_BAR).toMatch(/removeEventListener\('visibilitychange'/);
    expect(codeOnly(LAB_BAR)).toMatch(/hidden\(\)\s*\)\s*\{\s*stop\(\);\s*return;/);
  });

  it('C5 · otomatik tur ADIMDAN geçer, doğrudan çağrılmaz', () => {
    /* Kör guard koruması: `setInterval` içinde doğrudan `runCarosLabRefreshAll`
       kalırsa tavan hiçbir şeyi kısmıyor demektir. */
    const code = codeOnly(LAB_BAR);
    const i = code.indexOf('setInterval(');   // TİP değil, ÇAĞRI
    expect(i, 'otomatik tur zamanlayıcısı kayboldu — kilit körleşti').toBeGreaterThan(-1);
    const iv = code.slice(i, i + 160);
    expect(iv).toMatch(/stepCarosLabAutoRefresh/);
    expect(iv).not.toMatch(/runCarosLabRefreshAll/);
  });

  it('C6 · ELLE YENİLE tavandan ETKİLENMEZ (kullanıcı niyeti kısılmaz)', () => {
    const code = codeOnly(LAB_BAR);
    const manual = code.slice(code.indexOf('const manual'), code.indexOf('const manual') + 160);
    expect(manual).toMatch(/runCarosLabRefreshAll/);
    expect(manual).not.toMatch(/stepCarosLabAutoRefresh|ceilingFor/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) LAB ÖRNEKLEME KANITI
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F7/D · örnekleme kanıtı salt-okunur', () => {
  it('D1 · kanıt okuması sayaçları SIFIRLAMAZ', () => {
    const a = getLabSamplingEvidence();
    const b = getLabSamplingEvidence();
    expect(b.ticks).toBe(a.ticks);
    expect(b.ran).toBe(a.ran);
    expect(b.skipped).toBe(a.skipped);
  });

  it('D2 · adım, tavanla TUTARLI bir stride bildirir', () => {
    const ev = getLabSamplingEvidence();
    if (ev.ceiling === null) { expect(ev.stride).toBeNull(); return; }
    expect(ev.stride).toBe(labSamplingStride(ev.ceiling));
  });

  it('D3 · LAB runtime kendi zamanlayıcısını KURMAZ (sahibi ekran)', () => {
    /* Periyodik tetiğin sahibi bileşendir; runtime timer kurarsa LAB
       kapandığında iş DEVAM ederdi → labClosedBehavior ihlali. */
    const code = codeOnly(LAB_RUNTIME);
    expect(code).not.toMatch(/\bsetInterval\s*\(/);
    expect(code).not.toMatch(/scheduleTask\s*\(/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   E) MAVI — ölçüldü, doğruluğu BOZULMADI
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F7/E · Mavi bağlam doğruluğu korundu', () => {
  it('E1 · bağlam bütçesi DEĞİŞTİRİLMEDİ', () => {
    /* Performans uğruna bütçe kısmak, Mavi'nin cevabını sessizce
       kötüleştirirdi. F7 yalnız ÖLÇER. */
    expect(DEFAULT_CONTEXT_BUDGET.maxChars).toBe(700);
    expect(DEFAULT_CONTEXT_BUDGET.maxFields).toBe(10);
    expect(DEFAULT_CONTEXT_BUDGET.maxDtcCodes).toBe(5);
    expect(DEFAULT_CONTEXT_BUDGET.maxSources).toBe(3);
  });

  it('E2 · serializer SAF kalır — sayaç/tavan/saat girmedi', () => {
    const code = codeOnly(SERIALIZER);
    expect(code).not.toMatch(/bumpPerf/);
    expect(code).not.toMatch(/ceilingFor|workloadCeilings/);
    expect(code).not.toMatch(/Date\.now\s*\(/);
  });

  it('E3 · bağlam BASKIYA GÖRE kısılmaz (Mavi truth sahibi değildir)', () => {
    /* Cross-Domain §7: performans truth’u değiştiremez. Baskı altında
       bağlam alanı düşürmek, Mavi’ye YANLIŞ araç durumu göstermek olurdu. */
    const code = codeOnly(MAVI_CHAT);
    expect(code).not.toMatch(/ceilingFor/);
    expect(code).not.toMatch(/getWorkloadCeilings/);
    expect(code).not.toMatch(/getThermalLevel|getMemoryTrimEvidence/);
  });

  it('E4 · ölçüm sohbeti DÜŞÜREMEZ (try/catch zorunlu)', () => {
    const code = codeOnly(MAVI_CHAT);
    /* İlk `bumpPerf` IMPORT satırıdır; aranan şey `record()` içindeki ÇAĞRIdır. */
    const call = code.indexOf('bumpPerf(');
    expect(call, 'Mavi ölçüm çağrısı kayboldu — kilit körleşti').toBeGreaterThan(-1);
    const before = code.slice(Math.max(0, call - 260), call);
    expect(before).toMatch(/try\s*\{/);
    /* Ve yakalama boş olmalı: ölçüm hatası sohbeti düşürmemeli. */
    const after = code.slice(call, call + 900);
    expect(after).toMatch(/catch\s*\{/);
  });

  it('E5 · sayaç adları PII taşımaz (alan adı/değeri/metin YOK)', () => {
    const snap = getPerformanceDiagnosticsSnapshot();
    const sec = snap.sections.find((s) => s.sectionId === 'mavi_context');
    expect(sec, 'mavi_context bölümü kayıp').toBeDefined();
    const blob = JSON.stringify(sec);
    expect(blob).not.toMatch(/[A-HJ-NPR-Z0-9]{17}/);          // VIN
    expect(blob).not.toMatch(/\b\d{1,3}\.\d{5,}\b/);          // koordinat
    expect(blob).not.toMatch(/apiKey|token|Bearer|transcript/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   F) MEDIA — playback truth / focus / authority’ye DOKUNULMADI
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F7/F · Media authority dokunulmadı', () => {
  it('F1 · playbackTruth performans tavanı OKUMAZ', () => {
    /* Cross-Domain §7: dropped → success, stale → current YAPILAMAZ.
       Playback truth’un baskıya göre değişmesi tam olarak bu olurdu. */
    const code = codeOnly(PLAYBACK_TRUTH);
    expect(code).not.toMatch(/ceilingFor|workloadCeilings/);
    expect(code).not.toMatch(/getThermalLevel|getMemoryTrimEvidence/);
  });

  it('F2 · media komut kapısı tavana bağlanmadı', () => {
    const code = codeOnly(MEDIA_GATEWAY);
    expect(code).not.toMatch(/ceilingFor|workloadCeilings/);
  });

  it('F3 · artworkQuality bilinçle BAĞLANMADI ve gerekçesi yazılı', () => {
    const row = ceilingOwnership().find((r) => r.workload === 'artworkQuality');
    expect(row?.enforcer).toBe('DELIBERATELY_UNBOUND');
    expect(row?.rationale).toMatch(/KANITLA|kanıt/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   G) PHONE LINK — control-plane authority ve güvenlik semantiği korundu
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F7/G · Phone Link sınırı korundu', () => {
  it('G1 · oturum yöneticisi performans tavanı OKUMAZ', () => {
    /* Cross-Domain §11: data plane control-plane authority üretmez;
       performans da control-plane kararını değiştiremez. */
    const code = codeOnly(COMPANION_SESSION);
    expect(code).not.toMatch(/ceilingFor|workloadCeilings/);
    expect(code).not.toMatch(/getThermalLevel|getMemoryTrimEvidence/);
  });

  it('G2 · ARCH-05 yetenek kapısı YERİNDE (performans uğruna gevşetilmedi)', () => {
    /* Hata KODU string literalidir → ham kaynakta; kapı FONKSİYONU koddadır. */
    expect(COMPANION_SESSION).toMatch(/CAPABILITY_NOT_GRANTED/);
    expect(codeOnly(COMPANION_SESSION)).toMatch(/controlCapabilityOf/);
  });

  it('G3 · kalp atışı/telemetri baskıya göre atlanmaz', () => {
    const code = codeOnly(COMPANION_SESSION);
    expect(code).not.toMatch(/stride|autoRefreshSkipped/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   H) LAB YÜZEYİ — salt-okunur, ekran enflasyonu yok
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F7/H · LAB kanıtı', () => {
  it('H1 · yeni bölümler mevcut profiler’a eklendi (yeni EKRAN yok)', () => {
    const snap = getPerformanceDiagnosticsSnapshot();
    const ids = snap.sections.map((s) => s.sectionId);
    expect(ids).toContain('lab_sampling');
    expect(ids).toContain('mavi_context');
    expect(ids).toContain('workload_ceilings');
  });

  it('H2 · sekiz kategorinin UYGULAYICISI LAB’da görünür', () => {
    const snap = getPerformanceDiagnosticsSnapshot();
    const sec = snap.sections.find((s) => s.sectionId === 'workload_ceilings')!;
    const names = sec.metrics.map((m) => m.name);
    for (const id of workloadOrder()) expect(names).toContain(`ceiling.enforcer.${id}`);
    expect(names).toContain('ceiling.boundWorkloads');
  });

  it('H3 · lab_sampling LAB KAPALI sözleşmesini yayınlar', () => {
    const snap = getPerformanceDiagnosticsSnapshot();
    const sec = snap.sections.find((s) => s.sectionId === 'lab_sampling')!;
    expect(JSON.stringify(sec.notes)).toMatch(/ELLE YEN[İI]LE/);
    expect(JSON.stringify(sec.notes)).toMatch(/NONE/);
  });

  it('H4 · LAB kendi hükmünü üretmez (sağlıklı/regresyon demez)', () => {
    const snap = getPerformanceDiagnosticsSnapshot();
    for (const id of ['lab_sampling', 'mavi_context']) {
      const sec = snap.sections.find((s) => s.sectionId === id)!;
      expect(JSON.stringify(sec.notes)).not.toMatch(/sa[ğg]l[ıi]kl[ıi]|healthy|regresyon/i);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   I) CROSS-DOMAIN — yeni otorite/zamanlayıcı kurulmadı
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F7/I · Cross-Domain §1 · §8 · §15', () => {
  it('I1 · L7 hâlâ SAF — yazma/zamanlayıcı yok', () => {
    const code = codeOnly(CEILINGS);
    expect(code).not.toMatch(/\bsetInterval\s*\(/);
    expect(code).not.toMatch(/scheduleTask\s*\(/);
    expect(code).not.toMatch(/setMode\s*\(|setPowerCeiling\s*\(/);
  });

  it('I2 · F7 yeni GLOBAL performans yöneticisi eklemedi', () => {
    /* §15: yeni global scheduler / performance manager / truth manager
       yasak. LAB adımı MEVCUT tik üzerinde çalışır. */
    const code = codeOnly(LAB_RUNTIME);
    expect(code).toMatch(/stepCarosLabAutoRefresh/);
    expect(code).not.toMatch(/requestAnimationFrame|setInterval/);
  });

  it('I3 · tavan okuması fail-soft — LAB tavan okunamazsa ÇALIŞMAYA devam eder', () => {
    const code = codeOnly(LAB_RUNTIME);
    const fn = code.slice(code.indexOf('export function stepCarosLabAutoRefresh'));
    expect(fn.slice(0, 500)).toMatch(/catch\s*\{[\s\S]{0,80}stride\s*=\s*1/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   J) CROSS-DOMAIN REVIEW BULGULARI — bağımlılık yönü ve tek kaynak
   ═══════════════════════════════════════════════════════════════════════════
   Bu iki kilit ARCH-06 cross-domain denetiminde bulunan P1 çakışmalardan
   doğdu. İkisi de F7'nin KENDİ değişikliğindeydi.                          */

describe('ARCH-06/REVIEW/J · bağımlılık yönü ve çift-kaynak yasağı', () => {
  it('J1 · `perf/` katmanı `devtools/`ten IMPORT ETMEZ (yön: LAB → perf)', () => {
    /* BULGU (P1): `performanceAggregator` LAB runtime'ını import ediyordu.
       Bu, LAB prob grafiğini (gpsService · navigationService · pollCost …)
       perf katmanına bağlar ve LAB kodunun bir üretim import yoluna
       sızmasını mümkün kılar. Yön DAİMA domain/LAB → perf olmalıdır. */
    const dir = 'src/platform/perf';
    const offenders: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts')) continue;
      const src = readFileSync(`${dir}/${f}`, 'utf8');
      if (/from\s+'[^']*devtools\//.test(src)) offenders.push(f);
    }
    expect(offenders, `perf/ → devtools/ bağımlılığı: ${offenders.join(', ')}`)
      .toEqual([]);
  });

  it('J2 · `perfCounters` SIFIR-IMPORT yaprak modüldür (döngü kırıcı)', () => {
    /* Sayaç modülü hiçbir şey import etmediği sürece, onu import eden her
       domain için döngü YAPISAL OLARAK imkânsızdır. */
    const src = readFileSync('src/platform/perf/perfCounters.ts', 'utf8');
    expect(src.match(/^import\s/gm)).toBeNull();
  });

  it('J3 · LAB örnekleme sayacı TEK KAYNAKTA tutulur', () => {
    /* BULGU (P1): aynı olgu hem modül-yerel değişkende hem `perfCounters`ta
       sayılıyordu → ikisi ayrışabilirdi (§19/6 "second truth system"). */
    const src = codeOnly(LAB_RUNTIME);
    expect(src).not.toMatch(/let\s+_auto(Ticks|Ran|Skipped)/);
    const ev = getLabSamplingEvidence();
    const c = getPerfCounters();
    expect(ev.ran).toBe(c['lab.autoRefreshRan']);
    expect(ev.skipped).toBe(c['lab.autoRefreshSkipped']);
    expect(ev.ticks).toBe(ev.ran + ev.skipped);
  });

  it('J4 · aggregator’ın LAB KAPALI iddiası sözleşmeyle AYNI (drift yasağı)', () => {
    /* Metin iki yerde duruyor; ayrışırsa LAB yalan söyler. */
    const snap = getPerformanceDiagnosticsSnapshot();
    const sec = snap.sections.find((s) => s.sectionId === 'lab_sampling')!;
    const notes = JSON.stringify(sec.notes);
    expect(notes).toContain(LAB_CLOSED_BEHAVIOR.autoRefreshTimer);
    expect(notes).toContain(LAB_CLOSED_BEHAVIOR.subscriptions);
    expect(notes).toContain(LAB_CLOSED_BEHAVIOR.probes);
    expect(notes).toContain(LAB_CLOSED_BEHAVIOR.productionEffect);
  });
});

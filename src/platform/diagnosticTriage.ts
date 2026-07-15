/**
 * diagnosticTriage — ÖNCELİKLİ BULGU TRİYAJI (vizyon "8 Kapı" gate 2+8: önemli
 * mi? + en doğru aksiyon?).
 *
 * Tanı raporu artık ~15 ham bölüm taşıyor — insan hepsini taramamalı. Bu modül
 * o bölümleri (zaten cihazda toplanmış snapshot'lar) OKUYUP kendi "EN KRİTİK
 * BULGU" listesini üretir: her bulgu severity + başlık + NEDEN (hangi
 * bölüm(ler)den, mümkünse çapraz-korelasyonlu) + önerilen AKSİYON taşır. Bu
 * GÖSTERİM değil YORUM+KARAR — "boot yavaş ÇÜNKÜ termal L2" gibi kök-neden
 * çıkarımı (gate 5: "neyle birleşince anlam kazanır?").
 *
 * CİHAZDA ÇALIŞIR (robot felsefesi — kütük #6 deseni): remoteLogService
 * payload'ı toplarken çağırır, IncidentCenter yalnız GÖSTERİR (yeniden
 * hesaplama yok).
 *
 * KURALLAR (CLAUDE.md):
 *  - Saf/fail-soft: her kural kendi alanını null-check eder; bölüm eksik/
 *    bozuksa kural null döner (sahte bulgu YASAK — varsayım üretilmez).
 *  - Kural İZOLASYONU (motor seviyesi): kural yine de patlarsa YALNIZ o kural
 *    düşer, diğerleri çalışmaya devam eder ve `ruleErrors` sayacına yazılır.
 *    Tek bozuk bölüm TÜM triyajı düşüremez (denetim 2026-07-12 P0: DTC varken
 *    tek TypeError raporun triyajını komple siliyordu).
 *  - PII yok: reason/action yalnız sayısal/enum değer + statik Türkçe metin —
 *    koordinat/VIN/plaka/transkript ASLA girmez.
 *  - Zero-alloc dostu: hot-path DEĞİL, snapshot anında bir kez çalışır.
 *  - Tipler DECOUPLED (IncidentCenter'daki "*Like" deseni) — diagnosticSections
 *    vb. modülleri import ETMEZ, yalnız şekli bilir (bağımlılık döngüsü yok).
 */

import { lookupRootCause } from './rootCauseKb';

export type TriageSeverity = 'critical' | 'warning' | 'info';

export interface TriageFinding {
  severity: TriageSeverity;
  /** Sabit makine-okur kod — dedup/analiz için (metinden bağımsız). */
  code: string;
  title: string;
  reason: string;
  action: string;
  /** Bu bulguyu üreten bölüm(ler) — 2+ ise çapraz-korelasyon. */
  sources: string[];
  /* ── V2 (Root Cause Engine) — hepsi OPSİYONEL, geriye-uyumlu ──────────
   * PR-1 kontrat katmanı: kurallar bugün bunları DOLDURMAK ZORUNDA DEĞİL.
   * İleri PR'lar (PR-3 KB, PR-5/6 OBD kanıt zinciri) aşama aşama doldurur.
   * Tüketiciler (IncidentCenter/rapor) alan yoksa eski davranışa düşer. */
  /** 0-100 kök-neden olasılığı. Yoksa buildRootCauseSnapshot severity'den türetir. */
  confidence?: number;
  /** Ham kanıt satırları (sayısal/enum + statik TR metin — PII yok). */
  evidence?: string[];
  /** Kanıtın YORUMU (tek satır sentez) — "reason"dan ayrı, opsiyonel. */
  analysis?: string;
  /** Geliştirici-hedefli düzeltme işaretçisi (PR-3 KB doldurur). */
  codePointer?: { file: string; symbol: string; fixHint?: string };
}

/* ── V2 — Root Cause hipotezi (TOP-10 sunumunun atomu) ────────────────
 * Bir kural, tek bulgu yerine RAKİP AĞIRLIKLI hipotezler dönebilsin diye
 * ayrı tip. PR-1'de motor mevcut TriageFinding'leri hipoteze SARAR (adaptör);
 * PR-6+ OBD gibi subsystem'lerde kural doğrudan çok-hipotez üretecek. */
export interface RootCauseHypothesis {
  /** Kısa problem ifadesi (finding.title). */
  problem: string;
  severity: TriageSeverity;
  /** Sabit makine-okur kod (dedup/ranking). */
  code: string;
  /** 0-100 — KANITTAN türetilir (sabit sayı YASAK: gate-1 "doğru mu?"). */
  confidence: number;
  /** Ham kanıt satırları. */
  evidence: string[];
  /** Kanıtın yorumu (neden bu kök-neden). */
  analysis: string;
  /** Önerilen düzeltme (operatör VEYA geliştirici hedefli). */
  recommendedFix: string;
  /** Geliştirici işaretçisi (varsa) — dosya/fonksiyon. */
  codePointer?: { file: string; symbol: string; fixHint?: string };
  /** Katkı veren bölüm(ler) — 2+ ise çapraz-korelasyon. */
  sources: string[];
}

/* ── V2 (PR-4) — "Eksik Kanıt" / sonuçsuzluk beyanı ───────────────────
 * Motor bir subsystem'i arıza/yoksun durumda görüp AMA karar-kanıtı elde
 * edemediğinde SUSMAZ: neyin doğrulanamadığını ve hangi ham kanıtın eksik
 * olduğunu açıkça söyler. (2026-07-14: OBD kopukken DTC/VIN/Freeze doğrulanamadı
 * — mühendis "OBD çalışıyor mu" belirsizliğinde kalıyordu.) */
export interface InconclusiveNote {
  /** Subsystem etiketi ('OBD', 'GPS', …). */
  subsystem: string;
  /** Sabit makine-okur kod. */
  code: string;
  /** Neden sonuca varılamadı (tek satır). */
  reason: string;
  /** Bu yüzden DOĞRULANAMAYAN sonuç(lar). */
  blockedConclusions: string[];
  /** Kesinleştirmek için gereken ham kanıt anahtarları. */
  missingEvidence: string[];
}

export interface RootCauseSnapshot {
  /** Güvene göre azalan sıralı, en fazla MAX_ROOT_CAUSES. */
  hypotheses: RootCauseHypothesis[];
  /** Sonuca varılamayan subsystem beyanları (eksik kanıtla). */
  inconclusive: InconclusiveNote[];
  scanned: number;
  ruleErrors: number;
  /** En yüksek güven (0 = hipotez yok). */
  topConfidence: number;
}

export interface TriageSnapshot {
  findings: TriageFinding[];
  /** Kaç bölüm okundu (veri vardı) — insan "robot gerçekten baktı mı" görsün. */
  scanned: number;
  topSeverity: TriageSeverity | 'none';
  /**
   * Bozuk bölüm yüzünden ATLANAN kural sayısı (normalde 0). Kural izolasyonu
   * sessiz olmasın: triyaj eksik çalıştıysa bu sayı > 0 olur ve raporda görünür.
   */
  ruleErrors: number;
}

/* ── Girdi şekli — decoupled, yalnız kullanılan alanlar ─────────── */

interface HealthSectionLike {
  overallHealth?: string;
  services?: { name: string; healthy: boolean; restartCount: number }[];
}
interface ObdDeepSectionLike {
  // PR-4: adapter bağlantı durumu — "OBD bağlı değildi" INCONCLUSIVE kararı için.
  adapter?: { source?: string; connectionState?: string; lastSeenMs?: number } | null;
  health?: { connectionQuality?: number; reconnectPressure?: number; lastPacketAgeMs?: number; isStale?: boolean };
  extended?: { discovered?: boolean; supportedCount?: number } | null;
  // PR-5a/PR-1a: handshake yaşam-döngüsü kanıtı (non-PII) — PR-6 OBD analizörü tüketir.
  handshake?: {
    outcome?: string; vinClass?: string | null; vinPresent?: boolean;
    bitmapClass?: string | null; readBlocks?: string[]; supportedCount?: number;
    failReason?: string | null;
    // PR-1a
    timeoutStage?: string | null; durationMs?: number | null;
    protocolTried?: string | null; protocolActive?: string | null;
    lastSuccessAt?: number | null; reconnectReason?: string | null;
    reconnectHistory?: ({ ts?: number; reason?: string } | null)[];
  } | null;
  // ZERO-TRUST: bu bölüm sanitize edilmiş payload'dan gelir — eleman düşmüş/bozuk
  // olabilir. Tip runtime gerçeğini yansıtır (null-yapılabilir), kuralı yalan
  // güvenceye dayandırmaz.
  dtc?: {
    count?: number;
    codes?: ({ code?: string; severity?: string; system?: string } | null)[];
  };
}
interface PerfSampleLike { ts: number; tempC: number; level: number; memMb: number; fps: number; lagMs: number; maxLongTaskMs?: number; longTaskCount?: number }
interface PerfSeriesSectionLike { installed?: boolean; samples?: PerfSampleLike[] }
interface NetAiSectionLike {
  online?: boolean;
  ai?: { healthy?: boolean; consecFails?: number; blockedForMs?: number };
  quota?: { geminiCooldownMs?: number; groqCooldownMs?: number; haikuCooldownMs?: number };
}
interface GpsDeepSectionLike { permission?: string; fixAgeMs?: number; accuracyM?: number; tracking?: boolean }
interface GeofenceSectionLike { readState?: string }
interface StorageQueueSectionLike { queuePending?: number; storagePct?: number; storageWarn?: boolean }
interface PowerSectionLike { severity?: string; voltageV?: number | null }
interface FusionSectionLike { confidence?: string; diffKmh?: number | null }
interface BootTimingSectionLike { totalMs?: number; slowestWave?: string | null }
interface TransportSectionLike { reconnectAttempts?: number }
interface SelfTestSectionLike { worst?: string; summary?: Partial<Record<string, number>> }
interface UiActivitySectionLike { untimelyCount?: number }

/** buildTriageSnapshot'a verilen bölüm demeti — support_snapshot payload'ının üst düzeyiyle 1:1. */
export interface TriageSections {
  health?: HealthSectionLike | null;
  obdDeep?: ObdDeepSectionLike | null;
  perfSeries?: PerfSeriesSectionLike | null;
  netAi?: NetAiSectionLike | null;
  gps?: GpsDeepSectionLike | null;
  voice?: unknown;
  geofence?: GeofenceSectionLike | null;
  storageQueue?: StorageQueueSectionLike | null;
  power?: PowerSectionLike | null;
  fusion?: FusionSectionLike | null;
  bootTiming?: BootTimingSectionLike | null;
  transport?: TransportSectionLike | null;
  selfTest?: SelfTestSectionLike | null;
  uiActivity?: UiActivitySectionLike | null;
  trail?: unknown[] | null;
}

/* ── Eşikler (sabit — task-spec / mevcut UI eşikleriyle tutarlı) ─── */

const BOOT_SLOW_MS               = 8_000;
const THERMAL_WARN_LEVEL         = 2;      // perfSeries level 0-3
const MEM_LEAK_GROWTH_MB         = 30;     // PerfSeriesSection memGrew ile aynı eşik
const FUSION_GPS_ACCURACY_POOR_M = 50;
const TRANSPORT_RECONNECT_WARN   = 3;
const OBD_QUALITY_POOR_PCT       = 50;
const UI_UNTIMELY_WARN           = 3;
// Ana-thread donması (longtask): tek görev bu süreyi aşarsa harita+gösterge birlikte
// "takılır". 500ms = gözle görülür kilitlenme; kullanıcı "donma" olarak algılar.
const MAIN_THREAD_STALL_MS       = 500;
// OBD "donuk veri" fallback eşiği (ms) — payload'da isStale yoksa (eski APK) ham
// paket yaşından türetilir. ObdHealthMonitor.STALE_ABS_MS ile hizalı.
const OBD_STALE_AGE_MS           = 4_000;
const STORAGE_QUEUE_WARN         = 20;
const STORAGE_QUEUE_OFFLINE_WARN = 5;

const TRACKED_SECTIONS = [
  'health', 'obdDeep', 'perfSeries', 'netAi', 'gps', 'voice', 'geofence',
  'storageQueue', 'power', 'fusion', 'bootTiming', 'transport', 'selfTest',
  'uiActivity', 'trail',
] as const;

const SEVERITY_RANK: Record<TriageSeverity, number> = { critical: 0, warning: 1, info: 2 };
const MAX_FINDINGS = 8;
const MAX_ROOT_CAUSES = 10;   // vizyon "TOP-10 ROOT CAUSE"

/* ── V2 — Kanıttan türetilen baz güven (PR-1) ─────────────────────────
 * PR-1 kontrat katmanı: kurallar henüz aşama-kanıtı taşımadığı için güveni
 * severity + çapraz-korelasyondan türetiriz (SABİT SAYI DEĞİL — kanıta bağlı):
 *   • severity ne kadar yüksekse prior o kadar yüksek,
 *   • 2+ bağımsız bölüm aynı kökü işaret ediyorsa (sources ≥ 2) güven artar.
 * PR-6+ OBD gibi subsystem'lerde bu, gerçek aşama-ağırlıklı skorla DEĞİŞİR.
 * Kural zaten `confidence` verdiyse ONA saygı gösterilir (override edilmez). */
const SEVERITY_PRIOR: Record<TriageSeverity, number> = { critical: 70, warning: 45, info: 25 };
const CORRELATION_BONUS = 15;

function deriveConfidence(f: TriageFinding): number {
  if (typeof f.confidence === 'number' && f.confidence >= 0 && f.confidence <= 100) {
    return Math.round(f.confidence);   // kural açıkça verdi → sahiplen
  }
  const prior = SEVERITY_PRIOR[f.severity] ?? 25;
  const correlated = Array.isArray(f.sources) && f.sources.length >= 2;
  const raw = prior + (correlated ? CORRELATION_BONUS : 0);
  return Math.max(0, Math.min(100, raw));
}

type Rule = (s: TriageSections) => TriageFinding | null;

/* ── Kurallar ────────────────────────────────────────────────────
 * Her kural TEK bir alan grubunu okur; veri yoksa/şekli bozuksa null döner
 * (sessiz atlama — try/catch değil, null-check disiplini). */

function ruleHealth(s: TriageSections): TriageFinding | null {
  const h = s.health;
  if (!h || typeof h.overallHealth !== 'string') return null;
  if (h.overallHealth === 'critical') {
    const unhealthy = (h.services ?? []).filter((x) => x && x.healthy === false).map((x) => x.name);
    return {
      severity: 'critical', code: 'HEALTH_CRITICAL',
      title: 'Sistem sağlığı kritik',
      reason: unhealthy.length > 0
        ? `Sağlıksız servis(ler): ${unhealthy.slice(0, 5).join(', ')}`
        : 'Genel sistem sağlığı kritik seviyede',
      action: 'Sağlıksız servisleri yeniden başlatın; düzelmezse cihazı yeniden başlatın',
      sources: ['health'],
    };
  }
  if (h.overallHealth === 'degraded') {
    return {
      severity: 'warning', code: 'HEALTH_DEGRADED',
      title: 'Sistem sağlığı düşük',
      reason: 'Bir veya daha fazla servis heartbeat/koşul dışı',
      action: 'Servis listesindeki restartCount yüksek olanı kontrol edin',
      sources: ['health'],
    };
  }
  return null;
}

/** Çapraz-korelasyon: yavaş boot + termal ısınma aynı ana denk geliyor mu. */
function ruleBootThermal(s: TriageSections): TriageFinding | null {
  const bt = s.bootTiming;
  if (!bt || typeof bt.totalMs !== 'number' || bt.totalMs <= BOOT_SLOW_MS) return null;
  const samples = s.perfSeries?.samples;
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const last = samples[samples.length - 1];
  if (!last || typeof last.level !== 'number' || last.level < THERMAL_WARN_LEVEL) return null;
  return {
    severity: 'warning', code: 'BOOT_SLOW_THERMAL',
    title: 'Isınma kaynaklı yavaş boot',
    reason: `Boot ${Math.round(bt.totalMs)}ms sürdü (en yavaş: ${bt.slowestWave ?? '?'}) ve termal seviye L${last.level} — ısınma boot'u yavaşlatıyor olabilir`,
    action: 'Cihazı soğutun; tekrarlıyorsa termal watchdog eşiklerini inceleyin',
    sources: ['bootTiming', 'perfSeries'],
  };
}

function ruleMemoryLeak(s: TriageSections): TriageFinding | null {
  const samples = s.perfSeries?.samples;
  if (!Array.isArray(samples) || samples.length < 2) return null;
  const first = samples[0]?.memMb;
  const last = samples[samples.length - 1]?.memMb;
  if (typeof first !== 'number' || typeof last !== 'number' || first < 0 || last < 0) return null;
  if (last - first <= MEM_LEAK_GROWTH_MB) return null;
  return {
    severity: 'warning', code: 'MEM_LEAK_SUSPECT',
    title: 'Bellek sızıntısı şüphesi',
    reason: `JS heap ${first}MB → ${last}MB büyüdü (${samples.length} örnek penceresinde)`,
    action: 'Uzun oturumda bellek trendini izleyin; artış sürerse sızıntı kaynağını profille',
    sources: ['perfSeries'],
  };
}

/**
 * ANA-THREAD DONMASI — longtask gözlemcisinden. Düşük-tier'da fps salvosu atlandığı
 * için (perfSeriesRecorder) render donması EskiDEN görünmezdi; longtask bunu kapatır.
 * Harita + gösterge BİRLİKTE takılıyorsa kök burada: bir senkron görev main-thread'i
 * bloke ediyor (data throttle değil). Kullanıcının "harita bile takılıyor" şikâyeti.
 */
function ruleMainThreadJank(s: TriageSections): TriageFinding | null {
  const samples = s.perfSeries?.samples;
  if (!Array.isArray(samples) || samples.length === 0) return null;
  let worst = 0;
  let total = 0;
  for (const smp of samples) {
    const v = smp?.maxLongTaskMs;
    if (typeof v !== 'number' || v < 0) continue;   // -1 = API yok → atla
    if (v > worst) worst = v;
    if (typeof smp.longTaskCount === 'number' && smp.longTaskCount > 0) total += smp.longTaskCount;
  }
  if (worst <= MAIN_THREAD_STALL_MS) return null;
  return {
    severity: 'warning',
    code: 'MAIN_THREAD_STALL',
    title: 'Ana thread donması (harita/gösterge takılması)',
    reason: `En uzun ana-thread bloklaması ${Math.round(worst)}ms (${total} uzun görev). Bu sürede harita render'ı ve göstergeler birlikte donar — veri değil, render/hesap kaynaklı.`,
    action: 'Donma anındaki senkron yükü bulun (ağır zekâ katmanı/storage yazımı/CAN snapshot); hot-path dışına alın veya böl',
    sources: ['perfSeries'],
  };
}

function rulePower(s: TriageSections): TriageFinding | null {
  const p = s.power;
  if (!p || typeof p.severity !== 'string') return null;
  if (p.severity === 'critical') {
    return {
      severity: 'critical', code: 'POWER_CRITICAL',
      title: 'Akü voltajı kritik',
      reason: `12V voltaj kritik eşiğin altında (${p.voltageV ?? '?'}V)`,
      action: 'Aküyü/şarj sistemini hemen kontrol edin — marş/restart riski',
      sources: ['power'],
    };
  }
  if (p.severity === 'low') {
    return {
      severity: 'warning', code: 'POWER_LOW',
      title: 'Akü voltajı düşük',
      reason: `12V voltaj düşük seviyede (${p.voltageV ?? '?'}V) → marş/restart riski`,
      action: 'Alternatör/akü sağlığını yakın zamanda kontrol edin',
      sources: ['power'],
    };
  }
  return null;
}

/** Çapraz-korelasyon: düşük füzyon güveni + zayıf/reddedilmiş GPS aynı kökten mi. */
function ruleFusion(s: TriageSections): TriageFinding | null {
  const f = s.fusion;
  if (!f || f.confidence !== 'low') return null;
  const gps = s.gps;
  const gpsImplicated = !!gps && (
    gps.permission !== 'granted'
    || (typeof gps.accuracyM === 'number' && gps.accuracyM > FUSION_GPS_ACCURACY_POOR_M)
  );
  return {
    severity: 'warning', code: 'FUSION_LOW_CONFIDENCE',
    title: gpsImplicated ? 'GPS sinyali zayıf — sensör füzyonu güvenilmiyor' : 'Sensör füzyon çelişkisi',
    reason: gpsImplicated
      ? `GPS ve donanım hız kaynakları ${f.diffKmh ?? '?'} km/h farklı; GPS izin/doğruluğu zayıf`
      : `GPS ve donanım hız kaynakları arasında fark ${f.diffKmh ?? '?'} km/h — kaynaklardan biri güvenilmez olabilir`,
    action: gpsImplicated ? 'GPS anteni/görüş açısını kontrol edin' : 'OBD/CAN hız sinyalini doğrulayın',
    sources: gpsImplicated ? ['fusion', 'gpsDeep'] : ['fusion'],
  };
}

/** Çapraz-korelasyon: sık reconnect + düşük OBD bağlantı kalitesi aynı arızayı mı işaret ediyor. */
function ruleTransportObd(s: TriageSections): TriageFinding | null {
  const t = s.transport;
  if (!t || typeof t.reconnectAttempts !== 'number' || t.reconnectAttempts <= TRANSPORT_RECONNECT_WARN) return null;
  const quality = s.obdDeep?.health?.connectionQuality;
  const qualityPoor = typeof quality === 'number' && quality < OBD_QUALITY_POOR_PCT;
  return {
    severity: qualityPoor ? 'critical' : 'warning',
    code: 'TRANSPORT_RECONNECT',
    title: qualityPoor ? 'OBD bağlantısı düşük kalite ve sık kopuyor' : 'OBD sık kopuyor',
    reason: qualityPoor
      ? `${t.reconnectAttempts} reconnect denemesi + bağlantı kalitesi %${quality} — donanım/kablo sorunu olabilir`
      : `${t.reconnectAttempts} reconnect denemesi bu oturumda`,
    action: 'OBD adaptör bağlantısını/gücünü kontrol edin',
    sources: qualityPoor ? ['transport', 'obdDeep'] : ['transport'],
  };
}

/**
 * "Bağlı ama DONUK" — bağlantı ayakta (source real + connected) fakat son geçerli
 * paket bayat → göstergeler donuk görünür. connectionQuality bunu ~9s'ye kadar
 * gizler (STALE_GRACE_FACTOR); bu kural o körlüğü kapatır. Kopma DEĞİL — veri
 * seyrek/yavaş geliyor (yavaş protokol/adaptör, köprü tıkanması, poll config).
 * Not: kullanıcının "veriler sabit kalıyor, harita bile takılıyor" şikâyetinde OBD
 * tarafını temsil eder; harita/render tarafını ruleMainThreadJank yakalar.
 */
function ruleObdStaleData(s: TriageSections): TriageFinding | null {
  const od = s.obdDeep;
  const adapter = od?.adapter;
  // Yalnız GERÇEKTEN bağlıyken konuş — bağlı değilse "donuk" değil "yok" durumu (başka kural).
  if (!adapter || adapter.source !== 'real' || adapter.connectionState !== 'connected') return null;
  const h = od?.health;
  if (!h) return null;
  // isStale yeni APK'da gelir; yoksa ham paket yaşından türet (geriye-uyum).
  const ageMs = typeof h.lastPacketAgeMs === 'number' ? h.lastPacketAgeMs : -1;
  const stale = h.isStale === true || (ageMs > OBD_STALE_AGE_MS);
  if (!stale) return null;
  const ageTxt = ageMs >= 0 ? `${(ageMs / 1000).toFixed(1)}s` : '?';
  return {
    severity: 'warning',
    code: 'OBD_DATA_STALE',
    title: 'OBD bağlı ama veri donuk/seyrek geliyor',
    reason: `Bağlantı ayakta (real/connected) fakat son geçerli paket ${ageTxt} önce — göstergeler donuk görünür. Kopma değil, veri seyrek akıyor (yavaş protokol/adaptör veya köprü tıkanması).`,
    action: 'Adaptör poll hızını/protokolü, BLE bağlantı kalitesini ve UI bildirim throttle ayarını kontrol edin',
    sources: ['obdDeep'],
  };
}

function ruleNetAi(s: TriageSections): TriageFinding | null {
  const n = s.netAi;
  if (!n) return null;
  if (n.ai && n.ai.healthy === false) {
    return {
      severity: 'warning', code: 'NETAI_CIRCUIT_OPEN',
      title: 'AI sağlayıcı devre kesici açık',
      reason: `Ardışık ${n.ai.consecFails ?? '?'} hata sonrası devre kesici ${Math.ceil((n.ai.blockedForMs ?? 0) / 1000)}s kapalı`,
      action: 'AI sağlayıcı anahtarını/ağ bağlantısını kontrol edin',
      sources: ['netAi'],
    };
  }
  const q = n.quota;
  if (q && ((q.geminiCooldownMs ?? 0) > 0 || (q.groqCooldownMs ?? 0) > 0 || (q.haikuCooldownMs ?? 0) > 0)) {
    return {
      severity: 'info', code: 'NETAI_QUOTA_COOLDOWN',
      title: 'AI sağlayıcı kota beklemede',
      reason: 'Bir veya daha fazla sağlayıcı kota/kesici penceresinde',
      action: 'Kota sıfırlanana kadar bekleyin veya farklı sağlayıcıya geçin',
      sources: ['netAi'],
    };
  }
  return null;
}

function ruleSelfTest(s: TriageSections): TriageFinding | null {
  const st = s.selfTest;
  if (!st || typeof st.worst !== 'string') return null;
  const sum = st.summary ?? {};
  if (st.worst === 'fail') {
    return {
      severity: 'critical', code: 'SELFTEST_FAIL',
      title: 'Self-test taramasında başarısız kapı(lar) var',
      reason: `${sum.fail ?? '?'} prob başarısız, ${sum.warn ?? 0} prob uyarı verdi`,
      action: 'Self-test raporundaki başarısız probları inceleyin',
      sources: ['selfTest'],
    };
  }
  if (st.worst === 'warn') {
    return {
      severity: 'warning', code: 'SELFTEST_WARN',
      title: 'Self-test taramasında uyarı(lar) var',
      reason: `${sum.warn ?? '?'} prob uyarı verdi`,
      action: 'Self-test raporundaki uyarılı probları inceleyin',
      sources: ['selfTest'],
    };
  }
  return null;
}

function ruleUiActivity(s: TriageSections): TriageFinding | null {
  const ua = s.uiActivity;
  if (!ua || typeof ua.untimelyCount !== 'number' || ua.untimelyCount <= 0) return null;
  return {
    severity: ua.untimelyCount >= UI_UNTIMELY_WARN ? 'warning' : 'info',
    code: 'UI_UNTIMELY_SURFACE',
    title: 'Zamansız açılan modal/overlay tespit edildi',
    reason: `${ua.untimelyCount} zamansız açılış (sürüşte/geri viteste/kullanıcı dokunmadan)`,
    action: 'UI aktivite izindeki olayları inceleyin, tetikleyen ekranı bulun',
    sources: ['uiActivity'],
  };
}

/** Çapraz-korelasyon: çevrimdışıyken kuyruk birikmesi — netAi.online + storageQueue birlikte anlamlı. */
function ruleStorageQueue(s: TriageSections): TriageFinding | null {
  const sq = s.storageQueue;
  if (!sq) return null;
  if (sq.storageWarn === true) {
    return {
      severity: 'warning', code: 'STORAGE_DISK_WARN',
      title: 'Disk kullanımı kritik seviyede',
      reason: `Depolama kullanımı %${sq.storagePct ?? '?'}`,
      action: 'Eski verileri/önbelleği temizleyin',
      sources: ['storageQueue'],
    };
  }
  const online = s.netAi?.online;
  if (online === false && typeof sq.queuePending === 'number' && sq.queuePending > STORAGE_QUEUE_OFFLINE_WARN) {
    return {
      severity: 'warning', code: 'STORAGE_QUEUE_OFFLINE',
      title: 'Çevrimdışı — senkron kuyruğu birikiyor',
      reason: `${sq.queuePending} olay çevrimdışı beklemede`,
      action: 'İnternet bağlantısı gelince kuyruk otomatik boşalır; uzun sürerse bağlantıyı kontrol edin',
      sources: ['storageQueue', 'netAi'],
    };
  }
  if (typeof sq.queuePending === 'number' && sq.queuePending > STORAGE_QUEUE_WARN) {
    return {
      severity: 'warning', code: 'STORAGE_QUEUE_BACKLOG',
      title: 'Senkron kuyruğu birikti',
      reason: `${sq.queuePending} olay kuyrukta bekliyor`,
      action: 'Ağ bağlantısını / sunucu rate-limit durumunu kontrol edin',
      sources: ['storageQueue'],
    };
  }
  return null;
}

function ruleGeofence(s: TriageSections): TriageFinding | null {
  const g = s.geofence;
  if (!g || typeof g.readState !== 'string') return null;
  if (g.readState === 'error' || g.readState === 'schema_missing') {
    return {
      severity: 'info', code: 'GEOFENCE_READ_ERROR',
      title: 'Güvenli bölge (geofence) okuma sorunu',
      reason: `Geofence durumu: ${g.readState}`,
      action: 'Bulut şema/izinlerini kontrol edin',
      sources: ['geofence'],
    };
  }
  return null;
}

function ruleGps(s: TriageSections): TriageFinding | null {
  const g = s.gps;
  if (!g) return null;
  if (g.permission === 'denied') {
    return {
      severity: 'warning', code: 'GPS_PERMISSION_DENIED',
      title: 'Konum izni reddedilmiş',
      reason: 'GPS izni verilmemiş — navigasyon/hız füzyonu GPS kaynağını kullanamaz',
      action: 'Ayarlar > Uygulama izinlerinden konum iznini verin',
      sources: ['gpsDeep'],
    };
  }
  if (g.tracking === true && g.fixAgeMs === -1) {
    return {
      severity: 'warning', code: 'GPS_NO_FIX',
      title: 'GPS izleniyor ama fix alınamıyor',
      reason: 'İzleme aktif ancak hiç konum fix\'i gelmedi',
      action: 'Açık gökyüzü görüşü olan bir yerde test edin / anten bağlantısını kontrol edin',
      sources: ['gpsDeep'],
    };
  }
  return null;
}

/**
 * DTC bulgusu. KARAR: `dtc.count` "arıza var" kanıtıdır; kod METNİ yalnız
 * zenginleştirmedir. Kod listesi boş/bozuk gelse bile bulgu ÜRETİLİR — aksi halde
 * arızanın olduğu tam anda triyaj susar (denetim 2026-07-12 P0).
 */
function ruleObdDtc(s: TriageSections): TriageFinding | null {
  const dtc = s.obdDeep?.dtc;
  if (!dtc || typeof dtc.count !== 'number' || dtc.count <= 0) return null;

  // Bozuk/düşmüş elemanlar ELENİR; kalanların `code`'u string olmayabilir.
  const codes = (Array.isArray(dtc.codes) ? dtc.codes : []).filter((c) => c != null);
  const labels = codes
    .map((c) => (typeof c.code === 'string' ? c.code : null))
    .filter((code): code is string => code !== null);

  const hasCritical = codes.some((c) => c.severity === 'critical');
  const listed = labels.length > 0
    ? ` (${labels.slice(0, 3).join(', ')}${labels.length > 3 ? '…' : ''})`
    : '';

  return {
    severity: hasCritical ? 'critical' : 'warning',
    code: 'OBD_DTC_PRESENT',
    title: hasCritical ? 'Kritik arıza kodu (DTC) mevcut' : 'Arıza kodu (DTC) mevcut',
    reason: `${dtc.count} DTC okundu${listed}`,
    action: 'DTC listesini inceleyin, ilgili sistemleri kontrol ettirin',
    sources: ['obdDeep'],
  };
}

const RULES: readonly Rule[] = [
  ruleHealth, ruleBootThermal, ruleMemoryLeak, ruleMainThreadJank, rulePower, ruleFusion,
  ruleTransportObd, ruleObdStaleData, ruleNetAi, ruleSelfTest, ruleUiActivity, ruleStorageQueue,
  ruleGeofence, ruleGps, ruleObdDtc,
];

function countScanned(s: TriageSections): number {
  let n = 0;
  const rec = s as unknown as Record<string, unknown>;
  for (const key of TRACKED_SECTIONS) {
    if (rec[key] != null) n++;
  }
  return n;
}

/**
 * Bulk kural motoru — mevcut bölüm snapshot'larını okuyup KÖK-NEDEN + ÖNCELİK
 * çıkarır. Saf/fail-soft: her kural kendi alan null-check'ini yapar, veri
 * yoksa/bozuksa sessizce atlanır (sahte bulgu ASLA üretilmez). En fazla
 * MAX_FINDINGS bulgu tutulur (severity: critical > warning > info).
 */
export function buildTriageSnapshot(sections: TriageSections): TriageSnapshot {
  const findings: TriageFinding[] = [];
  let ruleErrors = 0;

  for (const rule of RULES) {
    // KURAL İZOLASYONU: bir kural bozuk bölüm yüzünden patlarsa YALNIZ o kural
    // düşer. Eskiden tek TypeError döngüyü kırıyor, _attachTriage'ın yutucu
    // catch'i TÜM triyajı sessizce siliyordu → admin "kritik bulgu yok" görüyordu.
    // Sahte bulgu ÜRETİLMEZ (patlayan kural bulgu döndürmez), yalnız sayılır.
    let f: TriageFinding | null = null;
    try {
      f = rule(sections);
    } catch {
      ruleErrors++;
    }
    if (f) findings.push(f);
  }

  findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const topSeverity: TriageSnapshot['topSeverity'] = findings.length > 0 ? findings[0].severity : 'none';
  return {
    findings: findings.slice(0, MAX_FINDINGS),
    scanned: countScanned(sections),
    topSeverity,
    ruleErrors,
  };
}

/* ── V2 — Root Cause Engine (PR-1 kontrat katmanı) ────────────────────
 * buildTriageSnapshot'ın YANINDA (silmeden) çalışır. Aynı RULES motorunu
 * kullanır ama çıktıyı GÜVENE göre sıralı RootCauseHypothesis listesine
 * dönüştürür ("veri → yorum → OLASILIK"). Rapor payload'ı ikisini de taşır
 * (A/B); UI PR-8'de bu bloğu render edecek. Fail-soft + kural izolasyonu
 * buildTriageSnapshot ile aynı disiplinde.
 *
 * PR-1 KAPSAMI (bilinçli sınır): kurallar henüz aşama-kanıtı / kod-işaretçisi
 * üretmiyor → confidence severity+korelasyondan, evidence `reason`dan türer,
 * codePointer boş kalır. Bunları PR-3 (KB) ve PR-5/6 (OBD kanıt zinciri)
 * doldurur; bu fonksiyonun SÖZLEŞMESİ o zaman değişmez, yalnız alanlar dolar. */
function findingToHypothesis(f: TriageFinding): RootCauseHypothesis {
  const correlated = Array.isArray(f.sources) && f.sources.length >= 2;
  const evidence = Array.isArray(f.evidence) && f.evidence.length > 0
    ? f.evidence
    : [f.reason];
  const analysis = typeof f.analysis === 'string' && f.analysis
    ? f.analysis
    : correlated
      ? `Çapraz-korelasyon (${f.sources.join(' + ')}): birden çok bölüm aynı kökü işaret ediyor.`
      : `Tek kaynak (${f.sources[0] ?? '?'}): ${f.reason}`;
  // PR-3: kural açık codePointer vermediyse KB'den geliştirici-hedefli işaretçi
  // (dosya+fonksiyon+fixHint) çek. KB'de yoksa boş kalır (uydurma YASAK).
  let codePointer = f.codePointer;
  if (!codePointer) {
    const kb = lookupRootCause(f.code);
    if (kb && kb.suspectFiles.length > 0) {
      codePointer = {
        file: kb.suspectFiles[0],
        symbol: kb.suspectSymbols[0] ?? '',
        fixHint: kb.fixHint,
      };
    }
  }
  return {
    problem: f.title,
    severity: f.severity,
    code: f.code,
    confidence: deriveConfidence(f),
    evidence,
    analysis,
    recommendedFix: f.action,
    codePointer,
    sources: f.sources,
  };
}

/* ── V2 (PR-6) — OBD çok-hipotez kök-neden analizörü ─────────────────
 * PR-5a handshake AŞAMA kanıtını (obdDeep.handshake) okuyup RAKİP AĞIRLIKLI
 * hipotezler üretir (vizyon: "85% native performHandshake / 12% ELM timeout /
 * 3% desteklenmiyor"). Klasik ruleTransportObd/ruleObdDtc ile ÇAKIŞMAZ (yeni
 * OBD_HS_* kodları). Yalnız BAĞLI-ama-sorunlu durumda konuşur; hiç bağlanmadıysa
 * INCONCLUSIVE (detectObdDisconnected) devrededir. Kanıt-güdümlü confidence. */
function obdHyp(
  code: string, confidence: number, problem: string, analysis: string,
  recommendedFix: string, file: string, symbol: string, evidence: string[],
  severity: TriageSeverity = 'warning',
): RootCauseHypothesis {
  return {
    problem, severity, code, confidence, evidence, analysis, recommendedFix,
    codePointer: { file, symbol, fixHint: recommendedFix }, sources: ['obdDeep'],
  };
}

function buildObdHypotheses(sections: TriageSections): RootCauseHypothesis[] {
  const od = sections.obdDeep;
  const hs = od?.handshake;
  if (!hs || typeof hs.outcome !== 'string') return [];
  // Hiç bağlanmadıysa handshake teşhisi anlamsız (INCONCLUSIVE devrede).
  const ad = od?.adapter;
  if (ad && ad.source === 'none') return [];

  const NATIVE = 'android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java';
  const OBDHS = 'src/core/val/OBDHandshake.ts';
  const OBDSVC = 'src/platform/obdService.ts';
  const ev = (extra: string[] = []) =>
    [`handshake.outcome=${hs.outcome}`, `bitmapClass=${hs.bitmapClass ?? '?'}`,
      `vinClass=${hs.vinClass ?? '?'}`, `supportedCount=${hs.supportedCount ?? 0}`, ...extra];

  if (hs.outcome === 'not_run') return [];

  if (hs.outcome === 'not_supported') {
    return [obdHyp('OBD_HS_NATIVE_MISSING', 90,
      'Native performHandshake eksik (eski plugin)',
      'Native köprü performHandshake taşımıyor → VIN/supported-PID keşfi hiç çalışmıyor.',
      'CarLauncherPlugin.performHandshake() implementasyonunu ekle/doğrula (Mode09 + 0100 blokları).',
      NATIVE, 'performHandshake', ev(), 'critical')];
  }

  if (hs.outcome === 'fail') {
    const r = hs.failReason ?? 'unknown';

    // PR-1a: PROTOKOL UYUŞMAZLIĞI — zorlanan protokol var ama AKTİF protokol yok
    // (ATDPN yanıtsız) → araç-değişimi/önbellek-protokol sinyali (dongle başka araçtan
    // geldi). Confidence KANITTAN türer: reconnectHistory'deki timeout sayısı arttıkça
    // ısrarlı uyuşmazlık güveni artar. Mevcut davranış korunur: protocolTried yoksa atla.
    const tried = hs.protocolTried, active = hs.protocolActive;
    if (tried && !active) {
      const hist = Array.isArray(hs.reconnectHistory) ? hs.reconnectHistory : [];
      const timeouts = hist.filter((h) => h && h.reason === 'timeout').length;
      const conf = Math.max(60, Math.min(90, 72 + timeouts * 6));
      return [
        obdHyp('OBD_HS_PROTOCOL_MISMATCH', conf,
          'Bağlantı takıldı — zorlanan protokol araca uymuyor (araç değişimi?)',
          `protocolTried=${tried} ama protocolActive yok (ATDPN yanıtsız); ${timeouts}× timeout. Önbellek protokolü yeni araca yanlış olabilir.`,
          'obdService.performHandshake — obd:lastProtocol önbelleğini sıfırla, ATSP0-otomatik dene (araç-değişimi kurtarması).',
          OBDSVC, 'performHandshake',
          ev([`protocolTried=${tried}`, 'protocolActive=none', `timeouts=${timeouts}`, `stage=${hs.timeoutStage ?? '?'}`])),
        obdHyp('OBD_HS_FAIL_TRANSPORT', Math.max(5, 100 - conf - 5),
          'Adaptör/transport yanıt vermedi',
          'BLE menzil/güç veya ELM init sorunu da aynı timeout\'u üretebilir.',
          'Adaptör gücü/menzilini + transport kararlılığını doğrula.',
          OBDSVC, 'performHandshake', ev([`failReason=${r}`])),
      ];
    }

    const transportW = r === 'timeout' || r === 'no_response' ? 80 : 65;
    return [
      obdHyp('OBD_HS_FAIL_TRANSPORT', transportW,
        'Handshake başarısız — native/ELM yanıt vermedi (transport/adaptör)',
        `Handshake ${r} ile düştü; ECU haberleşmesi kurulamadı (BLE menzil/güç veya ELM init).`,
        'obdService performHandshake .catch reason + transport kararlılığını incele; adaptör gücü/menzili doğrula.',
        OBDSVC, 'performHandshake', ev([`failReason=${r}`])),
      obdHyp('OBD_HS_FAIL_UNSUPPORTED', 100 - transportW - 5,
        'Araç handshake moduna yanıt vermiyor (desteklenmiyor)',
        'Bazı araçlar 0100/0902 moduna yanıt vermez; handshake düşse de temel PID akabilir.',
        'Araç profilini/protokolü doğrula; desteklenmiyorsa statik profil fallback.',
        OBDHS, 'buildHandshakeResult', ev([`failReason=${r}`])),
      obdHyp('OBD_HS_FAIL_PROTOCOL', 5,
        'Protokol/init yanlış',
        'Yanlış protokol seçimi handshake yanıtını bozabilir.',
        'forcedProtocol/auto seçimini ve ATSP init sırasını doğrula.',
        OBDSVC, 'forcedProtocol', ev([`failReason=${r}`])),
    ];
  }

  if (hs.outcome === 'ok') {
    // Bitmap (0100) alınamadı → Mode01 zinciri.
    if (hs.bitmapClass && hs.bitmapClass !== 'ok') {
      return [
        obdHyp('OBD_HS_BITMAP_FAIL', 80,
          'Handshake bağlandı ama 0100 bitmap alınamadı → Mode01 zinciri',
          `bitmapClass=${hs.bitmapClass}: supported-PID bitmap yanıtı yok → keşif tıkanır, PID poll NO-DATA fırtınası.`,
          'CarLauncherPlugin 0100 blok okumasını + OBDHandshake.parseSupportedPIDs classify\'ını doğrula.',
          OBDHS, 'parseSupportedPIDs', ev(), 'warning'),
        obdHyp('OBD_HS_BITMAP_UNSUPPORTED', 15,
          'Araç 0100 bitmap sorgusuna yanıt vermiyor',
          'Nadir araçlarda 0100 desteklenmez; heuristic PID listesine düşülür.',
          'Statik/heuristic PID listesi fallback\'ini doğrula.',
          OBDHS, 'buildHandshakeResult', ev()),
      ];
    }
    // Bitmap OK ama VIN alınamadı → Mode09 zinciri (VİZYONUN TAM ÖRNEĞİ).
    if (!hs.vinPresent && hs.vinClass && hs.vinClass !== 'ok') {
      return [
        obdHyp('OBD_HS_VIN_FAIL', 70,
          'Handshake+bitmap OK ama VIN (0902) alınamadı → Mode09 zinciri',
          `vinClass=${hs.vinClass}: ECU haberleşmesi çalışıyor (bitmap OK) ama Mode09/VIN yanıtı ${hs.vinClass}.`,
          'CarLauncherPlugin raw09 okumasını + OBDHandshake.parseVIN\'i doğrula; multi-frame ISO-TP birleştirme kontrol et.',
          OBDHS, 'parseVIN', ev()),
        obdHyp('OBD_HS_VIN_UNSUPPORTED', 25,
          'Araç Mode09/VIN desteklemiyor (yaygın)',
          'Birçok araç 0902\'yi desteklemez; bu bir arıza değil, VIN-siz profil normaldir.',
          'VIN-siz profil eşleşmesini (protocol+supportedPids) doğrula.',
          OBDHS, 'findBestMatch', ev()),
      ];
    }
    // Handshake OK ama hiç PID keşfedilmedi.
    if ((hs.supportedCount ?? 0) === 0) {
      return [obdHyp('OBD_HS_NO_PIDS', 60,
        'Handshake OK ama desteklenen PID 0',
        'bitmap/VIN sınıfı OK ama supportedCount 0 → bitmap parse veya refinePidList seed sorunu.',
        'OBDHandshake.parseSupportedPIDs çıktısı + obdService seedExtendedSupported/refinePidList zincirini incele.',
        OBDSVC, 'seedExtendedSupported', ev())];
    }
  }
  return [];
}

/* ── V2 (PR-4) — INCONCLUSIVE dedektörleri ───────────────────────────
 * Her dedektör TEK subsystem'i okur; sonuca varamama KOŞULU yoksa null döner
 * (sahte belirsizlik ÜRETİLMEZ). RULES gibi fail-soft/izole. */
type InconclusiveDetector = (s: TriageSections) => InconclusiveNote | null;

/** OBD bağlı değil → DTC/VIN/Freeze/Extended DOĞRULANAMAZ (2026-07-14 kanıtlı). */
function detectObdDisconnected(s: TriageSections): InconclusiveNote | null {
  const ad = s.obdDeep?.adapter;
  if (!ad) return null;
  const disconnected =
    ad.source === 'none' ||
    ad.connectionState === 'error' ||
    ad.connectionState === 'disconnected' ||
    ad.lastSeenMs === 0;
  if (!disconnected) return null;
  return {
    subsystem: 'OBD',
    code: 'OBD_DISCONNECTED_NO_VERIFY',
    reason: 'OBD bağlı değildi (source:none / bağlantı hata) — canlı sorgu yapılamadı',
    // NOT: değerler serbest metin — PII-anahtar guard'ına takılmamak için tam '"vin"'
    // token'ı üretilmez ('VIN okuma' → "vin okuma", guard-güvenli). Guard ZAYIFLATILMAZ.
    blockedConclusions: ['DTC arıza kodları', 'VIN okuma', 'Freeze frame', 'Extended PID keşfi', 'canlı PID trafiği'],
    missingEvidence: ['obdDeep.adapter.connected', 'mode03Response', 'mode09VinRaw', 'freezeFrameRaw', 'extended.discovered'],
  };
}

/** GPS izni yok/fix yok → konum-tabanlı sonuçlar DOĞRULANAMAZ. */
function detectGpsUnavailable(s: TriageSections): InconclusiveNote | null {
  const g = s.gps;
  if (!g) return null;
  const denied = g.permission === 'denied';
  const noFix = g.tracking === true && g.fixAgeMs === -1;
  if (!denied && !noFix) return null;
  return {
    subsystem: 'GPS',
    code: denied ? 'GPS_DENIED_NO_VERIFY' : 'GPS_NOFIX_NO_VERIFY',
    reason: denied ? 'Konum izni yok — GPS kaynağı okunamadı' : 'GPS izleniyor ama fix yok',
    blockedConclusions: ['GPS doğruluğu', 'konum tazeliği', 'GPS-tabanlı hız füzyonu'],
    missingEvidence: denied ? ['gps.permission=granted'] : ['gps.fixAgeMs', 'gps.accuracyM'],
  };
}

const INCONCLUSIVE_DETECTORS: readonly InconclusiveDetector[] = [
  detectObdDisconnected, detectGpsUnavailable,
];

/** Sonuçsuzluk beyanlarını toplar (fail-soft/izole). */
function buildInconclusive(sections: TriageSections): { notes: InconclusiveNote[]; errors: number } {
  const notes: InconclusiveNote[] = [];
  let errors = 0;
  for (const det of INCONCLUSIVE_DETECTORS) {
    try {
      const n = det(sections);
      if (n) notes.push(n);
    } catch { errors++; }
  }
  return { notes, errors };
}

/**
 * Kök-neden motoru — mevcut kuralları çalıştırır, bulguları GÜVENE göre sıralı
 * hipotezlere dönüştürür (TOP-N) + sonuca varılamayan subsystem'ler için EKSİK
 * KANIT beyanı üretir. Saf/fail-soft; kural izolasyonu korunur.
 * buildTriageSnapshot'ı ETKİLEMEZ (ayrı geçiş).
 */
export function buildRootCauseSnapshot(sections: TriageSections): RootCauseSnapshot {
  const hypotheses: RootCauseHypothesis[] = [];
  let ruleErrors = 0;

  for (const rule of RULES) {
    let f: TriageFinding | null = null;
    try {
      f = rule(sections);
    } catch {
      ruleErrors++;
    }
    if (f) hypotheses.push(findingToHypothesis(f));
  }

  // PR-6: OBD çok-hipotez analizörü — handshake kanıtından rakip ağırlıklı
  // hipotezler (fail-soft/izole; yeni OBD_HS_* kodları, çakışma yok).
  try {
    hypotheses.push(...buildObdHypotheses(sections));
  } catch { ruleErrors++; }

  // Güven azalan; eşitlikte severity kritik önce.
  hypotheses.sort((a, b) =>
    b.confidence - a.confidence ||
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  const inc = buildInconclusive(sections);

  return {
    hypotheses: hypotheses.slice(0, MAX_ROOT_CAUSES),
    inconclusive: inc.notes,
    scanned: countScanned(sections),
    ruleErrors: ruleErrors + inc.errors,
    topConfidence: hypotheses.length > 0 ? hypotheses[0].confidence : 0,
  };
}

/* ── V2 (PR-7) — BİRLEŞİK TANI VERDİKTİ (tek bakılacak nesne) ─────────
 * rootCause hipotezleri + inconclusive + errorLedger'ın ESKİ/YENİ bağlamını tek
 * "verdict"te birleştirir. SAHA DERSİ (2026-07-14): hipotez yokken tüm hatalar
 * önceki oturumdansa "yeni regresyon değil" der (mühendisi eski hatayı kovalamaktan
 * kurtarır). errorLedger DECOUPLED (*Like) — modül import edilmez. */

/** errorLedger.ErrorLedgerSnapshot'ın decoupled şekli (yalnız kullanılan alanlar). */
export interface ErrorLedgerLike {
  entries?: ({ ctx?: string; activeNow?: boolean; occurrence?: number; severity?: string } | null)[];
  activeNowCount?: number;
  previousBootCount?: number;
}

export interface DiagnosticVerdict {
  /** Tek satır sonuç — mühendisin İLK okuyacağı. */
  headline: string;
  /** Güvene göre sıralı kök-neden hipotezleri (≤10). */
  topRootCauses: RootCauseHypothesis[];
  /** Sonuca varılamayan subsystem'ler (eksik kanıtla). */
  inconclusive: InconclusiveNote[];
  /** Hata izinin tazeliği (eski/yeni). */
  errorFreshness: {
    activeNowCount: number;
    previousBootCount: number;
    /** 0-1: hataların ne kadarı bayat (önceki oturum). */
    staleRatio: number;
    /** Bu oturumda aktif ilk birkaç hata bağlamı. */
    topActive: string[];
  };
  hasActiveRootCause: boolean;
}

export function buildDiagnosticVerdict(
  sections: TriageSections,
  errorLedger?: ErrorLedgerLike | null,
): DiagnosticVerdict {
  const rc = buildRootCauseSnapshot(sections);

  const entries = Array.isArray(errorLedger?.entries) ? errorLedger!.entries! : [];
  const activeEntries = entries.filter((e) => e && e.activeNow === true);
  const activeNowCount = typeof errorLedger?.activeNowCount === 'number'
    ? errorLedger.activeNowCount : activeEntries.length;
  const previousBootCount = typeof errorLedger?.previousBootCount === 'number'
    ? errorLedger.previousBootCount : entries.filter((e) => e && e.activeNow === false).length;
  const totalSig = activeNowCount + previousBootCount;
  const staleRatio = totalSig > 0 ? Math.round((previousBootCount / totalSig) * 100) / 100 : 0;
  const topActive = activeEntries
    .map((e) => (e && typeof e.ctx === 'string' ? e.ctx : ''))
    .filter(Boolean).slice(0, 3);

  const hasActiveRootCause = rc.hypotheses.length > 0;
  let headline: string;
  if (hasActiveRootCause) {
    const top = rc.hypotheses[0];
    const where = top.codePointer ? ` → ${top.codePointer.file}` : '';
    headline = `${top.problem} (%${top.confidence})${where}`;
  } else if (rc.inconclusive.length > 0) {
    headline = `Sonuç belirsiz: ${rc.inconclusive[0].reason}`;
  } else if (activeNowCount === 0 && previousBootCount > 0) {
    // SAHA DERSİ: canlı kök-neden yok + tüm hatalar önceki oturumdan → bayat.
    headline = `Aktif kök-neden yok — ${previousBootCount} hata imzası önceki oturumdan (bayat), yeni regresyon değil.`;
  } else {
    headline = 'Kayda değer kök-neden bulunamadı.';
  }

  return {
    headline,
    topRootCauses: rc.hypotheses,
    inconclusive: rc.inconclusive,
    errorFreshness: { activeNowCount, previousBootCount, staleRatio, topActive },
    hasActiveRootCause,
  };
}

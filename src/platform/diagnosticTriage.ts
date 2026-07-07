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
 *    bozuksa kural sessizce atlanır (try/catch YOK — sahte bulgu YASAK).
 *  - PII yok: reason/action yalnız sayısal/enum değer + statik Türkçe metin —
 *    koordinat/VIN/plaka/transkript ASLA girmez.
 *  - Zero-alloc dostu: hot-path DEĞİL, snapshot anında bir kez çalışır.
 *  - Tipler DECOUPLED (IncidentCenter'daki "*Like" deseni) — diagnosticSections
 *    vb. modülleri import ETMEZ, yalnız şekli bilir (bağımlılık döngüsü yok).
 */

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
}

export interface TriageSnapshot {
  findings: TriageFinding[];
  /** Kaç bölüm okundu (veri vardı) — insan "robot gerçekten baktı mı" görsün. */
  scanned: number;
  topSeverity: TriageSeverity | 'none';
}

/* ── Girdi şekli — decoupled, yalnız kullanılan alanlar ─────────── */

interface HealthSectionLike {
  overallHealth?: string;
  services?: { name: string; healthy: boolean; restartCount: number }[];
}
interface ObdDeepSectionLike {
  health?: { connectionQuality?: number; reconnectPressure?: number };
  dtc?: { count?: number; codes?: { code: string; severity: string; system: string }[] };
}
interface PerfSampleLike { ts: number; tempC: number; level: number; memMb: number; fps: number; lagMs: number }
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
const STORAGE_QUEUE_WARN         = 20;
const STORAGE_QUEUE_OFFLINE_WARN = 5;

const TRACKED_SECTIONS = [
  'health', 'obdDeep', 'perfSeries', 'netAi', 'gps', 'voice', 'geofence',
  'storageQueue', 'power', 'fusion', 'bootTiming', 'transport', 'selfTest',
  'uiActivity', 'trail',
] as const;

const SEVERITY_RANK: Record<TriageSeverity, number> = { critical: 0, warning: 1, info: 2 };
const MAX_FINDINGS = 8;

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

function ruleObdDtc(s: TriageSections): TriageFinding | null {
  const dtc = s.obdDeep?.dtc;
  if (!dtc || typeof dtc.count !== 'number' || dtc.count <= 0) return null;
  const codes = Array.isArray(dtc.codes) ? dtc.codes : [];
  const hasCritical = codes.some((c) => c && c.severity === 'critical');
  return {
    severity: hasCritical ? 'critical' : 'warning',
    code: 'OBD_DTC_PRESENT',
    title: hasCritical ? 'Kritik arıza kodu (DTC) mevcut' : 'Arıza kodu (DTC) mevcut',
    reason: `${dtc.count} DTC okundu${codes.length > 0 ? ` (${codes.slice(0, 3).map((c) => c.code).join(', ')}${codes.length > 3 ? '…' : ''})` : ''}`,
    action: 'DTC listesini inceleyin, ilgili sistemleri kontrol ettirin',
    sources: ['obdDeep'],
  };
}

const RULES: readonly Rule[] = [
  ruleHealth, ruleBootThermal, ruleMemoryLeak, rulePower, ruleFusion,
  ruleTransportObd, ruleNetAi, ruleSelfTest, ruleUiActivity, ruleStorageQueue,
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
  for (const rule of RULES) {
    const f = rule(sections);
    if (f) findings.push(f);
  }
  findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const topSeverity: TriageSnapshot['topSeverity'] = findings.length > 0 ? findings[0].severity : 'none';
  return {
    findings: findings.slice(0, MAX_FINDINGS),
    scanned: countScanned(sections),
    topSeverity,
  };
}

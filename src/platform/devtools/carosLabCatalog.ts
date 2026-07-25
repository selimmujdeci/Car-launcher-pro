/**
 * carosLabCatalog.ts — CAROS LAB araç kataloğu (SAF · React'siz · tek kaynak).
 *
 * FAZ A / DEVELOPER FIRST (docs/CAROS_LAB_DEVELOPER_PLATFORM_STRATEGY.md): geliştirici
 * araçları tek çatı altında toplanır. Bu dosya YALNIZ katalogdur — hiçbir servis
 * başlatmaz, hiçbir şey import etmez (platform-saf, yan etkisiz, monomorfik sabitler).
 *
 * DURUM DOĞRULUĞU (görev §E — pazarlıksız):
 *  - AVAILABLE   : ekran GERÇEKTEN var, açılıyor ve güvenli. (Ekran içinde ayrıca
 *                  FOUNDATION_ONLY / NOT_WIRED alt-durumu gösterilebilir.)
 *  - PLACEHOLDER : henüz ekranı YOK. "Yakında/çalışıyor" gibi belirsiz ifade YASAK —
 *                  kart neyin eksik olduğunu açıkça yazar.
 *  - DISABLED    : ekran teknik olarak mümkün olsa bile GÜVENLİK POLİTİKASI gereği
 *                  kapalı (ECU write / ham komut / stres). Karta basmak İŞLEM ÇALIŞTIRMAZ.
 *
 * Route adları type-safe: `CarosLabToolId` union → yeni paralel router YOK, tek host
 * bileşeni bu id'yi çözer (CarosLabToolHost).
 */

/* ── Kategoriler ─────────────────────────────────────────────────────────── */

export type CarosLabCategory = 'vehicle' | 'communication' | 'runtime' | 'ai' | 'developer';

export const CAROS_LAB_CATEGORIES: readonly CarosLabCategory[] = [
  'vehicle', 'communication', 'runtime', 'ai', 'developer',
] as const;

export const CAROS_LAB_CATEGORY_LABEL: Readonly<Record<CarosLabCategory, string>> = {
  vehicle:       'Araç',
  communication: 'İletişim',
  runtime:       'Çalışma Zamanı',
  ai:            'Yapay Zekâ',
  developer:     'Geliştirici',
} as const;

/* ── Durum ───────────────────────────────────────────────────────────────── */

export type CarosLabToolStatus = 'AVAILABLE' | 'PLACEHOLDER' | 'DISABLED';

/**
 * Durumun EKRANDA görünen Türkçe karşılığı.
 *
 * Enum DEĞERİ (`AVAILABLE`…) makine sözleşmesidir — `data-status` özniteliğinde ve
 * testlerde AYNEN kalır; kullanıcı yalnız Türkçe etiketi görür. Böylece dil değişimi
 * dürüstlük kilitlerini (sahte "çalışıyor" yasağı) zayıflatmaz.
 */
export const CAROS_LAB_STATUS_LABEL: Readonly<Record<CarosLabToolStatus, string>> = {
  AVAILABLE:   'HAZIR',
  PLACEHOLDER: 'EKRAN YOK',
  DISABLED:    'KAPALI',
} as const;

/* ── Araç kaydı ──────────────────────────────────────────────────────────── */

export type CarosLabToolId =
  // Vehicle
  | 'live-data' | 'pid-did-explorer' | 'deep-scan' | 'vehicle-fingerprint'
  // Communication
  | 'raw-obd-traffic' | 'can-monitor' | 'kwp-monitor' | 'uds-explorer'
  | 'session-inspector' | 'adapter-diagnostics'
  // Runtime
  | 'queue-monitor' | 'poll-scheduler' | 'recovery-monitor' | 'evidence-viewer' | 'performance'
  // AI
  | 'mavi-console' | 'action-registry' | 'tool-calling' | 'memory-explorer' | 'knowledge-explorer'
  // Developer
  | 'decoder-registry' | 'discovery-database' | 'raw-command-console'
  | 'replay-log' | 'benchmark' | 'stress-test';

export interface CarosLabTool {
  readonly id:       CarosLabToolId;
  readonly category: CarosLabCategory;
  /** Teknik ad — sadeleştirilmez (FAZ A: teknik isim serbest). */
  readonly name:     string;
  /** Kısa teknik açıklama — ne okur / neye bakar. */
  readonly desc:     string;
  readonly status:   CarosLabToolStatus;
  /** Protokol / katman etiketi (varsa) — ör. 'ELM327', 'KWP2000', 'UDS'. */
  readonly layer:    string | null;
  /**
   * PLACEHOLDER → neyin eksik olduğu; DISABLED → neden kapalı olduğu.
   * AVAILABLE → null (ekran içi alt-durum ekranın kendi sorumluluğu).
   */
  readonly note:     string | null;
}

/* Sıra = ekranda görünen sıra. Tüm alanlar aynı sırada yazılır (V8 hidden-class
   kararlılığı — CLAUDE.md §V8 Template Object Literals). */
export const CAROS_LAB_TOOLS: readonly CarosLabTool[] = Object.freeze([
  /* ── Vehicle ────────────────────────────────────────────────────────── */
  {
    id: 'live-data', category: 'vehicle', name: 'Canlı Veri',
    desc: 'Tüm Mode-01 PID + marka DID canlı akışı; ham hex, yorumlanmış değer, tazelik ve durum.',
    status: 'AVAILABLE', layer: 'OBD-II / Mode 01', note: null,
  },
  {
    id: 'pid-did-explorer', category: 'vehicle', name: 'PID/DID Gezgini',
    desc: 'Salt-okunur PID/DID keşif koordinatörü: aday tarama, doğrulanan/şüpheli/reddedilen sayaçları.',
    status: 'AVAILABLE', layer: 'Mode 22 / DID', note: null,
  },
  {
    id: 'deep-scan', category: 'vehicle', name: 'Derin Tarama',
    desc: 'Çok fazlı ECU/firmware derin tarama orkestrasyonu.',
    status: 'PLACEHOLDER',
    layer: 'UDS',
    note: 'Tek ve güvenli bir giriş noktası yok: deepScanOrchestrator (singleton) ve platformCoreDeepScanWiring (ignition-tetikli, fail-closed) iki ayrı akış. Yeni akış üretmemek için bağlanmadı.',
  },
  {
    id: 'vehicle-fingerprint', category: 'vehicle', name: 'Araç Parmak İzi',
    desc: 'Araç kimliği (protokol, ECU adresleri, desteklenen PID maskesi) parmak izi görünümü.',
    status: 'PLACEHOLDER', layer: null,
    note: 'Bağımsız ekranı yok; fingerprint şu an yalnız keşif akışının içinde üretiliyor.',
  },

  /* ── Communication ──────────────────────────────────────────────────── */
  {
    id: 'raw-obd-traffic', category: 'communication', name: 'Ham OBD Trafiği',
    desc: 'Native adaptör trafiği: komut / yanıt / gecikme (ms). Yalnız OKUR — komut göndermez.',
    status: 'AVAILABLE', layer: 'ELM327', note: null,
  },
  {
    id: 'can-monitor', category: 'communication', name: 'CAN İzleyici',
    desc: 'Ham CAN frame kütüğü (id + payload), panel açıkken toplanır.',
    status: 'AVAILABLE', layer: 'CAN', note: null,
  },
  {
    id: 'kwp-monitor', category: 'communication', name: 'KWP İzleyici',
    desc: 'KWP2000 oturum durumu, keep-alive ve kurtarma merdiveni izleme.',
    status: 'PLACEHOLDER', layer: 'KWP2000',
    note: 'Ekran yok. Kurtarma kanıtı şu an yalnız Kanıt Görüntüleyici içindeki recovery.* satırlarından okunabilir.',
  },
  {
    id: 'uds-explorer', category: 'communication', name: 'UDS Gezgini',
    desc: 'UDS servis/alt-fonksiyon gezgini, NRC çözümleme.',
    status: 'PLACEHOLDER', layer: 'UDS / ISO 14229',
    note: 'Ekran yok. İstek üreten bir gezgin güvenlik incelemesi gerektirir (Faz A2).',
  },
  {
    id: 'session-inspector', category: 'communication', name: 'Oturum Denetçisi',
    desc: 'Oturum durumunun 6 katmanlı salt-okunur görünümü: transport · handshake · data gate · KWP · HAL · runtime. Her değer OBSERVED/DERIVED/UNAVAILABLE/STALE işaretli; kaynak çelişkileri ayrı gösterilir.',
    status: 'AVAILABLE', layer: null, note: null,
  },
  {
    id: 'adapter-diagnostics', category: 'communication', name: 'Adaptör Tanılama',
    desc: 'Adaptör kimliği, transport kalitesi, buffer/timeout sayaçları.',
    status: 'PLACEHOLDER', layer: null,
    note: 'Ekran yok.',
  },

  /* ── Runtime ────────────────────────────────────────────────────────── */
  {
    id: 'queue-monitor', category: 'runtime', name: 'Kuyruk İzleyici',
    desc: 'Çalışma Zamanı Zamanlama ortak görünümü: 6 ayrı runtime otoritesi (command execution · live polling · handshake · KWP · discovery/deep scan · CAN collection) salt-okunur listelenir.',
    status: 'AVAILABLE', layer: null,
    note: 'Native komut kuyruğunun DERİNLİĞİ JS\'e açılmamıştır; o alan UNAVAILABLE olarak gösterilir (boş kuyruk varsayılmaz).',
  },
  {
    id: 'poll-scheduler', category: 'runtime', name: 'Sorgu Zamanlayıcı',
    desc: 'Çalışma Zamanı Zamanlama ortak görünümü (Kuyruk İzleyici ile aynı ekran): poll zamanlayıcısı, tazelik kapısı ve native poll kanıtı salt-okunur.',
    status: 'AVAILABLE', layer: null,
    note: 'Aktif poll kadansı UNAVAILABLE: computeObdPollProfile saf bir fonksiyondur, hesaplanan profil hiçbir yerde saklanmaz.',
  },
  {
    id: 'recovery-monitor', category: 'runtime', name: 'Kurtarma İzleyici',
    desc: 'Kurtarma merdiveni durumu ve tetiklenme geçmişi.',
    status: 'PLACEHOLDER', layer: null,
    note: 'Ekran yok.',
  },
  {
    id: 'evidence-viewer', category: 'runtime', name: 'Kanıt Görüntüleyici',
    desc: 'Mevcut kanıt kaynaklarının birleşik salt-okunur görünümü: olay izi + AI Core kanıtları + doğrulama kütüğü.',
    status: 'AVAILABLE', layer: null, note: null,
  },
  {
    id: 'performance', category: 'runtime', name: 'Performans',
    desc: 'FPS/bellek örnekleri, runtime modu ve hata sayaçları.',
    status: 'AVAILABLE', layer: null, note: null,
  },

  /* ── AI ─────────────────────────────────────────────────────────────── */
  {
    id: 'mavi-console', category: 'ai', name: 'Mavi Konsolu',
    desc: 'Mavi yaşam döngüsü, niyet çözümü ve yanıt gecikmesi konsolu.',
    status: 'PLACEHOLDER', layer: null,
    note: 'Ekran yok. Mavi Core telemetrisi mevcut ama konsol görünümü yazılmadı.',
  },
  {
    id: 'action-registry', category: 'ai', name: 'Eylem Kayıtları',
    desc: 'Kayıtlı typed action listesi, güvenlik sınıfı ve pilot durumu.',
    status: 'PLACEHOLDER', layer: null, note: 'Ekran yok.',
  },
  {
    id: 'tool-calling', category: 'ai', name: 'Araç Çağrısı',
    desc: 'Araç çağrısı (tool call) izleme: girdi, çıktı, red nedenleri.',
    status: 'PLACEHOLDER', layer: null, note: 'Ekran yok.',
  },
  {
    id: 'memory-explorer', category: 'ai', name: 'Bellek Gezgini',
    desc: 'Vehicle Memory kalıcı gerçekleri ve öğrenilmiş parmak izi kayıtları.',
    status: 'PLACEHOLDER', layer: null, note: 'Ekran yok.',
  },
  {
    id: 'knowledge-explorer', category: 'ai', name: 'Bilgi Tabanı Gezgini',
    desc: 'Teşhis bilgi tabanı (DTC → neden/kontrol eşlemeleri) gezgini.',
    status: 'PLACEHOLDER', layer: null, note: 'Ekran yok.',
  },

  /* ── Developer ──────────────────────────────────────────────────────── */
  {
    id: 'decoder-registry', category: 'developer', name: 'Çözücü Kayıtları',
    desc: 'Kayıtlı PID/DID decoder tanımları, birim ve ölçek eşlemeleri.',
    status: 'PLACEHOLDER', layer: null, note: 'Ekran yok.',
  },
  {
    id: 'discovery-database', category: 'developer', name: 'Keşif Veritabanı',
    desc: 'Sahada yakalanan katalog-dışı PID/DID gözlemleri; filtre, arama, JSON dışa aktarma.',
    status: 'AVAILABLE', layer: null, note: null,
  },
  {
    id: 'raw-command-console', category: 'developer', name: 'Ham Komut Konsolu',
    desc: 'Serbest ham komut gönderimi.',
    status: 'DISABLED', layer: 'ELM327 / UDS',
    note: 'GÜVENLİK POLİTİKASI: ham yazma/komut gönderimi kapalı (ECU write · coding · SecurityAccess · actuator · DTC clear kapsam dışı). Kart işlem çalıştırmaz.',
  },
  {
    id: 'replay-log', category: 'developer', name: 'Kayıt Oynatma',
    desc: 'Kara kutu kayıt oynatımı — kaydedilmiş oturumun olay akışı.',
    status: 'AVAILABLE', layer: null, note: null,
  },
  {
    id: 'benchmark', category: 'developer', name: 'Kıyaslama',
    desc: 'Poll turu, decode ve render bütçesi ölçümü.',
    status: 'PLACEHOLDER', layer: null, note: 'Ekran yok.',
  },
  {
    id: 'stress-test', category: 'developer', name: 'Yük Testi',
    desc: 'Yüksek yük altında adaptör/kuyruk dayanıklılık testi.',
    status: 'DISABLED', layer: null,
    note: 'GÜVENLİK POLİTİKASI: ECU/adaptör üzerinde kasıtlı yük üretir; canlı araçta çalıştırılabilir bir yüzey olarak açılmadı.',
  },
] as const);

/* ── Sorgular (saf) ──────────────────────────────────────────────────────── */

/** Kategoriye ait araçlar (katalog sırası korunur). */
export function toolsByCategory(category: CarosLabCategory): CarosLabTool[] {
  return CAROS_LAB_TOOLS.filter((t) => t.category === category);
}

/** id → araç; bilinmeyen id için null (fail-soft, throw YOK). */
export function getCarosLabTool(id: string): CarosLabTool | null {
  for (const t of CAROS_LAB_TOOLS) if (t.id === id) return t;
  return null;
}

/**
 * Karta basınca ekran AÇILABİLİR mi? Yalnız AVAILABLE açılır.
 * PLACEHOLDER → bilgi kartı gösterilir (ağır servis başlatılmaz).
 * DISABLED → hiçbir işlem çalıştırılmaz.
 */
export function isToolOpenable(tool: CarosLabTool | null): boolean {
  return !!tool && tool.status === 'AVAILABLE';
}

/**
 * Karta basıldığında hangi ekran AKTİF olmalı?
 *  - AVAILABLE   → gerçek ekran (id)
 *  - PLACEHOLDER → bilgi ekranı (id) — hiçbir ağır servis başlatılmaz
 *  - DISABLED    → null (HİÇBİR İŞLEM ÇALIŞMAZ)
 */
export function resolveToolActivation(tool: CarosLabTool | null): CarosLabToolId | null {
  if (!tool) return null;
  if (tool.status === 'DISABLED') return null;
  return tool.id;
}

/** Durum rozetinin görsel sınıfı için kararlı anahtar (UI tarafında eşlenir). */
export function statusTone(status: CarosLabToolStatus): 'ok' | 'muted' | 'blocked' {
  return status === 'AVAILABLE' ? 'ok' : status === 'PLACEHOLDER' ? 'muted' : 'blocked';
}

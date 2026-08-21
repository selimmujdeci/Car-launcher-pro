/**
 * backgroundPowerLabModel — Arka Plan Gücü ekranının SAF karar katmanı.
 *
 * SÖZLEŞME: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 * Girdi zaten okunmuş `BackgroundPowerRawSnapshot`; çıktı satırlar + çelişkiler + hüküm.
 *
 * ⚠️ POLİTİKA BURADA YENİDEN HESAPLANMAZ. Karar `backgroundPowerModel`in işidir;
 * bu dosya yalnız GÖSTERİR ve kararla gerçeği KARŞILAŞTIRIR. İkinci bir güç
 * politikası doğarsa hangisinin doğru olduğu sahada asla bilinemez.
 */
import type { BackgroundPowerReason } from '../power/backgroundPowerModel';
import type { BackgroundPowerRawSnapshot } from './backgroundPowerLabSources';
import type { InspectorField, Observability, SourceMismatch } from './sessionInspectorModel';

/** Kararın gerekçesinin Türkçe karşılığı (enum değeri `data-reason`'da AYNEN kalır). */
export const BG_REASON_LABEL: Readonly<Record<BackgroundPowerReason, string>> = {
  navigation_active:       'NAVİGASYON AKTİF — kısma yok',
  foreground:              'ÖN PLANDA (veya bilinmiyor) — kısma yok',
  external_power:          'HARİCİ GÜÇ (head unit / şarj) — kısma yok',
  background_battery:      'ARKA PLAN + PİL — GPS kısık, mikrofon susturuldu',
  background_power_unknown:'ARKA PLAN, GÜÇ BİLİNMİYOR — yalnız GPS kısık',
} as const;

/** Üç durumlu bayrağın metni. `null` KAYNAK YOK demektir — "hayır" DEĞİL. */
function triState(v: boolean | null, yes: string, no: string): string {
  if (v === null) return '—';
  return v ? yes : no;
}

function boolClass(v: boolean | null): Observability {
  return v === null ? 'UNAVAILABLE' : 'OBSERVED';
}

/**
 * Satırları kurar.
 *
 * SINIFLANDIRMA GEREKÇESİ: girdiler (ön plan / harici güç / navigasyon) ÖLÇÜLDÜ,
 * karar (gps/mic/reason) TÜRETİLDİ — çünkü saf modelin çıktısıdır, ölçüm değildir.
 * Okunamayan her alan KAYNAK YOK olur; `false` ile "okunamadı" ASLA karıştırılmaz.
 */
export function buildBgPowerFields(snap: BackgroundPowerRawSnapshot): readonly InspectorField[] {
  const out: InspectorField[] = [];
  const gate = snap.gate;

  out.push({
    id: 'gate-started',
    label: 'Kapı kurulu mu',
    value: gate === null ? '—' : triState(gate.started, 'EVET', 'HAYIR'),
    klass: gate === null ? 'UNAVAILABLE' : 'OBSERVED',
    source: 'backgroundPowerGate.getBackgroundPowerSnapshot().started',
    updatedAt: null,
    note: gate?.started === false
      ? 'Kapı kurulmamış — hiçbir kısma kararı UYGULANMAZ (ürün eski davranışında).'
      : 'SystemBoot tarafından kurulur; kurulu değilse politika hiç çalışmaz.',
  });

  out.push({
    id: 'app-active',
    label: 'Uygulama ön planda',
    value: gate === null ? '—' : triState(gate.inputs.appActive, 'EVET', 'HAYIR'),
    klass: gate === null ? 'UNAVAILABLE' : boolClass(gate.inputs.appActive),
    source: 'Capacitor App.appStateChange + document.visibilitychange',
    updatedAt: null,
    note: gate?.inputs.appActive === null
      ? 'Okunamadı — model ÖN PLAN varsayar (mevcut davranışı bozmaz). "Arka planda" DEMEK DEĞİL.'
      : 'İki bağımsız kaynak aynı bayrağı yazar (appStateChange · visibilitychange).',
  });

  out.push({
    id: 'external-power',
    label: 'Harici güç (şarj)',
    value: gate === null ? '—' : triState(gate.inputs.externalPower, 'VAR', 'YOK'),
    klass: gate === null ? 'UNAVAILABLE' : boolClass(gate.inputs.externalPower),
    source: 'CarLauncher.getDeviceStatus().charging (BatteryManager.EXTRA_STATUS)',
    updatedAt: null,
    note: gate?.inputs.externalPower === null
      ? 'Okunamadı (web/demo veya köprü yok) — mikrofona DOKUNULMAZ, yalnız GPS kısılır.'
      : 'Web Battery API BİLEREK kullanılmaz: WebView sabit charging:true döndürüp kısmayı öldürüyordu.',
  });

  out.push({
    id: 'navigation-active',
    label: 'Navigasyon oturumu',
    value: gate === null ? '—' : triState(gate.inputs.navigationActive, 'AKTİF', 'YOK'),
    klass: gate === null ? 'UNAVAILABLE' : 'OBSERVED',
    source: 'navGpsPowerBridge.setNavPowerObserver (tek yönlü kayıt)',
    updatedAt: null,
    note: 'Rota sürerken HİÇBİR ŞEY kısılmaz — native sNavigationActive istisnasının JS ikizi.',
  });

  out.push({
    id: 'wake-enabled',
    label: 'Pasif wake ayarı',
    value: triState(snap.wakeEnabled, 'AÇIK', 'KAPALI'),
    klass: boolClass(snap.wakeEnabled),
    source: 'wakeWordService.getWakeWordState().enabled',
    updatedAt: null,
    note: 'Kullanıcı ayarıdır; kapı bunu DEĞİŞTİRMEZ, yalnız native dinlemeyi askıya alır.',
  });

  /* ── Karar (TÜRETİLDİ) ─────────────────────────────────────────────────── */
  out.push({
    id: 'decision-reason',
    label: 'Karar gerekçesi',
    value: gate?.lastApplied ? BG_REASON_LABEL[gate.lastApplied.reason] : '—',
    klass: gate?.lastApplied ? 'DERIVED' : 'UNAVAILABLE',
    source: 'backgroundPowerModel.decideBackgroundPower()',
    /* Damga GERÇEKTİR: kararın uygulandığı an kapıda kaydedilir (uydurulmaz). */
    updatedAt: gate?.lastAppliedAt ?? null,
    note: gate?.lastApplied
      ? 'Saf modelin çıktısı — ölçüm değil, girdilerden TÜRETİLMİŞ karar.'
      : 'Henüz hiç karar uygulanmadı. Bu "kısma yok" demek DEĞİL, "kapı kımıldamadı" demektir.',
  });

  out.push({
    id: 'decision-gps',
    label: 'Karar · GPS',
    value: gate?.lastApplied ? (gate.lastApplied.gps === 'low' ? `KISIK (${snap.lowIntervalMs} ms)` : 'TAM GÜÇ') : '—',
    klass: gate?.lastApplied ? 'DERIVED' : 'UNAVAILABLE',
    source: 'backgroundPowerGate.lastApplied.gps',
    updatedAt: gate?.lastAppliedAt ?? null,
    note: 'Kısık mod akışı KESMEZ: enableHighAccuracy:false ile GNSS uyandırılmadan sürer.',
  });

  out.push({
    id: 'decision-mic',
    label: 'Karar · Mikrofon',
    value: gate?.lastApplied ? (gate.lastApplied.mic === 'off' ? 'SUSTUR' : 'AÇIK KALSIN') : '—',
    klass: gate?.lastApplied ? 'DERIVED' : 'UNAVAILABLE',
    source: 'backgroundPowerGate.lastApplied.mic',
    updatedAt: gate?.lastAppliedAt ?? null,
    note: 'Güç kaynağı bilinmiyorsa mikrofona DOKUNULMAZ — kanıtsız susturma yasak.',
  });

  out.push({
    id: 'applied-count',
    label: 'Uygulanan karar sayısı',
    value: gate === null ? '—' : String(gate.appliedCount),
    klass: gate === null ? 'UNAVAILABLE' : 'OBSERVED',
    source: 'backgroundPowerGate.appliedCount',
    updatedAt: null,
    note: '0 = kapı hiç kımıldamadı (girdi değişimi hiç gelmemiş olabilir).',
  });

  /* ── Gerçek donanım durumu (ÖLÇÜLDÜ) ───────────────────────────────────── */
  out.push({
    id: 'gps-actual',
    label: 'GERÇEK · GPS modu',
    value: snap.gpsModeActual === null ? '—' : (snap.gpsModeActual === 'low' ? 'KISIK' : 'TAM GÜÇ'),
    klass: snap.gpsModeActual === null ? 'UNAVAILABLE' : 'OBSERVED',
    source: 'gpsService.getGpsPowerMode()',
    updatedAt: null,
    note: 'Kararın DEĞİL, servisin kendi hâli. Kararla çelişirse aşağıda ÇELİŞKİ olarak listelenir.',
  });

  out.push({
    id: 'mic-actual',
    label: 'GERÇEK · Mikrofon',
    value: triState(snap.micPausedActual, 'ASKIDA', 'ASKIDA DEĞİL'),
    klass: boolClass(snap.micPausedActual),
    source: 'wakeWordService.isWakeWordPowerPaused()',
    updatedAt: null,
    note: 'Yalnız GÜÇ nedenli askı. Etkileşim duraklaması (450 ms) AYRI bayraktır.',
  });

  out.push({
    id: 'nav-native-sent',
    label: 'Native\'e gönderilen navigasyon',
    value: triState(snap.navPowerLastSent, 'AKTİF', 'PASİF'),
    klass: boolClass(snap.navPowerLastSent),
    source: 'navGpsPowerBridge.getNavGpsPowerLastSent()',
    updatedAt: null,
    note: 'Native servis park kısmasını kendi yapar; bu alan JS↔native uyumunu gösterir.',
  });

  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bölümleme — sıraya değil KİMLİĞE bağlıdır
 * ════════════════════════════════════════════════════════════════════════ */

export type BgPowerSectionId = 'inputs' | 'decision' | 'actual';

export const BG_SECTION_TITLE: Readonly<Record<BgPowerSectionId, string>> = {
  inputs:   'GİRDİLER (ölçülen)',
  decision: 'KARAR (türetilen)',
  actual:   'GERÇEK DURUM (servisler)',
} as const;

/**
 * Hangi satır hangi bölümde — dizi SIRASINA göre dilimlemek kırılgandır
 * (yeni satır eklenince sessizce yanlış bölüme düşerdi).
 */
const SECTION_OF: Readonly<Record<string, BgPowerSectionId>> = {
  'gate-started':      'inputs',
  'app-active':        'inputs',
  'external-power':    'inputs',
  'navigation-active': 'inputs',
  'wake-enabled':      'inputs',
  'decision-reason':   'decision',
  'decision-gps':      'decision',
  'decision-mic':      'decision',
  'applied-count':     'decision',
  'gps-actual':        'actual',
  'mic-actual':        'actual',
  'nav-native-sent':   'actual',
};

export interface BgPowerSection {
  readonly id:     BgPowerSectionId;
  readonly title:  string;
  readonly fields: readonly InspectorField[];
}

/** Satırları bölümlere dağıtır. Eşlemesi olmayan satır KAYBOLMAZ — 'actual'a düşer. */
export function buildBgPowerSections(
  fields: readonly InspectorField[],
): readonly BgPowerSection[] {
  const order: BgPowerSectionId[] = ['inputs', 'decision', 'actual'];
  return order.map((id) => ({
    id,
    title: BG_SECTION_TITLE[id],
    fields: fields.filter((f) => (SECTION_OF[f.id] ?? 'actual') === id),
  }));
}

/**
 * Karar ile gerçeğin çeliştiği yerler. Hiçbir taraf KAZANMAZ — ikisi de gösterilir.
 *
 * Bu ekranın ASIL değeri budur: bu depoda tekrar eden kusur "karar üretildi ama
 * uygulanmadı" desenidir; sessizce birini doğru kabul etmek onu görünmez yapar.
 */
export function detectBgPowerMismatches(snap: BackgroundPowerRawSnapshot): readonly SourceMismatch[] {
  const out: SourceMismatch[] = [];
  const decision = snap.gate?.lastApplied ?? null;
  if (decision === null) return out;

  if (snap.gpsModeActual !== null && snap.gpsModeActual !== decision.gps) {
    out.push({
      id: 'gps-decision-vs-actual',
      topic: 'GPS güç modu',
      aSource: 'backgroundPowerGate.lastApplied.gps', aValue: decision.gps,
      bSource: 'gpsService.getGpsPowerMode()',        bValue: snap.gpsModeActual,
      note: 'Karar uygulanmamış görünüyor: watch yeniden kurulurken hata olmuş olabilir (GPS:PowerMode).',
    });
  }

  if (snap.micPausedActual !== null) {
    const expectPaused = decision.mic === 'off';
    /* Wake ayarı KAPALIYKEN askı beklenmez: servis zaten dinlemiyordur. */
    const wakeOn = snap.wakeEnabled !== false;
    if (wakeOn && expectPaused !== snap.micPausedActual) {
      out.push({
        id: 'mic-decision-vs-actual',
        topic: 'Pasif mikrofon',
        aSource: 'backgroundPowerGate.lastApplied.mic', aValue: decision.mic,
        bSource: 'wakeWordService.isWakeWordPowerPaused()',
        bValue: snap.micPausedActual ? 'askıda' : 'askıda değil',
        note: 'Karar ile servis hâli ayrışmış: pause/resume çağrısı native tarafta düşmüş olabilir.',
      });
    }
  }

  if (snap.gate?.inputs.navigationActive === true && decision.gps === 'low') {
    out.push({
      id: 'nav-vs-throttle',
      topic: 'Navigasyon istisnası',
      aSource: 'inputs.navigationActive', aValue: 'true',
      bSource: 'lastApplied.gps',         bValue: 'low',
      note: 'Rota sürerken kısma OLMAMALI — istisna delinmiş demektir (öncelik sırası bozuk).',
    });
  }

  return out;
}

/** Kapının bütünsel durumu — ARAÇ hakkında değil, POLİTİKA hakkında hüküm. */
export type BgPowerVerdict =
  /** Kapı kurulmamış / okunamadı — hiçbir kısma çalışmıyor. */
  | 'NOT_STARTED'
  /** Karar ile gerçek ayrışmış — kısma iddia ediliyor ama uygulanmamış. */
  | 'DRIFT'
  /** Kısma AKTİF (arka plan + pil). */
  | 'THROTTLED'
  /** Kısma yok ve bu DOĞRU (ön plan / harici güç / navigasyon). */
  | 'FULL_POWER'
  /** Kapı kurulu ama henüz hiç karar uygulanmamış. */
  | 'IDLE';

export const BG_VERDICT_LABEL: Readonly<Record<BgPowerVerdict, string>> = {
  NOT_STARTED: 'KAPI KURULU DEĞİL',
  DRIFT:       'KARAR ↔ GERÇEK AYRIŞMASI',
  THROTTLED:   'KISMA AKTİF',
  FULL_POWER:  'TAM GÜÇ (kısma gerekmiyor)',
  IDLE:        'KARAR UYGULANMADI',
} as const;

export interface BgPowerVerdictResult {
  readonly status:  BgPowerVerdict;
  readonly reasons: readonly string[];
}

/**
 * Hüküm sırası (ilk eşleşen kazanır):
 *   1. kapı yok · 2. çelişki · 3. karar yok · 4. kısma aktif · 5. tam güç.
 * Çelişki, "kısma aktif"ten ÖNCE gelir: uygulanmamış bir kararı "aktif" saymak
 * tam olarak gizlemek istediğimiz yalandır.
 */
export function deriveBgPowerVerdict(
  snap: BackgroundPowerRawSnapshot,
  mismatches: readonly SourceMismatch[],
): BgPowerVerdictResult {
  const reasons: string[] = [];

  if (snap.error !== null) reasons.push(`Okuma hatası: ${snap.error}`);

  const gate = snap.gate;
  if (gate === null || gate.started !== true) {
    reasons.push('Kapı kurulu değil — arka planda kısma UYGULANMAZ.');
    return { status: 'NOT_STARTED', reasons };
  }

  if (mismatches.length > 0) {
    for (const m of mismatches) reasons.push(`${m.topic}: ${m.aValue} ↔ ${m.bValue}`);
    return { status: 'DRIFT', reasons };
  }

  const decision = gate.lastApplied;
  if (decision === null) {
    reasons.push('Kapı kurulu ama hiç karar uygulanmadı (girdi değişimi gelmemiş).');
    return { status: 'IDLE', reasons };
  }

  reasons.push(BG_REASON_LABEL[decision.reason]);
  reasons.push(`Uygulanan karar sayısı: ${gate.appliedCount}`);

  if (decision.gps === 'low' || decision.mic === 'off') {
    return { status: 'THROTTLED', reasons };
  }
  return { status: 'FULL_POWER', reasons };
}

/**
 * connectivityAuthority.ts — CAROS F7 · KANONİK bağlantı otoritesi (runtime).
 *
 * ── TEK GERÇEK SAHİBİ ───────────────────────────────────────────────────────
 * CarOS'ta "internet var mı" sorusunun TEK cevabı buradan çıkar. Wi-Fi,
 * Ethernet, Phone Link, Capacitor ve `navigator.onLine` yalnız KANIT üretir;
 * hiçbiri kendi başına otorite DEĞİLDİR. Hüküm SAF katmandadır
 * (`connectivityEvidence.ts`); bu dosya yalnız kanıtları TOPLAR ve dağıtır.
 *
 * ── AUTHORITY ≠ NETWORK MANAGER (§2) ────────────────────────────────────────
 * Burada Wi-Fi/Bluetooth/hotspot AÇILMAZ-KAPATILMAZ, ağ SEÇİLMEZ, route/DNS/
 * proxy/VPN DEĞİŞTİRİLMEZ. F6'nın yasası korunur: CarOS "internet yok" der,
 * "o zaman ben açayım" DEMEZ.
 *
 * ── OLAY TABANLI, TIMER YOK (§12/§13/§34) ───────────────────────────────────
 * Tek kaynaklar: Android `NetworkCallback` (native), Capacitor
 * `networkStatusChange`, tarayıcı `online`/`offline` olayları ve F5 gateway
 * kanıtı. `setInterval`, periyodik ping/fetch, speedtest, DNS probe ve
 * watchdog YOKTUR. Kanıt yaşı OKUMA ANINDA hesaplanır — scheduler gerekmez.
 *
 * ── FAIL-CLOSED (§23) ───────────────────────────────────────────────────────
 * Başlatılamazsa, gözlemci düşerse veya kanıt yoksa hüküm `UNKNOWN`'dır.
 * "Gözlemci patladı → herhalde ONLINE" ASLA olmaz.
 *
 * ── AKTİF AĞ SEMANTİĞİ (§27) ────────────────────────────────────────────────
 * Android adaptörü `NET_CAPABILITY_INTERNET` isteğiyle kayıtlıdır ve
 * `onCapabilitiesChanged` ile AKTİF/varsayılan ağın yeteneklerini bildirir.
 * Yani "herhangi bir ağ doğrulanmış" değil, "uygulamanın kullandığı yol"
 * hakkında konuşuruz. Platform ne kadarını kanıtlıyorsa o kadar iddia edilir:
 * Ethernet doğrulanmışken Wi-Fi captive ise hüküm aktif yola göre çıkar.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  deriveConnectivitySnapshot, evidenceFromFacts, evidenceFromBrowserHint,
  evidenceFromCapacitorNetwork, UNKNOWN_SNAPSHOT,
  type ConnectivityEvidence, type ConnectivityEvidenceSource,
  type ConnectivitySnapshot, type ConnectivityTransport, type NetworkFacts,
} from './connectivityEvidence';

/* ══════════════════════════════════════════════════════════════════════════
 * Native gözlemci köprüsü — F5'in ZATEN kaydettiği eklenti (ikinci native YOK)
 * ════════════════════════════════════════════════════════════════════════ */

interface NetworkFactsRaw {
  present?: unknown;
  transport?: unknown;
  hasInternetCapability?: unknown;
  validated?: unknown;
  captivePortal?: unknown;
  metered?: unknown;
  downstreamKbps?: unknown;
  upstreamKbps?: unknown;
}

interface NetworkObserverPlugin {
  start(): Promise<{ observing: boolean; reason?: string }>;
  stop(): Promise<{ observing: boolean }>;
  getFacts(): Promise<NetworkFactsRaw & { observing?: boolean }>;
  addListener(
    eventName: 'networkFacts',
    listener: (facts: NetworkFactsRaw) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

/**
 * ⚠️ F5 ile AYNI native eklenti. İsmi tarihseldir (`PhoneInternetObserver`)
 * ama davranışı GENERİKTİR: `ConnectivityManager` üzerinden AKTİF ağın
 * yeteneklerini bildirir, Phone Link'e özgü hiçbir şey yapmaz. İkinci bir
 * native gözlemci EKLENMEDİ; sahipliği F7 devraldı (bkz. F5 entegrasyonu).
 *
 * ── TEMBEL KAYIT (ölçülmüş regresyon) ───────────────────────────────────────
 * `registerPlugin` MODÜL KAPSAMINDA çağrılmaz. İki ölçülmüş sebep:
 *  1. Bu modülü içe aktaran her tüketici, `@capacitor/core`u KISMİ mock'layan
 *     mevcut testlerde import aşamasında çökerdi (F6.2'de aynı sınıf hata).
 *  2. "web'de Android eklentisi materyalize edilmez" kilidi bozulurdu.
 * Eklenti YALNIZ native platformda, adaptör bağlanırken oluşturulur.
 */
let _observerPlugin: NetworkObserverPlugin | null = null;

function networkObserver(): NetworkObserverPlugin {
  if (_observerPlugin === null) {
    _observerPlugin = registerPlugin<NetworkObserverPlugin>('PhoneInternetObserver');
  }
  return _observerPlugin;
}

const TRANSPORTS: ReadonlySet<string> = new Set([
  'WIFI', 'ETHERNET', 'CELLULAR', 'BLUETOOTH', 'USB', 'VPN', 'UNKNOWN',
]);

/** Katı doğrulama — eksik/bozuk alan UYDURULMAZ, `null`/`UNKNOWN` olur. */
export function parseNetworkFacts(raw: NetworkFactsRaw): NetworkFacts {
  if (raw === null || typeof raw !== 'object' || raw.present !== true) {
    return Object.freeze({
      present: false, transport: 'UNKNOWN' as const, hasInternetCapability: false,
      validated: null, captivePortal: null, metered: null,
      downstreamKbps: -1, upstreamKbps: -1,
    });
  }
  const tri = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
  const kbps = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : -1);
  const transport = typeof raw.transport === 'string' && TRANSPORTS.has(raw.transport)
    ? raw.transport as ConnectivityTransport
    : 'UNKNOWN';
  return Object.freeze({
    present: true,
    transport,
    hasInternetCapability: raw.hasInternetCapability === true,
    validated: tri(raw.validated),
    captivePortal: tri(raw.captivePortal),
    metered: tri(raw.metered),
    downstreamKbps: kbps(raw.downstreamKbps),
    upstreamKbps: kbps(raw.upstreamKbps),
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kanıt deposu — kaynak başına EN SON kanıt (sınırlı, O(1))
 * ════════════════════════════════════════════════════════════════════════ */

const _evidence = new Map<ConnectivityEvidenceSource, ConnectivityEvidence>();
const _subscribers = new Set<(snapshot: ConnectivitySnapshot) => void>();

let _snapshot: ConnectivitySnapshot = UNKNOWN_SNAPSHOT;
let _lastTransitionReason: ConnectivityEvidenceSource | null = null;
let _transitionCount = 0;

/**
 * Anlık kanonik hüküm. O(1), yan etkisiz, dondurulmuş.
 *
 * ── HİÇ KANIT YOKKEN ESKİ GÜVENLİK AĞI KORUNUR (§37) ────────────────────────
 * Hiçbir adaptör kanıt üretmemişse (otorite henüz başlatılmadı ya da platform
 * hiçbirini sağlamıyor) tarayıcının AÇIK çevrimdışı bildirimi son bir güvenlik
 * ağı olarak OKUMA ANINDA değerlendirilir. Migrasyondan önce her tüketici
 * `navigator.onLine === false` iken işi atlıyordu; bu davranış AYNEN korunur.
 *
 * Bu ipucu hiçbir koşulda `ONLINE` ÜRETMEZ — yalnız açık bir `OFFLINE`
 * bildirimini taşır (bkz. `evidenceFromBrowserHint`). Durum yazılmaz, yalnız
 * okunur: yan etki YOKTUR.
 */
export function getConnectivitySnapshot(): ConnectivitySnapshot {
  if (_evidence.size === 0
    && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return deriveConnectivitySnapshot(
      [evidenceFromBrowserHint(false, Date.now())], Date.now());
  }
  return _snapshot;
}

/**
 * Hüküm değişimine abone olur.
 *
 * · Aynı fonksiyon iki kez eklenirse TEK kayıt olur (Set semantiği).
 * · Dönen fonksiyon deterministik söker; sökülen abone bir daha ÇAĞRILMAZ.
 * · Bir abonenin fırlattığı hata DİĞERLERİNİ ETKİLEMEZ.
 * · React'e bağlı değildir; UI yalnız tüketicidir, otorite DEĞİL.
 */
export function subscribeConnectivity(
  listener: (snapshot: ConnectivitySnapshot) => void,
): () => void {
  _subscribers.add(listener);
  return () => { _subscribers.delete(listener); };
}

function recompute(nowMs: number): void {
  const next = deriveConnectivitySnapshot(Array.from(_evidence.values()), nowMs);
  const changed = next.state !== _snapshot.state
    || next.source !== _snapshot.source
    || next.validated !== _snapshot.validated
    || next.captivePortal !== _snapshot.captivePortal
    || next.metered !== _snapshot.metered
    || next.transport !== _snapshot.transport;
  _snapshot = next;
  if (!changed) return;

  _transitionCount += 1;
  _lastTransitionReason = next.source;
  _subscribers.forEach((fn) => {
    try { fn(next); } catch { /* abone hatası otoriteyi ve diğerlerini BOZMAZ */ }
  });
}

/**
 * TEK kanıt yutma noktası. Adaptörler ve F5 gateway buradan geçer.
 *
 * Yeni bir kaynak eklemek KANIT eklemektir — otorite eklemek DEĞİL.
 */
export function ingestConnectivityEvidence(evidence: ConnectivityEvidence): void {
  _evidence.set(evidence.source, evidence);
  recompute(evidence.observedAt);
}

/** Bir kaynağın kanıtını düşürür (gözlemci söküldü / ilişki bitti). */
export function dropConnectivityEvidence(
  source: ConnectivityEvidenceSource, nowMs: number = Date.now(),
): void {
  if (_evidence.delete(source)) recompute(nowMs);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Adaptörler — hepsi olay tabanlı
 * ════════════════════════════════════════════════════════════════════════ */

let _disposers: Array<() => void> = [];
let _observerOwned = false;

/** Native ağ gerçeklerini kanıt olarak yutar; F5'e de aynı gerçekleri verir. */
const _factsConsumers = new Set<(facts: NetworkFacts) => void>();

/**
 * F5 gateway (ve gelecekteki diğer kanıt üreticileri) ham ağ gerçeklerini
 * BURADAN alır — kendi native gözlemcisini AÇMAZ. Böylece tek bir
 * `NetworkCallback` kaydı olur ve iki sahip birbirinin gözlemini kapatamaz.
 */
export function subscribeNetworkFacts(
  listener: (facts: NetworkFacts) => void,
): () => void {
  _factsConsumers.add(listener);
  return () => { _factsConsumers.delete(listener); };
}

function publishFacts(facts: NetworkFacts, nowMs: number): void {
  ingestConnectivityEvidence(evidenceFromFacts({
    source: 'ANDROID_NETWORK_CALLBACK',
    facts,
    observedAt: nowMs,
    /* Callback tabanlı → YENİSİ GELENE KADAR geçerli (zamanla bayatlamaz). */
    continuous: true,
  }));
  _factsConsumers.forEach((fn) => {
    try { fn(facts); } catch { /* tüketici hatası otoriteyi BOZMAZ */ }
  });
}

/** @internal — native olay ve testler için TEK giriş. */
export function ingestNetworkFactsRaw(
  raw: NetworkFactsRaw, nowMs: number = Date.now(),
): void {
  publishFacts(parseNetworkFacts(raw), nowMs);
}

/**
 * Android adaptörü. Gözlemciyi AÇAR ve uygulama ömrü boyunca AÇIK TUTAR —
 * kanonik gerçeğin sahibi sürekli gözlemek ZORUNDADIR. Tek bir
 * `NetworkCallback` kaydıdır: timer yok, thread yok, yoklama yok.
 *
 * ── SOĞUK AÇILIŞ (§25) ──────────────────────────────────────────────────────
 * Dinleyici bağlandıktan SONRA tek atışlık `getFacts()` çekilir; bu sayede
 * açılışta ZATEN doğrulanmış bir ağ varsa otorite sonsuza dek `UNKNOWN`
 * kalmaz. Bu bir YOKLAMA DEĞİLDİR — yalnız bir kez okunur.
 */
async function attachAndroidAdapter(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const handle = await networkObserver()
    .addListener('networkFacts', (raw) => { ingestNetworkFactsRaw(raw); })
    .catch(() => null);
  if (handle === null) return;          // eklenti yok → fail-soft, UNKNOWN kalır
  _disposers.push(() => { void handle.remove(); });

  const started = await networkObserver().start().catch(() => null);
  if (started?.observing !== true) {
    /* Sahte gözlem İDDİA EDİLMEZ; hüküm UNKNOWN kalır (fail-closed). */
    return;
  }
  _observerOwned = true;
  _disposers.push(() => {
    _observerOwned = false;
    void networkObserver().stop().catch(() => {});
    /* Gözlem bittiyse kanıt da düşer — bayat "hâlâ online" TAŞINMAZ. */
    dropConnectivityEvidence('ANDROID_NETWORK_CALLBACK');
  });

  /* Soğuk açılış anlık görüntüsü — tek atışlık. */
  const facts = await networkObserver().getFacts().catch(() => null);
  if (facts !== null) ingestNetworkFactsRaw(facts);
}

/**
 * Capacitor Network adaptörü — `connected` bilgisi verir, DOĞRULAMA vermez.
 * Bu yüzden en fazla `DEGRADED` üretir (bkz. `evidenceFromCapacitorNetwork`).
 */
async function attachCapacitorAdapter(): Promise<void> {
  const mod = await import('@capacitor/network').catch(() => null);
  if (mod === null) return;
  const { Network } = mod;

  const toTransport = (t: unknown): ConnectivityTransport => {
    switch (t) {
      case 'wifi': return 'WIFI';
      case 'cellular': return 'CELLULAR';
      case 'ethernet': return 'ETHERNET';
      default: return 'UNKNOWN';
    }
  };

  const handle = await Network.addListener('networkStatusChange', (status) => {
    ingestConnectivityEvidence(evidenceFromCapacitorNetwork({
      connected: status.connected === true,
      transport: toTransport(status.connectionType),
      observedAt: Date.now(),
    }));
  }).catch(() => null);
  if (handle !== null) _disposers.push(() => { void handle.remove(); });

  const status = await Network.getStatus().catch(() => null);
  if (status !== null) {
    ingestConnectivityEvidence(evidenceFromCapacitorNetwork({
      connected: status.connected === true,
      transport: toTransport(status.connectionType),
      observedAt: Date.now(),
    }));
  }
}

/**
 * Tarayıcı ipucu adaptörü — `navigator.onLine`ın TEK MEŞRU kullanım yeri.
 *
 * §20: uygulama kodunda doğrudan `navigator.onLine` okumak yasaktır; yalnız
 * bu SINIR KATMANI onu kanonik kanıta çevirir ve kanıt en fazla `OFFLINE`
 * üretebilir — `ONLINE` ASLA.
 */
function attachBrowserHintAdapter(): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

  const publish = (): void => {
    ingestConnectivityEvidence(evidenceFromBrowserHint(navigator.onLine !== false, Date.now()));
  };
  const onOnline = () => publish();
  const onOffline = () => publish();
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  _disposers.push(() => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  });
  publish();
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yaşam döngüsü — kanonik boot'tan sürülür (§24)
 * ════════════════════════════════════════════════════════════════════════ */

let _started = false;

function disposeAuthority(): void {
  for (const dispose of _disposers) {
    try { dispose(); } catch { /* sökülme hatası diğerlerini engellemez */ }
  }
  _disposers = [];
  _started = false;
  _observerOwned = false;
}

/**
 * Kanonik otoriteyi başlatır. İdempotenttir (ikinci çağrı önce eskisini söker);
 * timer KURMAZ. Dönen fonksiyon sahipliği çağırana verir (SystemBoot LIFO).
 */
export function startConnectivityAuthority(): () => void {
  disposeAuthority();
  _started = true;

  /* Ucuz ve senkron olan ipucu ÖNCE bağlanır — soğuk açılışta bile en az bir
     kanıt bulunur (yine de `ONLINE` üretemez). */
  attachBrowserHintAdapter();

  void (async () => {
    await attachAndroidAdapter();
    if (!_started) return;
    await attachCapacitorAdapter();
  })();

  return disposeAuthority;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Gözlemlenebilirlik (§35) — SIR TAŞIMAZ
 * ════════════════════════════════════════════════════════════════════════ */

export interface ConnectivityTelemetry {
  readonly snapshot: ConnectivitySnapshot;
  readonly started: boolean;
  readonly observerOwned: boolean;
  readonly subscriberCount: number;
  readonly transitionCount: number;
  readonly lastTransitionSource: ConnectivityEvidenceSource | null;
  readonly sources: readonly ConnectivityEvidenceSource[];
}

/**
 * LAB salt-okunur. SSID, BSSID, IP, kimlik bilgisi, token ve parmak izi
 * TAŞIMAZ — bu katman zaten hiçbirini bilmez.
 */
export function getConnectivityTelemetry(): ConnectivityTelemetry {
  return Object.freeze({
    snapshot: _snapshot,
    started: _started,
    observerOwned: _observerOwned,
    subscriberCount: _subscribers.size,
    transitionCount: _transitionCount,
    lastTransitionSource: _lastTransitionReason,
    sources: Object.freeze(Array.from(_evidence.keys())),
  });
}

/** @internal — yalnız testler. */
export function _resetConnectivityAuthorityForTest(): void {
  disposeAuthority();
  _evidence.clear();
  _subscribers.clear();
  _factsConsumers.clear();
  _snapshot = UNKNOWN_SNAPSHOT;
  _lastTransitionReason = null;
  _transitionCount = 0;
}

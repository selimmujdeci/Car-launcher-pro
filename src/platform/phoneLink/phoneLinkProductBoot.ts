/**
 * phoneLinkProductBoot.ts — PHONE LINK F6.2 · ÜRÜN AÇILIŞI (tek sahip).
 *
 * ── F6.1'DE ÖLÇÜLEN İKİ ÜRÜN BOŞLUĞUNU KAPATIR ──────────────────────────────
 *  1. Phone Link'in native aktivasyonu YALNIZ LAB ekranındaki "Server'ı Başlat"
 *     düğmesinden geliyordu (`PhoneHubLinkScreen.tsx`).
 *  2. F5'in `initPhoneInternetGatewayLifecycle()`i üretimde HİÇ çağrılmıyordu.
 * Bu modül ikisini de kanonik ürün açılışına bağlar. LAB artık yalnız TEŞHİS
 * yüzeyidir; ürünün çalışması için ORAYA GİRMEK GEREKMEZ.
 *
 * ── YENİ OTORİTE YOK ────────────────────────────────────────────────────────
 * Burada yeni transport, yeni RFCOMM controller, yeni reconnect motoru, yeni
 * lifecycle ve yeni ayar sistemi KURULMAZ. Var olan kanonik çağrılar
 * (`startPhoneHubServer`, `initPhoneHubLinkStateBridge`, `initPhoneLinkLifecycle`,
 * `initPhoneInternetGatewayLifecycle`, `initPhoneIntegrationOwnershipLifecycle`)
 * DOĞRU SIRAYLA ve İDEMPOTENT biçimde sürülür.
 *
 * ── "HAZIRLAMAK" ≠ "RADYOYU AÇMAK" (F6.2 madde 4) ───────────────────────────
 * Açılış; dinleyici kurar, yaşam döngüsü adaptörlerini bağlar ve MEVCUT
 * Bluetooth durumunu GÖZLEMLER. Bluetooth kapalıysa ya da izin verilmemişse
 * `WAITING_FOR_USER_CONNECTIVITY` durumunda DURUR:
 *
 *   · `BluetoothAdapter.enable()` ÇAĞRILMAZ
 *   · izin diyaloğu AÇILMAZ (açılışta kullanıcıyı sürprizlemez)
 *   · retry/watchdog döngüsü KURULMAZ
 *
 * Kullanıcı Bluetooth'u KENDİSİ açarsa, uygulamaya döndüğünde (Capacitor
 * `appStateChange` — deponun `obdService` ile AYNI olay birincili) hazırlık
 * YENİDEN değerlendirilir. Bluetooth durumu YOKLANMAZ (polling YOK).
 *
 * ── SIRA PAZARLIKSIZ (F6.2 madde 14) ────────────────────────────────────────
 *   1. native köprü + kanonik lifecycle dinleyicileri
 *   2. F5 gateway + F6 ownership yaşam döngüsü kayıtları
 *   3. mevcut native durumun kanonik SNAPSHOT'tan replay'i
 *   4. RFCOMM hazırlık değerlendirmesi (gerekiyorsa başlat)
 *   5. uygulama ön plana döndüğünde yeniden değerlendirme
 * Dinleyiciler sunucudan ÖNCE kurulur — ilk `ESTABLISHED` olayı KAÇMAZ.
 *
 * ── TRUST ÜRETMEZ ───────────────────────────────────────────────────────────
 * Ürün açılışı yalnız altyapıyı kullanılabilir yapar. Eşleştirme onayı,
 * 6 haneli doğrulama, güven kaydı ve yetenek verme zincirleri AYNEN
 * korunur; bu dosya hiçbirini üretmez, atlamaz veya hızlandırmaz.
 */

import { Capacitor } from '@capacitor/core';
import {
  getPhoneHubLink, refreshPhoneHubLink, startPhoneHubServer,
  initPhoneHubLinkStateBridge, ingestPhoneHubLinkStateEvent,
  type PhoneHubLinkSnapshotRaw,
} from '../phoneHub/phoneHubLink';
import { classifyPhoneAttachment } from './phoneLinkAttachment';
import { initPhoneLinkLifecycle } from './phoneLinkLifecycle';
import { initPhoneLinkApplicationBridge } from './phoneLinkApplicationIngress';
import { initPhoneInternetGatewayLifecycle } from './phoneLinkInternetGateway';
import { initPhoneIntegrationOwnershipLifecycle } from './phoneIntegrationOwnership';

/* ══════════════════════════════════════════════════════════════════════════
 * Durum sözleşmesi
 * ════════════════════════════════════════════════════════════════════════ */

export type PhoneLinkProductBootState =
  /** Hiç başlatılmadı. */
  | 'NOT_STARTED'
  /** Dinleyiciler/adaptörler kuruldu; taşıma henüz değerlendirilmedi. */
  | 'INITIALIZED'
  /** Bluetooth kapalı veya izin verilmemiş — CarOS BEKLER, AÇMAZ. */
  | 'WAITING_FOR_USER_CONNECTIVITY'
  /** Cihazda Bluetooth donanımı yok — açılacak bir şey de yok. */
  | 'TRANSPORT_UNAVAILABLE'
  /** Kanonik RFCOMM sunucusu dinlemeye hazır/başlatıldı. */
  | 'READY';

export type PhoneLinkProductBootReason =
  | 'not_started'
  | 'listeners_attached'
  | 'bluetooth_disabled'
  | 'bluetooth_permission_withheld'
  | 'bluetooth_unavailable'
  | 'precondition_blocked'
  | 'native_bridge_absent'
  | 'server_already_listening'
  | 'server_started'
  | 'server_start_failed';

/* ══════════════════════════════════════════════════════════════════════════
 * Saf değerlendirme — SNAPSHOT'tan karar (yan etkisiz, testlenebilir)
 * ════════════════════════════════════════════════════════════════════════ */

export interface TransportReadinessDecision {
  /** Kanonik `startPhoneHubServer()` çağrılmalı mı. */
  readonly shouldStartServer: boolean;
  readonly state: PhoneLinkProductBootState;
  readonly reason: PhoneLinkProductBootReason;
}

/**
 * Kanonik anlık görüntüden RFCOMM hazırlık kararı. SAF.
 *
 * ── İZİN DİYALOĞU AÇILMAZ ───────────────────────────────────────────────────
 * Native `startServer()` izin yoksa sistem diyaloğu AÇAR. Açılışta bu bir
 * sürprizdir, bu yüzden `connectPermission !== true` iken çağrı HİÇ YAPILMAZ
 * ve durum `WAITING_FOR_USER_CONNECTIVITY` kalır. İzin, mevcut izin akışından
 * (MainActivity açılış izinleri / LAB) gelir — bu modül izin İSTEMEZ.
 *
 * ── FAIL CLOSED ─────────────────────────────────────────────────────────────
 * Bilinmeyen/ölçülmemiş her durum "başlatma" DEĞİL "bekle"dir.
 */
export function evaluateTransportReadiness(
  raw: PhoneHubLinkSnapshotRaw,
): TransportReadinessDecision {
  if (!raw?.present) {
    /* Native köprü yok (tarayıcı/test) — sahte hazırlık İDDİA EDİLMEZ. */
    return {
      shouldStartServer: false,
      state: 'INITIALIZED',
      reason: 'native_bridge_absent',
    };
  }

  /* Sunucu ZATEN dinliyorsa ikinci kez başlatılmaz (idempotentlik). */
  if (raw.server?.running === true || raw.server?.state === 'LISTENING') {
    return {
      shouldStartServer: false,
      state: 'READY',
      reason: 'server_already_listening',
    };
  }

  const pre = raw.preconditions;
  const blocker = typeof pre?.blockerCode === 'string' ? pre.blockerCode : null;

  if (blocker === 'BLUETOOTH_DISABLED') {
    return {
      shouldStartServer: false,
      state: 'WAITING_FOR_USER_CONNECTIVITY',
      reason: 'bluetooth_disabled',
    };
  }
  if (blocker === 'BLUETOOTH_PERMISSION_REQUIRED' || blocker === 'BLUETOOTH_PERMISSION_DENIED') {
    return {
      shouldStartServer: false,
      state: 'WAITING_FOR_USER_CONNECTIVITY',
      reason: 'bluetooth_permission_withheld',
    };
  }
  if (blocker === 'BLUETOOTH_UNAVAILABLE') {
    return {
      shouldStartServer: false,
      state: 'TRANSPORT_UNAVAILABLE',
      reason: 'bluetooth_unavailable',
    };
  }
  if (blocker !== null) {
    return {
      shouldStartServer: false,
      state: 'WAITING_FOR_USER_CONNECTIVITY',
      reason: 'precondition_blocked',
    };
  }

  /* İzin açıkça ölçülmediyse çağrı YAPILMAZ — diyalog açtırmayız. */
  if (pre?.connectPermission !== true) {
    return {
      shouldStartServer: false,
      state: 'WAITING_FOR_USER_CONNECTIVITY',
      reason: 'bluetooth_permission_withheld',
    };
  }
  if (pre?.ready !== true) {
    return {
      shouldStartServer: false,
      state: 'WAITING_FOR_USER_CONNECTIVITY',
      reason: 'precondition_blocked',
    };
  }

  return { shouldStartServer: true, state: 'READY', reason: 'server_started' };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Native → JS mevcut durum replay'i (F6.2 madde 9/10)
 * ════════════════════════════════════════════════════════════════════════ */

export type PhoneLinkReplayOutcome =
  | 'no_snapshot'
  | 'not_established'
  | 'replayed'
  | 'rejected_by_ingress';

/**
 * Native'de ZATEN kurulu bir oturum varken JS katmanı yeniden bağlandığında
 * (Activity recreation / WebView reload) kanonik gerçeği yaşam döngüsüne taşır.
 *
 * ── UYDURMA YOK (F6.2 madde 10) ─────────────────────────────────────────────
 * Yeni oturum kimliği, yeni nesil veya sahte `ESTABLISHED` ÜRETİLMEZ. Olay
 * TAMAMEN native `LinkSession` gerçeğinden (`getSnapshot()` → `classifyPhoneAttachment`)
 * türetilir ve F1'in ZATEN kullandığı `deriveUserState` merdiveninden geçer:
 * yalnız `trulyEstablished` bir oturum `ACTIVE` sayılır.
 *
 * ── GÜVENLİK ────────────────────────────────────────────────────────────────
 * Olay, kanonik yutma noktasından (`ingestPhoneHubLinkStateEvent`) geçer; F4'ün
 * nesil/dedupe kapıları AYNEN uygulanır. Bayat nesil YENİ oturumu öldüremez,
 * kopmuş oturum DİRİLTİLEMEZ, yetki/güven ÜRETİLMEZ.
 *
 * Kurulu olmayan her durumda HİÇBİR olay yayılmaz (fail-closed): sahte bir
 * `DISCONNECTED` üretmek de bir iddiadır ve yapılmaz.
 */
export function replayCurrentLinkState(
  raw: PhoneHubLinkSnapshotRaw = getPhoneHubLink(),
): PhoneLinkReplayOutcome {
  if (!raw?.present) return 'no_snapshot';

  const snap = classifyPhoneAttachment(raw);
  if (snap.state !== 'ACTIVE' || snap.sessionEpoch === null || snap.deviceFingerprint === null) {
    return 'not_established';
  }

  const accepted = ingestPhoneHubLinkStateEvent({
    protocolVersion: 1,
    state: 'ESTABLISHED',
    sessionEpoch: snap.sessionEpoch,
    deviceFingerprint: snap.deviceFingerprint,
    /* Gerekçe UYDURULMAZ: bu bir geçiş değil, mevcut gerçeğin taşınmasıdır. */
    reason: 'UNKNOWN',
  });
  return accepted ? 'replayed' : 'rejected_by_ingress';
}

/* ══════════════════════════════════════════════════════════════════════════
 * Gözlemlenebilirlik (F6.2 madde 19) — sır TAŞIMAZ
 * ════════════════════════════════════════════════════════════════════════ */

export interface PhoneLinkProductBootTelemetry {
  readonly state: PhoneLinkProductBootState;
  readonly reason: PhoneLinkProductBootReason;
  readonly listenersAttached: boolean;
  readonly gatewayLifecycleRegistered: boolean;
  readonly ownershipLifecycleRegistered: boolean;
  readonly lastReplayOutcome: PhoneLinkReplayOutcome | null;
  readonly readinessEvaluations: number;
}

const _telemetry = {
  state: 'NOT_STARTED' as PhoneLinkProductBootState,
  reason: 'not_started' as PhoneLinkProductBootReason,
  listenersAttached: false,
  gatewayLifecycleRegistered: false,
  ownershipLifecycleRegistered: false,
  lastReplayOutcome: null as PhoneLinkReplayOutcome | null,
  readinessEvaluations: 0,
};

/** LAB salt-okunur — parmak izi, token, epoch, kripto materyali TAŞIMAZ. */
export function getPhoneLinkProductBootTelemetry(): PhoneLinkProductBootTelemetry {
  return Object.freeze({ ..._telemetry });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Hazırlık değerlendirmesi — olay tetiklemeli, POLLING YOK
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Taşıma hazırlığını BİR KEZ değerlendirir ve gerekiyorsa kanonik sunucuyu
 * başlatır. İdempotenttir: sunucu zaten dinliyorsa ikinci başlatma YOK.
 *
 * Hiçbir timer/retry KURMAZ — çağrı yalnız gerçek bir olayda yapılır
 * (ürün açılışı veya uygulamanın ön plana dönmesi).
 */
export async function evaluatePhoneLinkTransportReadiness(): Promise<TransportReadinessDecision> {
  _telemetry.readinessEvaluations += 1;

  const raw = await refreshPhoneHubLink().catch(() => getPhoneHubLink());
  const decision = evaluateTransportReadiness(raw);

  if (!decision.shouldStartServer) {
    _telemetry.state = decision.state;
    _telemetry.reason = decision.reason;
    return decision;
  }

  const result = await startPhoneHubServer().catch(() => null);
  if (result === null || !result.ok) {
    _telemetry.state = 'WAITING_FOR_USER_CONNECTIVITY';
    _telemetry.reason = 'server_start_failed';
    return {
      shouldStartServer: true,
      state: 'WAITING_FOR_USER_CONNECTIVITY',
      reason: 'server_start_failed',
    };
  }
  _telemetry.state = 'READY';
  _telemetry.reason = 'server_started';
  return decision;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Ürün açılışı — TEK sahip, idempotent
 * ════════════════════════════════════════════════════════════════════════ */

let _disposers: Array<() => void> = [];
let _started = false;

function disposeProductBoot(): void {
  for (const dispose of _disposers) {
    try { dispose(); } catch { /* sökülme hatası diğerlerini engellemez */ }
  }
  _disposers = [];
  _started = false;
  _telemetry.listenersAttached = false;
  _telemetry.gatewayLifecycleRegistered = false;
  _telemetry.ownershipLifecycleRegistered = false;
  _telemetry.state = 'NOT_STARTED';
  _telemetry.reason = 'not_started';
}

/**
 * Uygulamanın ön plana dönüşünü dinler — kullanıcı Bluetooth'u AYARLARDAN
 * açıp geri döndüğünde hazırlık YENİDEN değerlendirilir.
 *
 * Bu bir YOKLAMA DEĞİLDİR: deponun `obdService`te zaten kullandığı Capacitor
 * `appStateChange` olayıdır, tek atışlıktır ve timer KURMAZ. Native olmayan
 * ortamda (tarayıcı/test) hiç kurulmaz.
 */
function attachForegroundReevaluation(): void {
  if (!Capacitor.isNativePlatform()) return;
  let disposed = false;
  void import('@capacitor/app')
    .then(({ App: CapApp }) => CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void evaluatePhoneLinkTransportReadiness();
    }))
    .then((handle) => {
      if (disposed) { void handle.remove(); return; }
      _disposers.push(() => { void handle.remove(); });
    })
    .catch(() => { /* eski plugin → fail-soft, ürün davranışı değişmez */ });
  _disposers.push(() => { disposed = true; });
}

/**
 * PHONE LINK ÜRÜN AÇILIŞI — kanonik boot'tan çağrılır.
 *
 * İdempotenttir: ikinci çağrı önce var olan tüm kayıtları söker (Activity
 * recreation'da ikinci controller/sunucu/dinleyici/NetworkCallback OLUŞMAZ).
 * Dönen fonksiyon sahipliği çağırana verir (SystemBoot LIFO temizliği).
 */
export function startPhoneLinkProductBoot(): () => void {
  disposeProductBoot();
  _started = true;

  /* 1) Dinleyiciler SUNUCUDAN ÖNCE — ilk ESTABLISHED olayı kaçmasın. */
  _disposers.push(initPhoneHubLinkStateBridge());
  _disposers.push(initPhoneLinkLifecycle());
  /* F8 DENETİM BULGUSU: uygulama-mesajı ingress'i (F2 — guest music komutları
     VE F8 nav destination push) daha önce ÜRETİMDE HİÇBİR YERDEN çağrılmıyordu
     (yalnız testler çağırıyordu). Bu, F1/F2'nin kendi üretim boşluğuydu; F8
     bu tek ingress'e bağımlı olduğu için burada kapatıldı — ikinci bir ingress
     KURULMADI, yalnız var olanın eksik kaydı tamamlandı. */
  _disposers.push(initPhoneLinkApplicationBridge());
  _telemetry.listenersAttached = true;

  /* 2) F5 gateway + F6 ownership yaşam döngüleri (F6.1'de eksik olan kayıt). */
  _disposers.push(initPhoneInternetGatewayLifecycle());
  _telemetry.gatewayLifecycleRegistered = true;
  _disposers.push(initPhoneIntegrationOwnershipLifecycle());
  _telemetry.ownershipLifecycleRegistered = true;

  _telemetry.state = 'INITIALIZED';
  _telemetry.reason = 'listeners_attached';

  /* 5) Ön plana dönüşte yeniden değerlendirme (Bluetooth sonradan açılabilir). */
  attachForegroundReevaluation();

  /* 3) + 4) Mevcut native gerçeğin replay'i, ardından hazırlık değerlendirmesi.
   * Sıra önemli: replay ÖNCE yapılır ki hazırlık değerlendirmesi (ve onun
   * tetikleyebileceği olaylar) zaten bilinen oturumun ÜZERİNE gelsin. */
  void (async () => {
    const raw = await refreshPhoneHubLink().catch(() => getPhoneHubLink());
    if (!_started) return;
    _telemetry.lastReplayOutcome = replayCurrentLinkState(raw);
    if (!_started) return;
    await evaluatePhoneLinkTransportReadiness();
  })();

  return disposeProductBoot;
}

/** @internal — yalnız testler. */
export function _resetPhoneLinkProductBootForTest(): void {
  disposeProductBoot();
  _telemetry.lastReplayOutcome = null;
  _telemetry.readinessEvaluations = 0;
}

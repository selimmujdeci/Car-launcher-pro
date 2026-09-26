/**
 * phoneIntegrationOwnership.ts — PHONE LINK F6.12/F6.13/F6.14/F6.1 · sahiplik efekt katmanı.
 *
 * Kararı `phoneIntegrationArbiter.derivePhoneIntegrationPolicy()` (SAF) verir;
 * bu modül yalnız o kararı TUTAR, geçişleri gözlemlenebilir kılar ve F4'ün
 * kopuş zincirine bağlar. Yeni bir karar kuralı BURADA YOKTUR.
 *
 * ── F6.1 — PRODUCTION ACTIVATION WIRING ─────────────────────────────────────
 * F6 kapanışında bulunan boşluk: `applyPhoneIntegrationOwnership()` doğru
 * politikayı üretiyordu ama ayar zaten AÇIKKEN Phone Link SONRADAN ACTIVE
 * olduğunda bunu SÜREN kanonik bir çağrı YOKTU. `reconcilePhoneIntegrationOwnership()`
 * bu TEK giriş noktasıdır — üç kaynaktan da (lifecycle olayı, ayar değişimi,
 * hydration tamamlanması) AYNI yola girilir; ikinci bir karar yolu YOKTUR.
 *
 * İkinci bir lifecycle/settings/arbiter/ownership OTORİTESİ KURULMADI: bu
 * dosya F4'ün `registerIntegrationOwnershipReleaser` deseninden,
 * `initPhoneHubLinkStateBridge`/`initPhoneLinkLifecycle`den ve kanonik
 * `useStore` ayar deposundan AYNEN faydalanır.
 *
 * ── TIMER/POLLING YOK (F6.17) ───────────────────────────────────────────────
 * DÖRT gerçek tetikleyici vardır ve hepsi OLAYDIR:
 *   1. Phone Link canonical lifecycle olayı (ESTABLISHED/ACTIVE)  → F4 zinciri
 *   2. Phone Link koptu (DISCONNECTED/FAILED)                      → F4 zinciri → release
 *   3. kullanıcı ayarı değiştirdi (`useStore.subscribe`)           → reconcile
 *   4. settings store hydration TAMAMLANDI (`persist.onFinishHydration`) → reconcile
 * Paket taraması, process taraması, "ZLink açık mı" yoklaması, Bluetooth
 * retry döngüsü ve `setTimeout`/`setInterval` tabanlı bekleme YOKTUR.
 * Phone Link yokken bu modül hiç çalışmaz.
 *
 * ── ÇÖKME/PROCESS ÖLÜMÜ GÜVENLİĞİ (F6.14) ───────────────────────────────────
 * Sahiplik YALNIZ bellekte tutulan bir politikadır ve tek gerçek etkisi
 * CarOS'un kendi ses/medya odağıdır — Android bunu process ölümünde
 * KENDİLİĞİNDEN serbest bırakır. Hiçbir kalıcı OEM durumu, hiçbir disk kaydı,
 * hiçbir sistem ayarı YAZILMAZ. Bu yüzden:
 *
 *   CarOS canlı değilse suppression YAPISAL OLARAK yoktur.
 *
 * Kurtarma rutini veya watchdog GEREKMEZ; olmadığı için de yazılmamıştır.
 * (Gelecekte kalıcı durum bırakan bir OEM API kullanılırsa BURAYA açık bir
 * startup/shutdown recovery eklenmelidir — bugün böyle bir API yok.)
 */

import {
  derivePhoneIntegrationPolicy, isOwnershipTransition, releasedPolicy,
  type ArbitrationReason, type PhoneIntegrationPolicy,
  type PhoneIntegrationResourceDomain, type ResourceOwnership,
} from './phoneIntegrationArbiter';
import {
  registerIntegrationOwnershipReleaser, initPhoneLinkLifecycle,
} from './phoneLinkLifecycle';
import { activeRuntimeSessionCount } from './phoneLinkSessionRegistry';
import { initPhoneHubLinkStateBridge } from '../phoneHub/phoneHubLink';
import { useStore } from '../../store/useStore';

let _policy: PhoneIntegrationPolicy = releasedPolicy();
let _lastTransitionReason: ArbitrationReason | null = null;
let _transitionCount = 0;

/** Şu anki sahiplik politikası (salt-okunur). */
export function getPhoneIntegrationPolicy(): PhoneIntegrationPolicy {
  return _policy;
}

export function getDomainOwnership(
  domain: PhoneIntegrationResourceDomain,
): ResourceOwnership {
  return _policy.ownership[domain];
}

/**
 * Kararı yeniden hesaplar ve uygular. İdempotenttir: sahiplik durumu
 * değişmediyse geçiş SAYILMAZ (gereksiz acquire/release yok).
 */
export function applyPhoneIntegrationOwnership(input: {
  readonly priorityEnabled: boolean;
  readonly phoneLinkActive: boolean;
}): PhoneIntegrationPolicy {
  const next = derivePhoneIntegrationPolicy(input);
  if (isOwnershipTransition(_policy, next)) {
    _transitionCount += 1;
    _lastTransitionReason = next.reason;
  } else if (_policy.reason !== next.reason) {
    /* Sahiplik aynı kaldı ama GEREKÇE değişti (ör. ayar kapandı ve zaten
       Phone Link pasifti) — gerekçe dürüstçe güncellenir, geçiş sayılmaz. */
    _lastTransitionReason = next.reason;
  }
  _policy = next;
  return _policy;
}

/**
 * Sahipliği ANINDA bırakır (F6.12 kullanıcı override + F6.13 disconnect).
 *
 * ⚠️ Phone Link bağlantısını KOPARMAZ ve rakip entegrasyonu BAŞLATMAZ —
 * yalnız alanları `AVAILABLE` yapar. Serbest bırakmak ≠ zorla başlatmak.
 */
export function releasePhoneIntegrationOwnership(): PhoneIntegrationPolicy {
  return applyPhoneIntegrationOwnership({ priorityEnabled: false, phoneLinkActive: false });
}

/* ══════════════════════════════════════════════════════════════════════════
 * F6.1 — TEK reconciliation giriş noktası
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Phone Link'in ŞU AN aktif olup olmadığı — F4'ün OLAY-tabanlı çalışma zamanı
 * indeksinden okunur (`activeRuntimeSessionCount()`), İKİNCİ bir "aktif mi"
 * hesaplaması KURULMAZ. Bu, F6.1'in "Ordering" kuralının aynısıdır: native
 * truth → F4 lifecycle ingestion → BU okuma.
 */
function isPhoneLinkCurrentlyActive(): boolean {
  return activeRuntimeSessionCount() > 0;
}

/**
 * TEK reconciliation girişi (F6.1 madde 15).
 *
 * Kanonik ayarı ve F4'ün canlılık indeksini okur, kararı YENİDEN üretir ve
 * uygular. Üç bağımsız tetikleyici (lifecycle olayı, ayar değişimi,
 * hydration) HEPSİ buraya girer — ikinci bir karar yolu YOKTUR. Saf
 * `applyPhoneIntegrationOwnership()`in ÜZERİNE hiçbir yeni kural EKLEMEZ,
 * yalnız girdiyi ("ayar" + "Phone Link aktif mi") kanonik kaynaklardan okur.
 */
export function reconcilePhoneIntegrationOwnership(): PhoneIntegrationPolicy {
  const priorityEnabled = useStore.getState().settings.carosConnectionPriorityEnabled;
  const phoneLinkActive = isPhoneLinkCurrentlyActive();
  return applyPhoneIntegrationOwnership({ priorityEnabled, phoneLinkActive });
}

/* ══════════════════════════════════════════════════════════════════════════
 * F4 kopuş zincirine kayıt + F6.1 production activation wiring
 * ════════════════════════════════════════════════════════════════════════ */

let _disposers: Array<() => void> = [];

function disposeOwnershipLifecycle(): void {
  for (const dispose of _disposers) {
    try { dispose(); } catch { /* sökülme hatası diğerlerini engellemez */ }
  }
  _disposers = [];
}

/**
 * Sahipliği F4 yaşam döngüsü zincirine bağlar VE F6.1 production activation
 * wiring'ini kurar. İdempotenttir (ikinci çağrı önce eskisini söker); timer
 * KURMAZ.
 *
 * DÖRT bağlantı, hepsi olay tabanlı:
 *   1. `initPhoneHubLinkStateBridge()` + `initPhoneLinkLifecycle()` — F4'ün
 *      native köprüsü ve kanonik olay zinciri (F1'den beri var olan
 *      otoriteler, YENİDEN üretilmedi; portal hiç açılmamış olsa bile bu
 *      çağrı sahipliğin kendi başına doğru çalışmasını sağlar).
 *   2. `registerIntegrationOwnershipReleaser` — ACTIVE geçişinde
 *      `reconcileOwnership()`, kopuşta `releaseIntegrationOwnership()`
 *      (F4 zinciri tarafından çağrılır; sıra ve idempotentlik zaten oradadır).
 *   3. `useStore.subscribe` — "CarOS Bağlantı Önceliği" değiştiğinde SENKRON
 *      reconcile (F6.1 madde 5/6): UI komponenti bunu SÜRMEZ, kanonik ayar
 *      deposunun KENDİSİ sürer.
 *   4. `useStore.persist.onFinishHydration` / `hasHydrated()` — kayıtlı
 *      tercih diskten okunduğunda (F6.1 madde 8) reconcile; polling/timeout
 *      YOK, zustand persist'in KENDİ tamamlanma birincili kullanılır.
 */
export function initPhoneIntegrationOwnershipLifecycle(): () => void {
  disposeOwnershipLifecycle();

  _disposers.push(initPhoneHubLinkStateBridge());
  _disposers.push(initPhoneLinkLifecycle());

  _disposers.push(registerIntegrationOwnershipReleaser({
    reconcileOwnership: async () => { reconcilePhoneIntegrationOwnership(); },
    releaseIntegrationOwnership: async () => { releasePhoneIntegrationOwnership(); },
  }));

  /* Ayar değişimini SENKRON izler — timer/polling YOK. Yalnız İLGİLİ alan
     değiştiyse reconcile edilir (ilgisiz ayar değişimi dokunmaz). */
  let prevPriority = useStore.getState().settings.carosConnectionPriorityEnabled;
  _disposers.push(useStore.subscribe((state) => {
    const next = state.settings.carosConnectionPriorityEnabled;
    if (next === prevPriority) return;
    prevPriority = next;
    reconcilePhoneIntegrationOwnership();
  }));

  /* Hydration ZATEN tamamlandıysa (kanonik depo senkron storage kullanıyor)
     anında reconcile; değilse zustand persist'in KENDİ tamamlanma olayına
     abone olunur — arbitrary timeout/retry YOK. */
  if (useStore.persist.hasHydrated()) {
    reconcilePhoneIntegrationOwnership();
  } else {
    _disposers.push(useStore.persist.onFinishHydration(() => {
      reconcilePhoneIntegrationOwnership();
    }));
  }

  return disposeOwnershipLifecycle;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Gözlemlenebilirlik (F6.18) — sır/paket ayrıntısı TAŞIMAZ
 * ════════════════════════════════════════════════════════════════════════ */

export interface PhoneIntegrationTelemetry {
  readonly exclusiveOwnershipHeld: boolean;
  readonly reason: ArbitrationReason;
  readonly lastTransitionReason: ArbitrationReason | null;
  readonly transitionCount: number;
  readonly ownership: Readonly<Record<PhoneIntegrationResourceDomain, ResourceOwnership>>;
  readonly suspendedIntegrationCount: number;
}

/**
 * LAB salt-okunur. Paket adı, kimlik bilgisi, token, parmak izi TAŞIMAZ —
 * zaten hiçbiri bu katmanda bilinmiyor.
 */
export function getPhoneIntegrationTelemetry(): PhoneIntegrationTelemetry {
  return Object.freeze({
    exclusiveOwnershipHeld: _policy.exclusiveOwnershipHeld,
    reason: _policy.reason,
    lastTransitionReason: _lastTransitionReason,
    transitionCount: _transitionCount,
    ownership: _policy.ownership,
    suspendedIntegrationCount: _policy.suspendedIntegrations.length,
  });
}

/** @internal — yalnız testler. */
export function _resetPhoneIntegrationOwnershipForTest(): void {
  disposeOwnershipLifecycle();
  _policy = releasedPolicy();
  _lastTransitionReason = null;
  _transitionCount = 0;
}

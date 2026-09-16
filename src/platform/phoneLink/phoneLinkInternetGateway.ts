/**
 * phoneLinkInternetGateway.ts — PHONE LINK F5 · Phone Internet Gateway.
 *
 * ── GATEWAY PAKET TAŞIMAZ ───────────────────────────────────────────────────
 * Bu bir POLİTİKA/ORKESTRASYON otoritesidir, bir veri düzlemi DEĞİLDİR.
 * İnternet paketlerini Android'in kendi network stack'i taşır; CarOS yalnız
 * "bu yol politika olarak kullanılabilir mi ve OS'a göre gerçekten çalışıyor
 * mu" sorusunu yanıtlar. Repoda VPN, proxy, SOCKS, DNS, NAT, userspace TCP/IP
 * veya paket yönlendirme KODU YOKTUR ve F5 bunların hiçbirini EKLEMEZ.
 *
 * ── RFCOMM = CONTROL PLANE (F5.9) ───────────────────────────────────────────
 * Phone Link'in şifreli RFCOMM kanalı yalnız küçük durum/kontrol mesajları
 * içindir. İnternet trafiği BU KANALDAN TÜNELLENMEZ — bu modül
 * `sendApplicationMessage` ile hiçbir veri yükü GÖNDERMEZ.
 *
 * ── AĞ SEÇİMİ YAPILMAZ (F5.7) ───────────────────────────────────────────────
 * Telefon bağlandı diye çalışan bir Ethernet/Wi-Fi bağlantısı BOZULMAZ.
 * Bu modülde `bindProcessToNetwork`, `setNetworkPreference`, `WifiManager`
 * bağlanma çağrısı veya herhangi bir ağ değiştirme yolu YOKTUR; öncelik
 * tamamen platformun kendi network authority'sine aittir.
 *
 * ── KULLANILMIYORSA MALİYET ≈ 0 (F5.16) ─────────────────────────────────────
 * Gözlemci YALNIZ açıkça başlatıldığında (`startPhoneInternetGateway`) kaydolur
 * ve durdurulduğunda TAMAMEN sökülür. Timer, polling, ping döngüsü, HTTP probe
 * ve hız testi YOKTUR. Telefon yokken durum `UNAVAILABLE` ve sistem tamamen
 * boştadır.
 *
 * ── F7 · ARTIK İKİNCİ BİR CONNECTIVITY OTORİTESİ DEĞİL ──────────────────────
 * Ham ağ gerçekleri (validated/captive/metered/transport) artık KANONİK
 * `ConnectivityAuthority`den gelir; bu modül kendi `NetworkCallback` kaydını
 * AÇMAZ. Böylece tek bir native gözlemci vardır ve iki sahip birbirinin
 * gözlemini kapatamaz. Bu modülün katkısı ham ağ değil, PROVENANCE +
 * POLİTİKADIR: "telefonla ilişkili bu yol, `INTERNET_SHARE` grant'ıyla
 * kullanılabilir mi". Ürettiği hüküm kanonik otoriteye `PHONE_LINK_GATEWAY`
 * kaynaklı KANIT olarak beslenir — global gerçeği o otorite belirler.
 *
 * ── LIFECYCLE F4 ÜZERİNE BİNER (F5.10) ──────────────────────────────────────
 * Phone Link kopunca F4'ün iptal zinciri `INTERNET_SHARE` grant'ını da düşürür
 * (grantlar oturum anahtarına göre iptal edilir, yeteneğe göre değil). Bu modül
 * o anda YALNIZ kendi oturum ilişkisini bırakır — **Android'in ağ bağlantısını
 * KAPATMAZ**. Kimlik/oturum yaşam döngüsü ile OS ağ yaşam döngüsü bilinçli
 * olarak AYRI tutulur: telefonun hotspot'una bağlı Wi-Fi'ı sistem hâlâ
 * kullanıyor olabilir ve bu bizim kararımız değildir.
 */

import { registerPlugin } from '@capacitor/core';
import {
  authorizePhoneInternetShare, issuePhoneInternetGrant,
  type PhoneLinkSessionRef,
} from './phoneLinkCapabilityGrant';
import {
  derivePhoneInternetEvidence, NO_NETWORK_FACTS,
  type PhoneInternetEvidence, type PhoneNetworkFacts,
} from './phoneLinkInternetPolicy';
import { registerInternetAssociationReleaser } from './phoneLinkLifecycle';
import {
  subscribeNetworkFacts, ingestConnectivityEvidence, dropConnectivityEvidence,
} from '../connectivity/connectivityAuthority';
import { evidenceFromFacts } from '../connectivity/connectivityEvidence';

/* ══════════════════════════════════════════════════════════════════════════
 * Native köprü — YALNIZ gözlem
 * ════════════════════════════════════════════════════════════════════════ */

/** Native'in taşıdığı HAM yük — doğrulanmadan kullanılmaz. */
export interface PhoneNetworkFactsRaw {
  present?: unknown;
  transport?: unknown;
  hasInternetCapability?: unknown;
  validated?: unknown;
  captivePortal?: unknown;
  metered?: unknown;
  downstreamKbps?: unknown;
  upstreamKbps?: unknown;
}

export interface PhoneInternetObserverPlugin {
  start(): Promise<{ observing: boolean; reason?: string }>;
  stop(): Promise<{ observing: boolean }>;
  getFacts(): Promise<PhoneNetworkFactsRaw & { observing?: boolean }>;
  addListener(
    eventName: 'networkFacts',
    listener: (facts: PhoneNetworkFactsRaw) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

export const PhoneInternetObserver =
  registerPlugin<PhoneInternetObserverPlugin>('PhoneInternetObserver');

const TRANSPORTS: ReadonlySet<string> = new Set([
  'WIFI', 'ETHERNET', 'CELLULAR', 'BLUETOOTH', 'USB', 'VPN', 'UNKNOWN',
]);

/** Katı doğrulama — eksik/bozuk alan UYDURULMAZ, bilinmiyor olarak taşınır. */
export function parseNetworkFacts(raw: PhoneNetworkFactsRaw): PhoneNetworkFacts {
  if (raw === null || typeof raw !== 'object' || raw.present !== true) {
    return NO_NETWORK_FACTS;
  }
  const transport = typeof raw.transport === 'string' && TRANSPORTS.has(raw.transport)
    ? raw.transport as PhoneNetworkFacts['transport']
    : 'UNKNOWN';
  /* Üç değerli alanlar: yalnız GERÇEK boolean kabul edilir; başka her şey
     `null` (bilinmiyor) olur — `false` VARSAYILMAZ. */
  const tri = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
  const kbps = (v: unknown): number =>
    (typeof v === 'number' && Number.isFinite(v) ? v : -1);

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
 * Modül durumu — YALNIZ gözlem önbelleği (global truth DEĞİL)
 * ════════════════════════════════════════════════════════════════════════ */

let _facts: PhoneNetworkFacts = NO_NETWORK_FACTS;
let _observing = false;
let _removeFactsListener: (() => void) | null = null;
let _lastReason: PhoneInternetEvidence['reason'] | null = null;

const _subscribers = new Set<(evidence: PhoneInternetEvidence) => void>();

/**
 * Kanıt değişimine abone olur (F4.4 ile AYNI desen: Set, deterministik
 * unsubscribe, patlayan abone diğerlerini bozmaz, timer YOK).
 */
export function subscribePhoneInternet(
  listener: (evidence: PhoneInternetEvidence) => void,
): () => void {
  _subscribers.add(listener);
  return () => { _subscribers.delete(listener); };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kanıt üretimi
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Şu ANKİ kanıt. Yan etkisizdir ve native'e GİTMEZ — politika her çağrıda
 * kanonik `authorize()`e yeniden sorulur, böylece oturum koptuğu an durum
 * kendiliğinden `UNAVAILABLE`a düşer (F4 deseniyle aynı: canlı doğrulama,
 * timer YOK).
 */
export function getPhoneInternetEvidence(
  session: PhoneLinkSessionRef | null = null,
  nowMs: number = Date.now(),
): PhoneInternetEvidence {
  const decision = authorizePhoneInternetShare('phone-internet-evidence', nowMs, session);
  return derivePhoneInternetEvidence({
    policyAllowed: decision.decision === 'ALLOW',
    facts: _facts,
  });
}

function emit(): void {
  const evidence = getPhoneInternetEvidence();
  _lastReason = evidence.reason;
  _subscribers.forEach((fn) => {
    try { fn(evidence); } catch { /* abone hatası köprüyü BOZMAZ */ }
  });
}

/** @internal — native olay ve testler için TEK yutma noktası. */
export function ingestNetworkFacts(raw: PhoneNetworkFactsRaw): void {
  _facts = parseNetworkFacts(raw);
  emit();
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yaşam döngüsü — açıkça başlat/durdur, arka planda kendiliğinden ÇALIŞMAZ
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * `INTERNET_SHARE` grant'ını ister ve (yalnız verilirse) ağ gözlemini açar.
 *
 * FAIL CLOSED: grant verilmezse gözlemci HİÇ başlatılmaz — yetkisiz bir
 * oturum için ağ dinlemeye bile başlamayız. Grant `issuePhoneInternetGrant()`
 * tarafından verilir ve yalnız kayıtlı GÜVENİLEN cihaz için mümkündür.
 */
export async function startPhoneInternetGateway(): Promise<PhoneInternetEvidence> {
  const grant = issuePhoneInternetGrant();
  if (grant === null) {
    await stopPhoneInternetGateway();
    return getPhoneInternetEvidence();
  }
  if (_observing) return getPhoneInternetEvidence();

  if (_removeFactsListener === null) {
    /* F7 — ham gerçekler KANONİK otoriteden gelir; burada ikinci bir native
       `NetworkCallback` AÇILMAZ (tek gözlemci, tek sahip). */
    _removeFactsListener = subscribeNetworkFacts((facts) => {
      _facts = facts;
      emit();
      publishGatewayEvidence();
    });
  }
  _observing = true;   // Phone Link internet İLİŞKİSİ aktif (gözlemci sahibi F7)
  emit();
  publishGatewayEvidence();
  return getPhoneInternetEvidence();
}

/**
 * F7 — bu yolun hükmünü kanonik otoriteye KANIT olarak besler.
 *
 * ⚠️ Global gerçeği BELİRLEMEZ: otorite bu kanıtı diğer kaynaklarla (ör.
 * doğrulanmış Ethernet) birlikte tartar. "Phone Link bağlı" TEK BAŞINA
 * `ONLINE` ÜRETMEZ; "Phone Link koptu" da global `OFFLINE` ÜRETMEZ.
 */
function publishGatewayEvidence(): void {
  const decision = authorizePhoneInternetShare('phone-internet-evidence');
  if (decision.decision !== 'ALLOW' || !_facts.present) {
    /* Politika izin vermiyorsa ya da yol yoksa bu kaynak hüküm ÜRETMEZ —
       kanıdı düşürmek, sahte bir hüküm bırakmaktan dürüsttür. */
    dropConnectivityEvidence('PHONE_LINK_GATEWAY');
    return;
  }
  ingestConnectivityEvidence(evidenceFromFacts({
    source: 'PHONE_LINK_GATEWAY',
    facts: _facts,
    observedAt: Date.now(),
    continuous: true,
  }));
}

/**
 * Gözlemi TAMAMEN söker ve ağ gerçeklerini bilinmiyor'a düşürür.
 *
 * ⚠️ Android'in ağ bağlantısını KAPATMAZ (F5.10) — yalnız BİZİM gözlemimizi
 * ve oturum ilişkimizi bırakır. Sistemin hangi ağı kullandığı bizim kararımız
 * değildir.
 */
export async function stopPhoneInternetGateway(): Promise<void> {
  _removeFactsListener?.();
  _removeFactsListener = null;
  _observing = false;
  /* F7 — KANONİK gözlemci DURDURULMAZ: o global otoritenin malıdır ve
     Phone Link kopsa bile CarOS'un ağ gerçeğini gözlemeye devam eder.
     Burada yalnız BİZİM ilişkimiz ve kanıdımız bırakılır. */
  dropConnectivityEvidence('PHONE_LINK_GATEWAY');
  /* Bayat gerçek TAŞINMAZ: gözlem bittiyse "hâlâ bağlıydı" DENMEZ. */
  _facts = NO_NETWORK_FACTS;
  emit();
}

/* ══════════════════════════════════════════════════════════════════════════
 * Gözlemlenebilirlik (F5.17) — sır TAŞIMAZ
 * ════════════════════════════════════════════════════════════════════════ */

export interface PhoneInternetTelemetry {
  readonly state: PhoneInternetEvidence['state'];
  readonly source: PhoneInternetEvidence['source'];
  readonly validated: boolean | null;
  readonly metered: boolean | null;
  readonly quality: PhoneInternetEvidence['quality'];
  readonly policyAllowed: boolean;
  readonly observing: boolean;
  readonly lastReason: PhoneInternetEvidence['reason'] | null;
}

/**
 * LAB salt-okunur. SSID, hotspot parolası, BSSID, IP, parmak izi, kimlik
 * bilgisi ve ham yük TAŞIMAZ — native zaten bunların hiçbirini göndermez.
 */
export function getPhoneInternetTelemetry(): PhoneInternetTelemetry {
  const evidence = getPhoneInternetEvidence();
  return Object.freeze({
    state: evidence.state,
    source: evidence.source,
    validated: _facts.present ? _facts.validated : null,
    metered: evidence.metered,
    quality: evidence.quality,
    policyAllowed: evidence.policyAllowed,
    observing: _observing,
    lastReason: _lastReason,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * F4 iptal zincirine kayıt — kaynak sahipliği bizde kalır
 * ════════════════════════════════════════════════════════════════════════ */

let _unregisterReleaser: (() => void) | null = null;

/**
 * Gateway'i F4 yaşam döngüsü zincirine bağlar. İdempotent; timer KURMAZ.
 * Phone Link koptuğunda zincir yalnız `stopPhoneInternetGateway()` çağırır —
 * OS ağına DOKUNULMAZ.
 */
export function initPhoneInternetGatewayLifecycle(): () => void {
  _unregisterReleaser?.();
  _unregisterReleaser = registerInternetAssociationReleaser({
    releaseInternetAssociation: async () => { await stopPhoneInternetGateway(); },
  });
  return () => { _unregisterReleaser?.(); _unregisterReleaser = null; };
}

/** @internal — yalnız testler. */
export function _resetPhoneInternetGatewayForTest(): void {
  _unregisterReleaser?.();
  _unregisterReleaser = null;
  _facts = NO_NETWORK_FACTS;
  _observing = false;
  _removeFactsListener?.();
  _removeFactsListener = null;
  _lastReason = null;
  _subscribers.clear();
}

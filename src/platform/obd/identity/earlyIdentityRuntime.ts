/**
 * earlyIdentityRuntime — P0-VDK-F5H · ERKEN KİMLİĞİN ÜRÜN TETİĞİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── TEK İŞİ ───────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * "NE ZAMAN ölçelim" sorusunun cevabıdır — "NASIL ölçelim" sorusunun DEĞİL.
 * Ölçümün tamamı `earlyVehicleIdentity`dedir; burada yalnız tetikleme koşulu
 * ve ECU keşfinin sağlanması vardır.
 *
 * ⚠️ MODÜL SINIRI BİLİNÇLİDİR: `multiEcuScan` importu YALNIZ bu dosyadadır.
 * Böylece `multiEcuScan → productionDiscovery → earlyVehicleIdentity` zinciri
 * geri dönmez ve modül döngüsü YAPISAL olarak imkânsız kalır.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN "İLK VERİ OLAYI" DEĞİL DE KISA BİR OTURMA PENCERESİ ─────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `diagnosticAdmission` zaten `READY` için handshake + oturum + TAZE veri
 * ister; yani ilk `READY` anı teknik olarak güvenlidir. Buna rağmen kısa bir
 * oturma penceresi (`EARLY_IDENTITY_SETTLE_MS`) uygulanır: bağlantının ilk
 * saniyeleri çekirdek poll'un (hız/RPM) kendini kurduğu ve adaptörün en
 * kırılgan olduğu andır (saha 2026-07-19 V-LINK donma dersi). Pencere,
 * `autoDidDiscovery`nin 30 sn'lik penceresinden KASTEN çok kısadır: bu turun
 * amacı **erken** kimliktir; 30 sn beklemek sorunun kendisini geri getirirdi.
 *
 * timer KURMAZ (yalnız mevcut OBD veri olayına abone olur) · ağ YOK · fail-soft.
 */

import { logError } from '../../crashLogger';
import { getOBDDataSnapshot, onOBDData } from '../../obdService';
import { discoverEcus } from '../multiEcuScan';
import { getActiveProtocolClass } from '../activeProtocol';
import { genericBridgeAvailable } from '../genericPduTransport';
import { runEarlyVehicleIdentity, isEarlyIdentityEvaluatedForEpoch } from './earlyVehicleIdentity';
import { getObdSessionEpoch } from '../../obdService';

/**
 * Bağlantı bu kadar KESİNTİSİZ sağlıklı olunca erken kimlik ölçülür.
 *
 * `autoDidDiscovery.HEALTHY_STABLE_MS` (30 sn) ile bilinçli olarak FARKLIDIR:
 * o katman 256 DID'lik bir brute-force taramadır, bu katman en çok 3 istektir.
 */
export const EARLY_IDENTITY_SETTLE_MS = 5_000;

let _unsub: (() => void) | null = null;
let _healthySince = 0;
let _inFlight = false;

/** @internal — testler arası izolasyon. */
export function _resetEarlyIdentityRuntimeForTest(): void {
  try { _unsub?.(); } catch { /* fail-soft */ }
  _unsub = null; _healthySince = 0; _inFlight = false;
}

function _healthy(): boolean {
  try {
    const s = getOBDDataSnapshot();
    return s.connectionState === 'connected'
      && s.source === 'real' && s.dataFresh === true;
  } catch { return false; }
}

/**
 * Erken kimlik ölçümünü BİR KEZ dener.
 *
 * Ön koşullar burada UCUZ olanlardan başlar: köprü yoksa ya da protokol sınıfı
 * CAN değilse ECU keşfi bile ÇALIŞTIRILMAZ — çalıştırmak, sonucu baştan belli
 * bir tur için hattı meşgul etmek olurdu.
 */
export async function tryEarlyVehicleIdentityOnce(nowMs?: number): Promise<void> {
  if (_inFlight) return;
  _inFlight = true;
  try {
    if (!genericBridgeAvailable()) return;
    if (getActiveProtocolClass() !== 'can') return;

    /* ── P0-VDK-B7 · LIFECYCLE DÜZELTMESİ (saha 2026-08-30) ────────────────
       ÖLÇÜLEN KUSUR: idempotens kapısı `runEarlyVehicleIdentity` İÇİNDEYDİ,
       ama `discoverEcus()` ondan ÖNCE çalışıyordu. Bu izleyici HER OBD veri
       olayında (~3 Hz) tetiklendiği için, kimlik "zaten ölçüldü" diye anında
       dönse bile KEŞİF her seferinde hatta çıkıyordu:
         · `probeEcus` 102 çağrı / 10 dk
         · fiziksel prob turu 712 × `1902FF` → **hepsi NO DATA**
         · bilgi üretmeyen süre 335 270 ms → hattın %83'ü
       Kapı artık pahalı keşiften ÖNCE sorulur. Yeni durum kurulmadı: aynı
       `_evaluatedEpoch` defteri okunuyor. */
    let epoch = -1;
    try { epoch = getObdSessionEpoch(); } catch { epoch = -1; }
    if (epoch >= 0 && isEarlyIdentityEvaluatedForEpoch(epoch)) return;

    let ecus: Awaited<ReturnType<typeof discoverEcus>>['ecus'] = [];
    try { ecus = (await discoverEcus()).ecus; }
    catch (e) { logError('OBD:EarlyIdentityDiscover', e); return; }
    if (ecus.length === 0) return;

    await runEarlyVehicleIdentity({
      ecus, ...(typeof nowMs === 'number' ? { nowMs } : {}),
    });
  } catch (e) {
    logError('OBD:EarlyIdentityRuntime', e);
  } finally {
    _inFlight = false;
  }
}

/**
 * Erken kimlik izleyicisini başlatır — `SystemBoot` bunu kaydeder.
 *
 * Dönen fonksiyon aboneliği KAPATIR (zero-leak). Ölçümün kendisi idempotenttir
 * (oturum mührü başına tek tur), bu yüzden bu izleyici "her veri olayında"
 * tetiklense bile hatta en çok bir tur çıkar.
 */
export function startEarlyIdentityWatcher(): () => void {
  if (_unsub !== null) return _unsub;
  _healthySince = 0;

  const off = onOBDData(() => {
    try {
      const now = Date.now();
      if (!_healthy()) { _healthySince = 0; return; }
      if (_healthySince === 0) { _healthySince = now; return; }
      if (now - _healthySince < EARLY_IDENTITY_SETTLE_MS) return;
      void tryEarlyVehicleIdentityOnce(now);
    } catch (e) {
      logError('OBD:EarlyIdentityWatcher', e);
    }
  });

  _unsub = () => {
    try { off(); } catch { /* fail-soft */ }
    _unsub = null; _healthySince = 0;
  };
  return _unsub;
}

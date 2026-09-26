/**
 * PhoneLinkGuestPortalPanel — PHONE LINK F3.12/F3.13 · misafir QR paneli.
 *
 * ── YENİ UI ÇERÇEVESİ YOK ───────────────────────────────────────────────────
 * Mevcut LAB ekranının kendi görsel dili (OEM CSS değişkenleri, mono tipografi,
 * `rounded border` kart deseni) AYNEN kullanılır. Yeni modal/katman/animasyon
 * altyapısı EKLENMEZ; panel `PhoneHubLinkScreen` içinde sıradan bir bölümdür.
 *
 * ── SANİYELİK TIMER YOK (F3.12) ─────────────────────────────────────────────
 * Geri sayım YOKTUR. Geçerlilik süresi, QR üretildiği anda BİR KEZ hesaplanan
 * STATİK bir metindir ("~15 dakika geçerli"). Panelde `setInterval`/`setTimeout`
 * KULLANILMAZ; QR süresi dolduğunda telefon zaten reddedilir ve kullanıcı yeni
 * kod ister.
 *
 * ── POLLING YOK (F3.13) ─────────────────────────────────────────────────────
 * Gözlemlenebilirlik alanları yalnız kullanıcı bir eylem yaptığında (QR üret /
 * kapat) okunur. LAB için hiçbir yoklama döngüsü KURULMAZ.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Bootstrap/portal/akış token'ı, parmak izi veya `sessionEpoch` EKRANA
 * YAZILMAZ. Token yalnız QR görselinin İÇİNDEDİR. Gösterilen tek tanımlayıcı,
 * bilerek taşınabilir kılınmış `guestSessionId`dir.
 */

import { memo, useCallback, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode, ShieldOff, Loader2 } from 'lucide-react';
import {
  openGuestPortal, closeGuestPortal, getPhoneLinkPortalRuntimeStatus,
} from '../../../platform/phoneLink/phoneLinkPortalRuntime';
import { getPhoneLinkPortalCounters } from '../../../platform/phoneLink/phoneLinkPortalHttp';
import { getPhoneLinkLifecycleTelemetry } from '../../../platform/phoneLink/phoneLinkLifecycle';
import { activeRuntimeSessionCount } from '../../../platform/phoneLink/phoneLinkSessionRegistry';
import { activeGuestSessionCount } from '../../../platform/phoneLink/phoneLinkGuestSession';
import { recordedGrantCount } from '../../../platform/phoneLink/phoneLinkCapabilityGrant';
import { getPhoneInternetTelemetry } from '../../../platform/phoneLink/phoneLinkInternetGateway';
import { getPhoneIntegrationTelemetry } from '../../../platform/phoneLink/phoneIntegrationOwnership';
import { getPhoneLinkProductBootTelemetry } from '../../../platform/phoneLink/phoneLinkProductBoot';
import { getConnectivityTelemetry } from '../../../platform/connectivity/connectivityAuthority';
import { getPhoneLinkNavPushTelemetry } from '../../../platform/phoneLink/phoneLinkNavigationAdapter';
import { getPhoneLinkAssistantBridgeTelemetry } from '../../../platform/phoneLink/phoneLinkAssistantBridgeAdapter';

interface PortalView {
  readonly qrDataUrl: string;
  readonly sessionId: string;
  readonly validityText: string;
  readonly boundOrigin: string | null;
}

const FAILURE_TEXT: Record<string, string> = {
  LINK_NOT_ACTIVE:
    'Phone Link oturumu AKTİF değil. Önce telefon güvenli şekilde bağlanmalı — '
    + 'misafir portalı eşleşmemiş bir cihaz için AÇILMAZ.',
  NO_LOCAL_NETWORK:
    'Head unit\'in erişilebilir bir yerel ağ adresi yok. Telefonun tarayıcısı '
    + 'araca ulaşamayacağı için QR ÜRETİLMEDİ (sahte adres gösterilmez). '
    + 'Aracı ve telefonu aynı Wi-Fi ağına bağlayın.',
};

export const PhoneLinkGuestPortalPanel = memo(function PhoneLinkGuestPortalPanel() {
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<PortalView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await openGuestPortal();
      if (!result.ok) {
        setView(null);
        setError(FAILURE_TEXT[result.reason] ?? 'Misafir portalı açılamadı.');
        return;
      }
      /* QR yerel olarak üretilir — hiçbir dış servise gidilmez. */
      const qrDataUrl = await QRCode.toDataURL(result.qrValue, {
        width: 240, margin: 2, errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' },
      }).catch(() => '');
      if (qrDataUrl === '') {
        setView(null);
        setError('QR görseli üretilemedi.');
        return;
      }
      /* STATİK süre metni — bir kez hesaplanır, geri sayım YOK. */
      const remainingMin = Math.max(1, Math.round((result.qr.expiresAtMs - Date.now()) / 60_000));
      setView({
        qrDataUrl,
        sessionId: result.qr.guestSessionId,
        validityText: `~${remainingMin} dakika geçerli · tek kullanımlık`,
        boundOrigin: result.endpoint.origin,
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const handleClose = useCallback(async () => {
    setBusy(true);
    try {
      await closeGuestPortal();
      setView(null);
      setError(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const runtime = getPhoneLinkPortalRuntimeStatus();
  const counters = getPhoneLinkPortalCounters();
  /* F4.16 — hepsi SENKRON okumadır; LAB hiçbir timer/polling KURMAZ. */
  const lifecycle = getPhoneLinkLifecycleTelemetry();
  const runtimeSessions = activeRuntimeSessionCount();
  const guestSessions = activeGuestSessionCount();
  const grants = recordedGrantCount();
  /* F5.17 — senkron okuma; LAB timer/polling KURMAZ. SSID/parola/IP/credential
     hiçbir zaman gösterilmez (native zaten göndermiyor). */
  const internet = getPhoneInternetTelemetry();
  /* F6.18 — senkron okuma; paket adı/credential/token/parmak izi YOK. */
  const integration = getPhoneIntegrationTelemetry();
  /* F6.2 — urun acilisi gozlemlenebilirligi. Senkron okuma; LAB timer/polling
     KURMAZ. Parmak izi/token/epoch GOSTERILMEZ. */
  const productBoot = getPhoneLinkProductBootTelemetry();
  /* F7 — KANONIK baglanti gercegi. Senkron okuma; LAB timer/polling KURMAZ.
     SSID/BSSID/IP/credential/token GOSTERILMEZ (telemetri zaten tasimaz). */
  const connectivity = getConnectivityTelemetry();
  /* F8.1 — nav destination push. Senkron okuma; LAB timer/polling KURMAZ.
     Koordinat/adres/etiket/parmak izi GOSTERILMEZ (telemetri zaten tasimaz). */
  const navPush = getPhoneLinkNavPushTelemetry();
  /* F9 — Mavi Assistant Bridge. Senkron okuma; LAB timer/polling KURMAZ.
     Prompt/cevap/fingerprint GÖSTERİLMEZ (telemetri zaten taşımaz). */
  const assistantBridge = getPhoneLinkAssistantBridgeTelemetry();

  return (
    <div
      data-testid="phl-guest-portal"
      className="rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface)]"
    >
      <div className="border-b border-[var(--oem-line-strong)] px-2 py-1.5 font-mono text-[10px] text-[var(--oem-ink-3)]">
        MİSAFİR MÜZİK PORTALI (F3)
      </div>

      <div className="flex flex-col gap-2.5 p-2.5">
        <div className="text-[10px] leading-relaxed text-[var(--oem-ink-2)]">
          Eşleşmiş misafir telefonu, uygulama kurmadan CarOS Müzik&apos;i kontrol eder.
          Erişim yalnız <span className="font-mono">MEDIA_CONTROL</span> ile sınırlıdır ve
          Phone Link oturumu bittiği anda sona erer.
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="phl-portal-open"
            disabled={busy}
            onClick={() => void handleOpen()}
            className="flex items-center gap-1.5 rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] px-2.5 py-1.5 font-mono text-[10px] text-[var(--oem-ink-2)] transition-colors disabled:opacity-40"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <QrCode size={12} />}
            QR Kodu Göster
          </button>
          <button
            type="button"
            data-testid="phl-portal-close"
            disabled={busy || !runtime.running}
            onClick={() => void handleClose()}
            className="flex items-center gap-1.5 rounded border border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] px-2.5 py-1.5 font-mono text-[10px] text-[var(--oem-danger)] transition-colors disabled:opacity-40"
          >
            <ShieldOff size={12} />
            Erişimi Kapat
          </button>
        </div>

        {error && (
          <div
            data-testid="phl-portal-error"
            className="rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-2 py-1.5 text-[10px] leading-relaxed text-[var(--oem-ink-2)]"
          >
            {error}
          </div>
        )}

        {view && (
          <div className="flex flex-col items-center gap-1.5 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-2)] p-3">
            <img
              src={view.qrDataUrl}
              alt="Misafir müzik portalı QR kodu"
              width={240}
              height={240}
              className="rounded bg-white"
            />
            <div className="text-[11px] font-semibold text-[var(--oem-ink)]">
              Telefon kamerasıyla tara
            </div>
            <div className="font-mono text-[9px] text-[var(--oem-ink-3)]">
              {view.validityText}
            </div>
            <div className="font-mono text-[9px] text-[var(--oem-ink-3)]">
              oturum: {view.sessionId}
            </div>
          </div>
        )}

        {/* ── Gözlemlenebilirlik (F3.13) — token/parmak izi YOK ─────────── */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-[var(--oem-line)] pt-2 font-mono text-[9px] text-[var(--oem-ink-3)]">
          <span>sunucu</span>
          <span data-testid="phl-portal-running" className="text-[var(--oem-ink-2)]">
            {runtime.running ? 'ÇALIŞIYOR' : 'KAPALI'}
          </span>
          <span>bağlı arayüz</span>
          <span className="break-all text-[var(--oem-ink-2)]">{runtime.boundOrigin ?? '—'}</span>
          <span>bootstrap kabul / ret</span>
          <span className="text-[var(--oem-ink-2)]">
            {counters.bootstrapAccepted} / {counters.bootstrapRejected}
          </span>
          <span>komut kabul / ret</span>
          <span className="text-[var(--oem-ink-2)]">
            {counters.commandsAccepted} / {counters.commandsRejected}
          </span>
          <span>son ret gerekçesi</span>
          <span className="text-[var(--oem-ink-2)]">{counters.lastRejectReason ?? '—'}</span>

          {/* ── F4 yaşam döngüsü — parmak izi/token GÖSTERİLMEZ ────────── */}
          <span>native link state</span>
          <span data-testid="phl-lifecycle-state" className="text-[var(--oem-ink-2)]">
            {lifecycle.lastState ?? 'OLAY YOK'}
          </span>
          <span>session epoch</span>
          <span className="text-[var(--oem-ink-2)]">{lifecycle.lastEpoch ?? '—'}</span>
          <span>runtime session / guest / grant</span>
          <span className="text-[var(--oem-ink-2)]">
            {runtimeSessions} / {guestSessions} / {grants}
          </span>
          <span>son geçiş gerekçesi</span>
          <span className="text-[var(--oem-ink-2)]">{lifecycle.lastReason ?? '—'}</span>
          <span>son temizlik gerekçesi</span>
          <span data-testid="phl-cleanup-reason" className="text-[var(--oem-ink-2)]">
            {lifecycle.lastCleanupReason ?? '—'}
          </span>
          <span>iptal zinciri (adet)</span>
          <span className="text-[var(--oem-ink-2)]">{lifecycle.cascadeCount}</span>

          {/* ── F5 telefon interneti — SSID/parola/IP/credential YOK ────── */}
          <span>internet durumu</span>
          <span data-testid="phl-internet-state" className="text-[var(--oem-ink-2)]">
            {internet.state}
          </span>
          <span>internet kaynağı</span>
          <span className="text-[var(--oem-ink-2)]">{internet.source}</span>
          <span>doğrulandı (validated)</span>
          <span className="text-[var(--oem-ink-2)]">
            {internet.validated === null ? 'BİLİNMİYOR' : internet.validated ? 'EVET' : 'HAYIR'}
          </span>
          <span>ölçülü (metered)</span>
          <span data-testid="phl-internet-metered" className="text-[var(--oem-ink-2)]">
            {internet.metered === null ? 'BİLİNMİYOR' : internet.metered ? 'EVET' : 'HAYIR'}
          </span>
          <span>kalite</span>
          <span className="text-[var(--oem-ink-2)]">{internet.quality}</span>
          <span>INTERNET_SHARE izni</span>
          <span className="text-[var(--oem-ink-2)]">{internet.policyAllowed ? 'VAR' : 'YOK'}</span>
          <span>ağ callback aktif</span>
          <span className="text-[var(--oem-ink-2)]">{internet.observing ? 'EVET' : 'HAYIR'}</span>
          <span>internet son gerekçe</span>
          <span className="text-[var(--oem-ink-2)]">{internet.lastReason ?? '—'}</span>

          {/* ── F6 telefon-entegrasyon sahipliği ─────────────────────────── */}
          <span>Phone Link sahiplik</span>
          <span data-testid="phl-ownership-held" className="text-[var(--oem-ink-2)]">
            {integration.exclusiveOwnershipHeld ? 'ACTIVE' : 'RELEASED'}
          </span>
          <span>ses / medya</span>
          <span className="text-[var(--oem-ink-2)]">
            {integration.ownership.AUDIO} / {integration.ownership.MEDIA_CONTROL}
          </span>
          <span>mikrofon / projeksiyon</span>
          <span className="text-[var(--oem-ink-2)]">
            {integration.ownership.MICROPHONE} / {integration.ownership.PROJECTION}
          </span>
          <span>USB entegrasyon</span>
          <span className="text-[var(--oem-ink-2)]">
            {integration.ownership.USB_PHONE_INTEGRATION}
          </span>
          <span>son arbitrasyon gerekçesi</span>
          <span data-testid="phl-arbitration-reason" className="text-[var(--oem-ink-2)]">
            {integration.lastTransitionReason ?? integration.reason}
          </span>
          <span>askıya alınan rakip (adet)</span>
          <span className="text-[var(--oem-ink-2)]">{integration.suspendedIntegrationCount}</span>

          {/* ── F6.2 ürün açılışı — LAB artık ZORUNLU DEĞİL ─────────────── */}
          <span>ürün açılışı</span>
          <span data-testid="phl-product-boot-state" className="text-[var(--oem-ink-2)]">
            {productBoot.state}
          </span>
          <span>açılış gerekçesi</span>
          <span className="text-[var(--oem-ink-2)]">{productBoot.reason}</span>
          <span>köprü / gateway / ownership</span>
          <span className="text-[var(--oem-ink-2)]">
            {productBoot.listenersAttached ? 'BAĞLI' : 'YOK'} /{' '}
            {productBoot.gatewayLifecycleRegistered ? 'KAYITLI' : 'YOK'} /{' '}
            {productBoot.ownershipLifecycleRegistered ? 'KAYITLI' : 'YOK'}
          </span>
          <span>son replay sonucu</span>
          <span data-testid="phl-replay-outcome" className="text-[var(--oem-ink-2)]">
            {productBoot.lastReplayOutcome ?? '—'}
          </span>
          <span>hazırlık değerlendirmesi (adet)</span>
          <span className="text-[var(--oem-ink-2)]">{productBoot.readinessEvaluations}</span>

          {/* ── F7 kanonik bağlantı otoritesi ───────────────────────────── */}
          <span>bağlantı durumu</span>
          <span data-testid="connectivity-state" className="text-[var(--oem-ink-2)]">
            {connectivity.snapshot.state}
          </span>
          <span>aktif taşıma / kaynak</span>
          <span className="text-[var(--oem-ink-2)]">
            {connectivity.snapshot.transport} / {connectivity.snapshot.source}
          </span>
          <span>validated / captive</span>
          <span className="text-[var(--oem-ink-2)]">
            {connectivity.snapshot.validated === null ? 'BİLİNMİYOR'
              : connectivity.snapshot.validated ? 'EVET' : 'HAYIR'} /{' '}
            {connectivity.snapshot.captivePortal === null ? 'BİLİNMİYOR'
              : connectivity.snapshot.captivePortal ? 'EVET' : 'HAYIR'}
          </span>
          <span>metered / kalite</span>
          <span className="text-[var(--oem-ink-2)]">
            {connectivity.snapshot.metered === null ? 'BİLİNMİYOR'
              : connectivity.snapshot.metered ? 'EVET' : 'HAYIR'} /{' '}
            {connectivity.snapshot.quality}
          </span>
          <span>kanıt yaşı / kaynak sayısı</span>
          <span className="text-[var(--oem-ink-2)]">
            {connectivity.snapshot.evidenceAgeMs === null
              ? '—' : `${Math.round(connectivity.snapshot.evidenceAgeMs / 1000)}s`}{' '}
            / {connectivity.snapshot.evidenceCount}
          </span>
          <span>kanıt kaynakları</span>
          <span className="break-all text-[var(--oem-ink-2)]">
            {connectivity.sources.length > 0 ? connectivity.sources.join(', ') : '—'}
          </span>
          <span>gözlemci / abone</span>
          <span className="text-[var(--oem-ink-2)]">
            {connectivity.observerOwned ? 'SAHİP' : 'YOK'} / {connectivity.subscriberCount}
          </span>
          <span>son geçiş kaynağı (adet)</span>
          <span data-testid="connectivity-transition" className="text-[var(--oem-ink-2)]">
            {connectivity.lastTransitionSource ?? '—'} ({connectivity.transitionCount})
          </span>

          {/* ── F8.1 navigasyon hedefi önerisi — koordinat/etiket/parmak izi YOK ── */}
          <span>nav önerisi al./yetk./red</span>
          <span data-testid="phl-nav-push-counters" className="text-[var(--oem-ink-2)]">
            {navPush.receivedCount} / {navPush.authorizedCount} / {navPush.rejectedCount}
          </span>
          <span>bekleyen öneri (adet)</span>
          <span data-testid="phl-nav-pending-count" className="text-[var(--oem-ink-2)]">
            {navPush.pendingCount}
          </span>
          <span>kullanıcı kabul / red / süre doldu</span>
          <span className="text-[var(--oem-ink-2)]">
            {navPush.userApprovedCount} / {navPush.userRejectedCount} / {navPush.expiredCount}
          </span>
          <span>handoff kabul / ret</span>
          <span className="text-[var(--oem-ink-2)]">
            {navPush.handoffAcceptedCount} / {navPush.handoffFailedCount}
          </span>
          <span>nav son ret gerekçesi</span>
          <span data-testid="phl-nav-last-denial" className="text-[var(--oem-ink-2)]">
            {navPush.lastDenialCode ?? '—'}
          </span>

          {/* ── F9 Mavi Assistant Bridge — prompt/cevap/fingerprint YOK ──── */}
          <span>assistant al./yetk./red</span>
          <span data-testid="phl-assistant-counters" className="text-[var(--oem-ink-2)]">
            {assistantBridge.receivedCount} / {assistantBridge.authorizedCount} / {assistantBridge.rejectedCount}
          </span>
          <span>aktif istek (adet)</span>
          <span data-testid="phl-assistant-active-count" className="text-[var(--oem-ink-2)]">
            {assistantBridge.activeRequestCount}
          </span>
          <span>başarılı / başarısız / eylem reddi</span>
          <span className="text-[var(--oem-ink-2)]">
            {assistantBridge.successCount} / {assistantBridge.failedCount} / {assistantBridge.actionRejectedCount}
          </span>
          <span>zaman aşımı / iptal / yinelenen</span>
          <span className="text-[var(--oem-ink-2)]">
            {assistantBridge.timedOutCount} / {assistantBridge.cancelledCount} / {assistantBridge.duplicateCount}
          </span>
          <span>bayat oturuma düşen sonuç (adet)</span>
          <span className="text-[var(--oem-ink-2)]">{assistantBridge.resultDroppedStaleSessionCount}</span>
          <span>assistant son ret gerekçesi</span>
          <span data-testid="phl-assistant-last-denial" className="text-[var(--oem-ink-2)]">
            {assistantBridge.lastDenialCode ?? '—'}
          </span>
        </div>
      </div>
    </div>
  );
});

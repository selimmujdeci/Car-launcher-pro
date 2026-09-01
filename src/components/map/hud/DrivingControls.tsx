/**
 * DrivingControls — P0-NAV-04 · aktif rehberlikteki SÜRÜŞ kontrolleri.
 *
 * ── ÖLÇÜLEN KUSUR (gerçek cihaz karesi) ───────────────────────────────────
 * Sağ kenarda sürüş boyunca üç kutu duruyordu: pusula · zoom + · zoom −.
 * Bu bir **web haritası** hissidir; sürücü seyir hâlinde zoom'a basmaz ve
 * kamera zaten hıza göre ölçekleniyor. Eski kodun kendi yorumunda bu kolonun
 * hız paneliyle **54×55 px çakıştığı** ölçümü kayıtlıdır.
 *
 * ── YENİ SÖZLEŞME ─────────────────────────────────────────────────────────
 *  · Zoom kolonu aktif rehberlikte **çizilmez** (`hud.showZoomControls`).
 *  · **Ortala** düğmesi TALEP ÜZERİNE gelir: yalnız kullanıcı kamerayı
 *    bıraktığında (`FOLLOW_SUSPENDED` / `USER_PANNING`). Takip sürerken
 *    hiçbir şey çizilmez.
 *
 * ── OTORİTE (bypass EDİLMEDİ) ─────────────────────────────────────────────
 * Takip durumu `cameraFollowAuthority`den **okunur**; bu bileşen ne durum
 * yazar ne kamerayı sürer. Ortalama isteği mevcut `onRecenter` yoluna gider —
 * o yol otoritenin `beginRecenter`ını çağırmaya devam eder.
 */

import { memo, useEffect, useState } from 'react';
import { LocateFixed } from 'lucide-react';
import {
  CameraFollowState, getCameraFollowState, subscribeCameraFollow,
  isRecenterAvailable,
} from '../../../platform/navigation/cameraFollowAuthority';
import type { HudPresentation } from '../../../platform/navigation/core/hudPresentationModel';

export interface DrivingControlsProps {
  readonly hud: HudPresentation;
  /** Mevcut ortalama yolu — otorite bu çağrının İÇİNDE çalışır. */
  readonly onRecenter: () => void;
}

/* Görünürlük kuralı BURADA TANIMLANMAZ: otoritenin kendi cevabı
   `isRecenterAvailable()` kullanılır. İlk yazımda kural burada YENİDEN
   yazılmıştı (`FOLLOW_SUSPENDED || USER_PANNING`) ve otoritenin saydığı
   `UNKNOWN` hâlini ATLIYORDU — bu, tam da yasaklanan "ikinci takip kuralı"dır.
   `followState` yalnız YENİDEN RENDER tetiklemek için tutulur. */

export const DrivingControls = memo(function DrivingControls({
  hud, onRecenter,
}: DrivingControlsProps) {
  const [followState, setFollowState] = useState<string>(() => {
    try { return getCameraFollowState(); } catch { return CameraFollowState.UNKNOWN; }
  });

  useEffect(() => {
    let alive = true;
    let unsub: (() => void) | undefined;
    try {
      unsub = subscribeCameraFollow((s) => { if (alive) setFollowState(s); });
    } catch { /* fail-soft — kontrol yokluğu sürüşü bozmaz */ }
    return () => { alive = false; try { unsub?.(); } catch { /* ignore */ } };
  }, []);

  if (hud.state === 'OFF') return null;
  /* `followState` okunur ki abonelik değişimi render tetiklesin; KARAR
     otoritenindir. Araç takipteyken düğme GÖRÜNMEZ, takibe dönünce KAYBOLUR. */
  void followState;
  if (!isRecenterAvailable()) return null;

  return (
    <button
      type="button"
      onClick={onRecenter}
      aria-label="Haritayı araca ortala"
      data-testid="driving-recenter"
      className="absolute z-[var(--z-map-label)] flex items-center gap-2 active:scale-95 transition-transform"
      style={{
        right: 'max(12px, var(--sar, 0px))',
        /* Hız kümesinin ÜSTÜNDE durur; ikisi aynı sütunda ama çakışmaz. */
        bottom: hud.layout === 'PORTRAIT'
          ? 'calc(env(safe-area-inset-bottom, 0px) + 186px)'
          : 'calc(env(safe-area-inset-bottom, 0px) + 152px)',
        /* Dokunma hedefi araç ekranı için BÜYÜK (48 px yükseklik). */
        minHeight: 48,
        padding: '0 16px',
        borderRadius: 24,
        background: 'var(--oem-surface-1, rgba(38,44,60,0.90))',
        border: '1px solid var(--oem-line-warm, oklch(66% 0.10 55 / 0.45))',
        color: 'var(--oem-accent, #E0A23C)',
        boxShadow: 'var(--oem-shadow-card, 0 20px 44px -22px rgba(0,0,0,0.55))',
        backdropFilter: 'blur(calc(var(--rt-blur, 1) * 18px))',
        WebkitBackdropFilter: 'blur(calc(var(--rt-blur, 1) * 18px))',
      }}
    >
      <LocateFixed className="w-5 h-5" />
      <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em' }}>ORTALA</span>
    </button>
  );
});

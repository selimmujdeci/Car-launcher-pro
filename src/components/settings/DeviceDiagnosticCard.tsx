/**
 * DeviceDiagnosticCard — Faz 2: Cihaz-gerçeği yerel teşhis kartı.
 *
 * SettingsPage "Hakkında" panelinde yaşar (SupportSnapshotCard komşusu).
 *
 * NEDEN AYRI: SupportSnapshotCard UZAK rapordur (internet + eşleşme ister,
 * sanitize edilir, destek ekibine gider). Bu kart ise YEREL ve GÖRÜNÜRDÜR —
 * internet / adb / eşleşme GEREKTİRMEZ. Rastgele bir Çin head unit'ine APK
 * yükleyip Ayarlar'ı açınca uygulama cihazın GERÇEĞİNİ ekrana basar; kullanıcı
 * fotoğraflar → hangi cihazda ne olduğunu (compat bandı) anında görürüz.
 * adb garantisi olmayan ekosistemde bu, cihazı elde tutmanın ikamesidir
 * (§HEAD_UNIT_MATRIX §3.5/§6).
 *
 * Gösterilen her değer RUNTIME gerçeğidir — cihaz beyanı / OS etiketi değil.
 * WebView sürümü `navigator.userAgent` Chrome/ token'ından okunur (dağıtıcının
 * sahte Android etiketine bağışık).
 */
import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { getCapabilities, getDeviceTier, supportsModuleWorker } from '../../platform/deviceCapabilities';
import { getGpuRenderer } from '../../utils/detectWeakGpu';
import { useHALStatusStore } from '../../platform/vehicleDataLayer/halStatusStore';

const TIER_COLOR: Record<string, string> = {
  low:  '#fbbf24',
  mid:  '#60a5fa',
  high: '#34d399',
};

function yn(v: boolean): string {
  return v ? 'evet' : 'yok';
}

/** WebView sürümünü compat bandı etiketine çevirir (teşhis okunurluğu). */
function webViewBand(chrome: number): string {
  if (chrome === 0) return 'bilinmiyor';
  if (chrome < 64)  return `Chrome ${chrome} · legacy ES2015 yolu`;
  if (chrome < 80)  return `Chrome ${chrome} · modern chunk + classic worker`;
  return `Chrome ${chrome} · tam modern (modül worker)`;
}

export function DeviceDiagnosticCard() {
  const [copied, setCopied] = useState(false);
  const activeSource = useHALStatusStore((s) => s.activeSource);
  const canPhase     = useHALStatusStore((s) => s.canPhase);

  const c        = getCapabilities();
  const tier     = getDeviceTier();
  const modWkr   = supportsModuleWorker();
  const renderer = getGpuRenderer();
  const native   = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();
  const ua       = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '';
  const version  = (import.meta.env.VITE_APP_VERSION as string) || '?';

  const w   = typeof window !== 'undefined' ? (window.innerWidth  || 0) : 0;
  const h   = typeof window !== 'undefined' ? (window.innerHeight || 0) : 0;
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
  const orient = w > h ? 'yatay' : 'dikey';

  // Kopyalanabilir / fotoğraflanabilir düz metin — sahaya çıkan tek veri.
  const report = [
    `CarOS Pro v${version}`,
    `Platform    : ${native ? 'native' : 'web'} (${platform})`,
    `WebView     : ${webViewBand(c.webViewVersion)}`,
    `Android     : ${c.androidVersion || 'bilinmiyor'}`,
    `Cihaz sınıfı: ${tier.toUpperCase()}`,
    `GPU         : ${renderer || 'maskeli'}${c.weakGpu ? ' (ZAYIF)' : ''}`,
    `CPU / RAM   : ${c.cores || '?'} çekirdek / ${c.memoryMb ? Math.round(c.memoryMb / 1024) + 'GB' : 'bilinmiyor'}`,
    `Ekran       : ${w}×${h} @${dpr}x (${orient})`,
    `Modül worker: ${yn(modWkr)}  ·  SAB: ${yn(c.hasWorkerSAB)}`,
    `Özellikler  : WebGL ${yn(c.supportsWebGL)} · backdrop ${yn(c.supportsBackdropFilter)} · dvh ${yn(c.supportsDvh)} · @layer ${yn(c.supportsCssLayer)}`,
    `CAN kaynağı : ${activeSource || 'yok'} (${canPhase})`,
    `UA          : ${ua}`,
  ].join('\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Head unit'te clipboard olmayabilir — metin zaten ekranda seçilebilir/fotoğraflanabilir.
      setCopied(false);
    }
  };

  return (
    <div className="mt-3 px-3 py-2.5 rounded-xl"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-bold truncate" style={{ color: 'var(--text-primary)' }}>
            Cihaz Teşhisi
          </div>
          <div className="text-[10px] font-bold mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Bu cihazın gerçeği — internet/adb gerektirmez, fotoğraflanabilir
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="px-2 py-1 rounded-lg text-[11px] font-black"
            style={{
              background: `${TIER_COLOR[tier]}1f`,
              border: `1px solid ${TIER_COLOR[tier]}40`,
              color: TIER_COLOR[tier],
            }}>
            {tier.toUpperCase()}
          </span>
          <button
            onClick={() => { void handleCopy(); }}
            className="px-3 py-1.5 rounded-xl text-[11px] font-black"
            style={{
              background: 'rgba(96,165,250,0.12)',
              border: '1px solid rgba(96,165,250,0.25)',
              color: '#93c5fd',
            }}>
            {copied ? 'Kopyalandı' : 'Kopyala'}
          </button>
        </div>
      </div>

      <pre
        className="mt-2 p-2.5 rounded-lg text-[10px] leading-relaxed overflow-x-auto whitespace-pre-wrap break-words select-text"
        style={{
          background: 'rgba(148,163,184,0.06)',
          border: '1px solid rgba(148,163,184,0.15)',
          color: 'var(--text-muted)',
          fontFamily: 'ui-monospace, monospace',
          margin: 0,
        }}>
        {report}
      </pre>
    </div>
  );
}

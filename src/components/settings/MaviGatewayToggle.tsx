/**
 * MaviGatewayToggle — Mavi'nin yeni AI Gateway hattı için fail-closed şalter.
 *
 * Anahtar YÖNETİMİ burada DEĞİLDİR (birleşik `ApiCredentialsPanel` satırı
 * yapar); bu bileşen yalnız "Mavi bu hattı kullansın mı" tercihini taşır.
 *
 * ── FAIL-CLOSED ─────────────────────────────────────────────────────────────
 * Şalter YALNIZ anahtar kayıtlıyken VE bağlantı testi başarılıyken açılabilir.
 * Açma isteği serviste bir kez daha doğrulanır (`setGatewayPreference`), yani
 * UI kandırılsa bile anahtarsız açılmaz. Kapatıldığında Mavi eski sağlayıcı
 * yoluyla (Gemini → Groq → Haiku) çalışmaya devam eder — hiçbir koşulda susmaz.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { isAiGatewayEnabled, setGatewayPreference } from '../../platform/ai/gateway/openRouterKeyService';

interface Props {
  /** Anahtar güvenli depoda kayıtlı mı. */
  readonly configured: boolean;
  /** Bu oturumda bağlantı testi başarılı oldu mu. */
  readonly verified:   boolean;
}

export const MaviGatewayToggle = memo(function MaviGatewayToggle({ configured, verified }: Props) {
  const [enabled, setEnabled] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    setEnabled(isAiGatewayEnabled());
    return () => { aliveRef.current = false; };
  }, []);

  /** Anahtar silinir/geçersizleşirse şalter fail-closed kapatılır. */
  useEffect(() => {
    if (configured) return;
    void setGatewayPreference(false).then(() => {
      if (aliveRef.current) setEnabled(false);
    });
  }, [configured]);

  const handleToggle = useCallback(async () => {
    const applied = await setGatewayPreference(!enabled);   // fail-closed kapı serviste
    if (aliveRef.current) setEnabled(applied);
  }, [enabled]);

  const canEnable = configured && verified;

  return (
    <div className="flex items-center justify-between gap-3 mt-1 p-3 rounded-lg bg-sky-500/10 border border-sky-500/20">
      <div className="flex flex-col">
        <span className="text-[12px] font-bold text-[color:var(--oem-ink)]">Mavi&apos;de yeni AI Gateway&apos;i kullan</span>
        <span className="text-[10px] text-[color:var(--oem-ink-3)] leading-snug">
          {canEnable
            ? 'Kapatırsan Mavi eski yapay zekâ bağlantısıyla çalışmaya devam eder.'
            : 'Önce anahtarı kaydedip bağlantıyı test et.'}
        </span>
        <span className="text-[10px] text-[color:var(--oem-ink-3)] leading-snug mt-0.5">
          Model seçimi sonraki geliştirme aşamasında eklenecek.
        </span>
      </div>
      <button
        onClick={() => { void handleToggle(); }}
        disabled={!canEnable && !enabled}
        aria-pressed={enabled}
        className={`relative w-12 h-7 rounded-full transition-all flex-shrink-0 disabled:opacity-40 ${enabled ? 'bg-emerald-500/80' : 'bg-white/15'}`}
      >
        <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${enabled ? 'left-6' : 'left-1'}`} />
      </button>
    </div>
  );
});

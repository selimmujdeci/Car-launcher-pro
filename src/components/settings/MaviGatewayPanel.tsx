/**
 * MaviGatewayPanel — "Mavi Yapay Zekâ Bağlantısı" ayar bölümü (OpenRouter BYOK).
 *
 * Kullanıcı buradan tek bir OpenRouter anahtarı girip Mavi'nin farklı yapay
 * zekâ modellerini kullanmasını sağlar. Bölüm YALNIZ anahtar yaşam döngüsünü
 * yönetir; model seçimi bu aşamada YOKTUR.
 *
 * ── ANAHTAR GİZLİLİĞİ (UI sözleşmesi) ───────────────────────────────────────
 *  - Kayıtlı anahtar EKRANA GERİ OKUNMAZ. Sayfa yeniden açıldığında yalnız
 *    "kayıtlı" bilgisi + MASKELİ özet (`sk-or-••••••••••4F9A`) gösterilir.
 *  - Kullanıcının YAZDIĞI metin geçici (`draftKey`) state'te tutulur; kaydetme
 *    başarılı olur olmaz TEMİZLENİR, bileşen kalkarken de sıfırlanır.
 *  - Göster/gizle yalnız KULLANICININ O AN YAZDIĞI metin içindir — depodan
 *    okunan anahtar için değil.
 *  - Anahtar loglanmaz, hata metnine girmez, telemetriye gönderilmez.
 *    Tüm depo/ağ işleri `openRouterKeyService` üzerinden yapılır.
 *
 * ── FAIL-CLOSED ŞALTER ──────────────────────────────────────────────────────
 * "Mavi'de yeni AI Gateway'i kullan" seçeneği YALNIZ anahtar kayıtlıyken VE
 * bağlantı testi başarılıyken açılabilir. Anahtar silinince şalter otomatik
 * kapanır ve Mavi eski sağlayıcı yoluyla (Gemini/Groq/Haiku) çalışmaya devam
 * eder — hiçbir koşulda sessiz kalmaz.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle, Eye, EyeOff, Info, Loader, ShieldCheck, XCircle } from 'lucide-react';
import { openInApp } from '../../platform/inAppBrowser';
import {
  connectionStatusMessage,
  getOpenRouterKeyInfo,
  isAiGatewayEnabled,
  keyFormatMessage,
  removeOpenRouterKey,
  saveOpenRouterKey,
  setGatewayPreference,
  testOpenRouterConnection,
  type OpenRouterConnectionStatus,
} from '../../platform/ai/gateway/openRouterKeyService';

const OPENROUTER_KEYS_URL = 'https://openrouter.ai/keys';

/** Durum → renk/ikon eşlemesi (teknik kod göstermez). */
function statusTone(status: OpenRouterConnectionStatus): { color: string; ok: boolean } {
  if (status === 'connected')      return { color: 'text-emerald-400', ok: true };
  if (status === 'checking')       return { color: 'text-sky-400',     ok: false };
  if (status === 'not_configured') return { color: 'text-[color:var(--oem-ink-3)]', ok: false };
  return { color: 'text-red-400', ok: false };
}

export function MaviGatewayPanel() {
  /** Kullanıcının O AN yazdığı anahtar — GEÇİCİ (kaydedince/unmount'ta silinir). */
  const [draftKey, setDraftKey]   = useState('');
  const [showDraft, setShowDraft] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [masked, setMasked]         = useState('');
  const [status, setStatus]         = useState<OpenRouterConnectionStatus>('not_configured');
  const [gatewayOn, setGatewayOn]   = useState(false);
  const [busy, setBusy]             = useState(false);
  const [notice, setNotice]         = useState<string | null>(null);
  const aliveRef = useRef(true);

  /** Depodan yalnız "kayıtlı mı + maske" okunur — tam anahtar UI'a GİRMEZ. */
  const refreshInfo = useCallback(async () => {
    const info = await getOpenRouterKeyInfo();
    if (!aliveRef.current) return;
    setConfigured(info.configured);
    setMasked(info.masked);
    if (!info.configured) setStatus('not_configured');
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void refreshInfo();
    setGatewayOn(isAiGatewayEnabled());
    return () => {
      aliveRef.current = false;
      setDraftKey('');            // hassas girdi state'i temizlenir (zero-retention)
      setShowDraft(false);
    };
  }, [refreshInfo]);

  const handleSave = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    const result = await saveOpenRouterKey(draftKey);
    if (!aliveRef.current) return;
    if (!result.ok) {
      setNotice(keyFormatMessage(result.reason));   // mesaj anahtarı İÇERMEZ
      setBusy(false);
      return;
    }
    setDraftKey('');              // ← kaydedildi, ham anahtar UI'dan SİLİNİR
    setShowDraft(false);
    setConfigured(true);
    setMasked(result.masked);
    setStatus('not_configured');  // yeni anahtar henüz doğrulanmadı
    setNotice('Anahtar cihaza güvenli biçimde kaydedildi.');
    setBusy(false);
  }, [draftKey]);

  const handleTest = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    setStatus('checking');
    const result = await testOpenRouterConnection();
    if (!aliveRef.current) return;
    setStatus(result);
    if (result !== 'connected') {
      // Doğrulama düştü → şalter fail-closed kapatılır (açıksa bile).
      await setGatewayPreference(false);
      if (aliveRef.current) setGatewayOn(false);
    }
    setBusy(false);
  }, []);

  const handleRemove = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    await removeOpenRouterKey();  // şalter de kapanır
    if (!aliveRef.current) return;
    setDraftKey('');
    setShowDraft(false);
    setConfigured(false);
    setMasked('');
    setStatus('not_configured');
    setGatewayOn(false);
    setNotice('Anahtar silindi. Mavi eski yapay zekâ bağlantısıyla çalışmaya devam ediyor.');
    setBusy(false);
  }, []);

  const handleToggleGateway = useCallback(async () => {
    const next = !gatewayOn;
    const applied = await setGatewayPreference(next);   // fail-closed kapı serviste
    if (!aliveRef.current) return;
    setGatewayOn(applied);
  }, [gatewayOn]);

  const canToggle = configured && status === 'connected';
  const tone = statusTone(status);

  return (
    <div className="mt-8 pt-8 border-t border-white/10 flex flex-col gap-4">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="w-4 h-4 text-sky-400" />
        <span className="text-[10px] font-black uppercase tracking-[0.4em] text-sky-400/70">Mavi Yapay Zekâ Bağlantısı</span>
        <span className="ml-auto text-[9px] px-2 py-0.5 rounded bg-sky-500/15 text-sky-400 border border-sky-500/20 font-mono">Yeni</span>
      </div>

      {/* Sade açıklama — teknik olmayan kullanıcı için */}
      <div className="flex flex-col gap-2 p-3 rounded-xl bg-sky-500/10 border border-sky-500/20">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-sky-300 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-sky-100 leading-snug">
            OpenRouter anahtarınız, Mavi'nin farklı yapay zekâ modellerini kullanmasını sağlar.
            Anahtar yalnızca cihazınızda güvenli biçimde saklanır.
          </p>
        </div>
        <p className="text-[10px] text-amber-200/90 leading-snug pl-6">
          OpenRouter kullanımı kendi hesabınızın kota ve ücretlendirmesine tabidir.
        </p>
        <p className="text-[10px] text-[color:var(--oem-ink-3)] leading-snug pl-6">
          Model seçimi sonraki geliştirme aşamasında eklenecek.
        </p>
      </div>

      <button
        onClick={() => openInApp(OPENROUTER_KEYS_URL)}
        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-sky-500/30 bg-sky-500/10 text-sky-300 text-sm font-bold hover:bg-sky-500/20 active:scale-[0.98] transition-all"
      >
        <span>🔑</span>
        Anahtar Al — openrouter.ai
      </button>

      {/* Kayıt durumu — TAM ANAHTAR GERİ OKUNMAZ, yalnız maskeli özet */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-sky-300 uppercase tracking-wider">OpenRouter Anahtarı</span>
        {configured
          ? <span className="text-[9px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-mono">Kayıtlı ✓ {masked}</span>
          : <span className="text-[9px] px-2 py-0.5 rounded bg-sky-500/20 text-sky-200 border border-sky-400/30">Yapılandırılmadı</span>
        }
      </div>

      <div className="relative">
        <input
          type={showDraft ? 'text' : 'password'}
          value={draftKey}
          onChange={(e) => setDraftKey(e.target.value)}
          placeholder={configured ? 'Yeni anahtar girerek değiştirebilirsiniz' : 'OpenRouter anahtarınızı yapıştırın'}
          autoComplete="off"
          spellCheck={false}
          className="w-full bg-[var(--oem-surface-2)] border border-[var(--oem-line)] rounded-xl px-3.5 py-2.5 text-[color:var(--oem-ink)] text-sm placeholder:text-[color:var(--oem-ink-3)] outline-none focus:border-[var(--oem-accent)] transition-all pr-10"
        />
        <button
          onClick={() => setShowDraft((v) => !v)}
          aria-label={showDraft ? 'Anahtarı gizle' : 'Anahtarı göster'}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--oem-ink-3)] hover:text-[color:var(--oem-ink)]"
        >
          {showDraft ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => { void handleSave(); }}
          disabled={busy || draftKey.trim().length === 0}
          className="px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-all active:scale-95 disabled:opacity-40 border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
        >
          Kaydet
        </button>
        <button
          onClick={() => { void handleTest(); }}
          disabled={busy || !configured}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-all active:scale-95 disabled:opacity-40"
          style={{ borderColor: 'rgba(255,255,255,0.15)', color: 'var(--oem-ink-2, rgba(255,255,255,0.6))' }}
        >
          {status === 'checking' ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
          Bağlantıyı Test Et
        </button>
        <button
          onClick={() => { void handleRemove(); }}
          disabled={busy || !configured}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-all active:scale-95 disabled:opacity-40 border-red-500/30 bg-red-500/10 text-red-300"
        >
          <XCircle className="w-3.5 h-3.5" />
          Anahtarı Sil
        </button>
      </div>

      {/* Bağlantı durumu — teknik hata kodu YOK, sade Türkçe */}
      <div className="flex items-center gap-1.5 text-[11px] font-medium">
        {tone.ok
          ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
          : status === 'checking'
            ? <Loader className="w-3.5 h-3.5 text-sky-400 animate-spin" />
            : <Info className="w-3.5 h-3.5 text-[color:var(--oem-ink-3)]" />
        }
        <span className={tone.color}>{connectionStatusMessage(status)}</span>
      </div>

      {notice && (
        <div className="px-3 py-2 rounded-xl text-[11px] font-medium border bg-[var(--oem-surface-2)] border-[var(--oem-line)] text-[color:var(--oem-ink-2)]">
          {notice}
        </div>
      )}

      {/* Fail-closed şalter: yalnız kayıtlı + doğrulanmış anahtarla açılabilir */}
      <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[var(--oem-surface-2)] border border-[var(--oem-line)]">
        <div className="flex flex-col">
          <span className="text-[12px] font-bold text-[color:var(--oem-ink)]">Mavi'de yeni AI Gateway'i kullan</span>
          <span className="text-[10px] text-[color:var(--oem-ink-3)] leading-snug">
            {canToggle
              ? 'Kapatırsanız Mavi eski yapay zekâ bağlantısıyla çalışmaya devam eder.'
              : 'Önce anahtarı kaydedip bağlantıyı test edin.'}
          </span>
        </div>
        <button
          onClick={() => { void handleToggleGateway(); }}
          disabled={!canToggle && !gatewayOn}
          aria-pressed={gatewayOn}
          className={`relative w-12 h-7 rounded-full transition-all flex-shrink-0 disabled:opacity-40 ${gatewayOn ? 'bg-emerald-500/80' : 'bg-white/15'}`}
        >
          <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${gatewayOn ? 'left-6' : 'left-1'}`} />
        </button>
      </div>
    </div>
  );
}

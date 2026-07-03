'use client';

/**
 * /key-beam — "QR Key Beam" köprü sayfası.
 *
 * Araç ekranındaki QR şu formatta bir URL üretir:
 *   https://carospro.com/key-beam?code=ABC123XY&exp=<epoch_ms>#k=<base64url anahtar>
 *
 * - `code` ve `exp` query'de (sunucuya gidebilir — hassas değil).
 * - `k` (simetrik AES anahtarı) URL FRAGMENT'ında — tarayıcı bunu asla
 *   sunucuya göndermez. Yalnızca bu sayfa (client-side) okuyabilir.
 *
 * Akış: kullanıcı Gemini API key'i alır → buraya yapıştırır → bu sayfa
 * key'i fragment'taki anahtarla AES-256-GCM şifreler → yalnızca ciphertext
 * Supabase'e yazılır (submit_key_beam RPC). Plaintext key hiçbir ağ isteğine
 * dahil olmaz.
 */

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabaseBrowser, isSupabaseConfigured } from '@/lib/supabase';
import { importBeamKey, encryptBeamPayload, API_KEY_BEAM_REGEX } from '@/lib/keyBeamCrypto';

type Status = 'idle' | 'sending' | 'sent' | 'error';

export default function KeyBeamPage() {
  return (
    <Suspense fallback={null}>
      <KeyBeamInner />
    </Suspense>
  );
}

function KeyBeamInner() {
  const searchParams = useSearchParams();
  const code = searchParams.get('code') ?? '';
  const expParam = searchParams.get('exp');
  const exp = expParam ? Number(expParam) : null;

  // kind: araç QR'ı hangi sağlayıcı için üretti → doğru talimat + "Key Al" linki.
  // Verilmezse (eski QR / jenerik) "API" fallback'i gösterilir.
  const kind = searchParams.get('kind') ?? '';
  const PROVIDER: { name: string; paste: string; url: string; host: string } = ({
    gemini: { name: 'Gemini',        paste: 'Gemini API anahtarınızı',        url: 'https://aistudio.google.com/apikey',            host: 'aistudio.google.com' },
    tavily: { name: 'Tavily',        paste: 'Tavily arama anahtarınızı',      url: 'https://app.tavily.com',                        host: 'app.tavily.com' },
    groq:   { name: 'Groq',          paste: 'Groq API anahtarınızı',          url: 'https://console.groq.com/keys',                 host: 'console.groq.com' },
    haiku:  { name: 'Claude Haiku',  paste: 'Claude Haiku API anahtarınızı',  url: 'https://console.anthropic.com/settings/keys',   host: 'console.anthropic.com' },
  } as const)[kind as 'gemini' | 'tavily' | 'groq' | 'haiku'] ?? { name: 'API', paste: 'API anahtarınızı', url: '', host: '' };

  const [fragmentKey, setFragmentKey] = useState<string | null>(null);
  const [value, setValue]             = useState('');
  const [status, setStatus]           = useState<Status>('idle');
  const [errorMsg, setErrorMsg]       = useState('');

  // Fragment yalnızca client-side okunabilir (Next.js SSR'da window yok).
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    setFragmentKey(params.get('k'));
  }, []);

  const isExpired = exp !== null && Date.now() > exp;
  const isValidLink = Boolean(code) && Boolean(fragmentKey);
  const isValidFormat = API_KEY_BEAM_REGEX.test(value.trim());

  const handleSend = useCallback(async () => {
    if (!isValidLink || !fragmentKey || !isValidFormat || status === 'sending') return;

    setStatus('sending');
    setErrorMsg('');

    try {
      if (!isSupabaseConfigured || !supabaseBrowser) {
        throw new Error('Sunucu yapılandırılmamış. Lütfen daha sonra tekrar deneyin.');
      }

      const key = await importBeamKey(fragmentKey);
      const { ciphertext, iv } = await encryptBeamPayload(value.trim(), key);

      const { data, error } = await supabaseBrowser.rpc('submit_key_beam', {
        p_code:       code,
        p_ciphertext: ciphertext,
        p_iv:         iv,
      });

      if (error) throw new Error(error.message);
      const ok = (data as { ok?: boolean } | null)?.ok;
      if (!ok) throw new Error('Anahtar gönderilemedi.');

      setStatus('sent');
      setValue('');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Beklenmeyen bir hata oluştu.');
    }
  }, [isValidLink, fragmentKey, isValidFormat, status, code, value]);

  const canSubmit = isValidLink && !isExpired && isValidFormat && status !== 'sending' && status !== 'sent';

  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center px-5 py-10"
      style={{ background: '#060d1a' }}
    >
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-64 rounded-full bg-blue-500/[0.06] blur-[80px]" />
      </div>

      <div
        className="relative z-10 w-full max-w-sm rounded-3xl p-6"
        style={{
          background:  'linear-gradient(145deg, #0c1a2e 0%, #070f1d 100%)',
          border:      '1px solid rgba(59,130,246,0.12)',
          boxShadow:   '0 0 40px rgba(59,130,246,0.06), 0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div className="flex flex-col items-center gap-2 text-center mb-6">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-1"
            style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)' }}
          >
            <span className="text-2xl">🔑</span>
          </div>
          <h1 className="text-white font-bold text-base">{PROVIDER.name} Anahtarını Araca Gönder</h1>
          <p className="text-white/40 text-xs leading-relaxed max-w-[260px]">
            {PROVIDER.paste} buraya yapıştırın — uçtan uca şifrelenip
            doğrudan aracınıza iletilecek.
          </p>
        </div>

        {!isValidLink && (
          <p className="text-center text-sm text-red-300/80 py-4">
            Geçersiz bağlantı. Lütfen araç ekranındaki QR kodu tekrar okutun.
          </p>
        )}

        {isValidLink && isExpired && (
          <p className="text-center text-sm text-red-300/80 py-4">
            Bu kodun süresi doldu. Araç ekranında yeni bir QR üretin.
          </p>
        )}

        {isValidLink && !isExpired && status !== 'sent' && (
          <div className="flex flex-col gap-3">
            {PROVIDER.url && (
              <a
                href={PROVIDER.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-400 text-sm font-bold hover:bg-blue-500/20 active:scale-[0.98] transition-all"
              >
                🔑 Key Al — {PROVIDER.host}
              </a>
            )}

            <input
              type="text"
              value={value}
              onChange={(e) => { setValue(e.target.value); if (status === 'error') setStatus('idle'); }}
              placeholder="AIza... / AQ..."
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="w-full bg-white/5 border rounded-xl px-3.5 py-2.5 text-white text-sm placeholder:text-white/25 outline-none transition-all font-mono"
              style={{
                borderColor: value.length === 0
                  ? 'rgba(255,255,255,0.1)'
                  : isValidFormat
                  ? 'rgba(52,211,153,0.4)'
                  : 'rgba(239,68,68,0.4)',
              }}
            />

            {value.length > 0 && !isValidFormat && (
              <p className="text-[11px] text-red-400/80 -mt-1">Anahtar formatı tanınmadı (AIza... veya AQ....).</p>
            )}

            {status === 'error' && (
              <p className="text-[11px] text-red-400/80 -mt-1">{errorMsg}</p>
            )}

            <button
              onClick={() => void handleSend()}
              disabled={!canSubmit}
              className="w-full py-3.5 rounded-2xl font-bold text-white text-sm tracking-wide transition-all duration-150 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                boxShadow:  '0 8px 24px rgba(59,130,246,0.25)',
              }}
            >
              {status === 'sending' ? 'Gönderiliyor…' : 'Araca Gönder'}
            </button>

            <p className="text-white/20 text-[10px] text-center leading-relaxed">
              Anahtar bu cihazda şifrelenir; sunucu yalnızca şifreli veriyi görür.
            </p>
          </div>
        )}

        {status === 'sent' && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.35)' }}
            >
              <svg width="26" height="26" viewBox="0 0 36 36" fill="none">
                <path d="M11 18l5 5 9-9" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-white font-semibold text-sm">Anahtar araca gönderildi</p>
            <p className="text-white/40 text-xs">Araç ekranında &quot;Key algılandı ✓&quot; yazısını görmelisiniz.</p>
          </div>
        )}
      </div>
    </div>
  );
}

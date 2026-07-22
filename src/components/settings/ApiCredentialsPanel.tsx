/**
 * ApiCredentialsPanel — TÜM API anahtarları için TEK birleşik ayar paneli.
 *
 * Panel tamamen `credentialRegistry` tarafından SÜRÜLÜR: sıra, etiket, rol
 * açıklaması, "gelişmiş" gizlemesi, pano otomatik algılama, QR aktarımı,
 * `.env` rozeti ve doğrulama tanımdan gelir. Burada sağlayıcıya özel `if`
 * YOKTUR → yeni sağlayıcı eklemek bu dosyayı DEĞİŞTİRMEZ.
 *
 * ── ANAHTAR GİZLİLİĞİ (UI sözleşmesi) ───────────────────────────────────────
 *  - Kayıtlı anahtar EKRANA GERİ OKUNMAZ. Yalnız "kayıtlı" + MASKELİ özet.
 *  - Kullanıcının YAZDIĞI metin geçici state'tedir; kaydedince ve bileşen
 *    kalkarken TEMİZLENİR.
 *  - Göster/gizle yalnız O AN YAZILAN metin içindir.
 *  - Tüm depo/ağ işleri `apiCredentialManager` üzerinden yapılır (Keystore).
 *
 * ÖNCEKİ DAVRANIŞTAN KORUNANLAR: rol rehberi · cihaz-içi yedek durumu · pano
 * otomatik algılama · QR ile telefondan getirme · `.env` rozeti · "Gelişmiş"
 * bölümü · bölüm başına bağlantı testi.
 * DEĞİŞEN: bağlantı testi artık TOKEN HARCAMAYAN metadata uç noktalarını
 * kullanıyor (eskiden gerçek bir sohbet isteği gönderiliyordu).
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, ChevronRight, Eye, EyeOff, Info, Loader, Mic, ShieldCheck, XCircle } from 'lucide-react';
import { Clipboard } from '@capacitor/clipboard';
import { isNative } from '../../platform/bridge';
import { CarLauncher } from '../../platform/nativePlugin';
import { openInApp } from '../../platform/inAppBrowser';
import { KeyBeamPanel } from './KeyBeamPanel';
import { MaviGatewayToggle } from './MaviGatewayToggle';
import {
  credentialStatusMessage,
  getCredentialInfo,
  keyFormatMessage,
  removeCredential,
  saveCredential,
  verifyCredential,
} from '../../platform/ai/credentials/apiCredentialManager';
import { API_CREDENTIALS, matchCredentialByClipboard } from '../../platform/ai/credentials/credentialRegistry';
import type { ApiCredentialDescriptor, ApiCredentialId, ApiCredentialStatus } from '../../platform/ai/credentials/credentialTypes';

/** Gateway şalteri yalnız bu kimliğin satırında gösterilir (tek özel durum). */
const GATEWAY_CREDENTIAL_ID: ApiCredentialId = 'openrouter';

function toneOf(status: ApiCredentialStatus): string {
  if (status === 'connected')      return 'text-emerald-400';
  if (status === 'checking')       return 'text-sky-400';
  if (status === 'not_configured') return 'text-[color:var(--oem-ink-3)]';
  return 'text-red-400';
}

/* ── Tek kimlik bilgisi satırı (tamamen tanımdan sürülür) ─────────────────── */

interface RowProps {
  readonly desc:      ApiCredentialDescriptor;
  /** Pano algılaması bu satıra yazdıysa dışarıdan tetiklenen tazeleme sayacı. */
  readonly refreshTick: number;
  readonly onSaved:   () => void;
}

const CredentialRow = memo(function CredentialRow({ desc, refreshTick, onSaved }: RowProps) {
  const [draft, setDraft]           = useState('');
  const [showDraft, setShowDraft]   = useState(false);
  const [configured, setConfigured] = useState(false);
  const [masked, setMasked]         = useState('');
  const [status, setStatus]         = useState<ApiCredentialStatus>('not_configured');
  const [notice, setNotice]         = useState<string | null>(null);
  const [busy, setBusy]             = useState(false);
  const [showBeam, setShowBeam]     = useState(false);
  const aliveRef = useRef(true);

  const envKey = desc.getEnvKey?.() ?? '';

  const refresh = useCallback(async () => {
    const info = await getCredentialInfo(desc.id);
    if (!aliveRef.current) return;
    setConfigured(info.configured);
    setMasked(info.masked);
    if (!info.configured) setStatus('not_configured');
  }, [desc.id]);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    return () => {
      aliveRef.current = false;
      setDraft('');            // hassas girdi temizlenir (zero-retention)
      setShowDraft(false);
    };
  }, [refresh, refreshTick]);

  const handleSave = useCallback(async (raw?: string) => {
    const value = raw ?? draft;
    setBusy(true);
    setNotice(null);
    const result = await saveCredential(desc.id, value);
    if (!aliveRef.current) return;
    if (!result.ok) {
      setNotice(keyFormatMessage(result.reason));   // mesaj anahtarı İÇERMEZ
      setBusy(false);
      return;
    }
    setDraft('');                                   // ham anahtar UI'dan SİLİNİR
    setShowDraft(false);
    setConfigured(true);
    setMasked(result.masked);
    setStatus('not_configured');                    // yeni anahtar henüz doğrulanmadı
    setNotice('Anahtar cihaza güvenli biçimde kaydedildi.');
    setBusy(false);
    onSaved();
  }, [desc.id, draft, onSaved]);

  const handleTest = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    setStatus('checking');
    const result = await verifyCredential(desc.id);
    if (!aliveRef.current) return;
    setStatus(result);
    setBusy(false);
  }, [desc.id]);

  const handleRemove = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    await removeCredential(desc.id);
    if (!aliveRef.current) return;
    setDraft('');
    setShowDraft(false);
    setConfigured(false);
    setMasked('');
    setStatus('not_configured');
    setNotice('Anahtar silindi.');
    setBusy(false);
    onSaved();
  }, [desc.id, onSaved]);

  return (
    <div className="flex flex-col gap-2 p-3 rounded-xl bg-[var(--oem-surface-2)] border border-[var(--oem-line)]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-[color:var(--oem-ink)] uppercase tracking-wider">{desc.label}</span>
        {configured
          ? <span className="text-[9px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-mono">Kayıtlı ✓ {masked}</span>
          : envKey
            ? <span className="text-[9px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-mono">.env&apos;den okunuyor</span>
            : <span className="text-[9px] px-2 py-0.5 rounded bg-white/10 text-[color:var(--oem-ink-3)] border border-white/10">Yapılandırılmadı</span>
        }
      </div>

      {desc.roleHint && (
        <p className="text-[10px] text-[color:var(--oem-ink-3)] leading-snug">{desc.roleHint}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => openInApp(desc.docsUrl)}
          className="flex-1 min-w-[140px] flex items-center justify-center gap-1.5 py-2 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-400 text-[11px] font-bold hover:bg-blue-500/20 active:scale-[0.98] transition-all"
        >
          <span>🔑</span> Anahtar Al
        </button>
        {desc.keyBeamKind && (
          <button
            onClick={() => setShowBeam((v) => !v)}
            className="flex-1 min-w-[140px] flex items-center justify-center gap-1.5 py-2 rounded-lg border border-purple-500/30 bg-purple-500/10 text-purple-300 text-[11px] font-bold hover:bg-purple-500/20 active:scale-[0.98] transition-all"
          >
            <span>📱</span> {showBeam ? 'QR\'ı Gizle' : 'Telefonla Getir (QR)'}
          </button>
        )}
      </div>

      {showBeam && desc.keyBeamKind && (
        <KeyBeamPanel
          keyKind={desc.keyBeamKind}
          onKeySaved={(k) => { void handleSave(k); }}
          onClose={() => setShowBeam(false)}
        />
      )}

      <div className="relative">
        <input
          type={showDraft ? 'text' : 'password'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={configured ? 'Yeni anahtar girerek değiştirebilirsiniz' : (desc.placeholder ?? 'Anahtarı yapıştırın')}
          autoComplete="off"
          spellCheck={false}
          className="w-full bg-[var(--oem-surface)] border border-[var(--oem-line)] rounded-lg px-3 py-2 text-[color:var(--oem-ink)] text-sm placeholder:text-[color:var(--oem-ink-3)] outline-none focus:border-[var(--oem-accent)] transition-all pr-10"
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
          disabled={busy || draft.trim().length === 0}
          className="px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-all active:scale-95 disabled:opacity-40 border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
        >
          Kaydet
        </button>
        <button
          onClick={() => { void handleTest(); }}
          disabled={busy || (!configured && !envKey)}
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
          <XCircle className="w-3.5 h-3.5" /> Sil
        </button>
      </div>

      {desc.verifyCostsQuota && (
        <p className="text-[10px] text-amber-200/80 leading-snug">
          Bu sağlayıcıda bağlantı testi hesabınızdan küçük bir kullanım hakkı harcar.
        </p>
      )}

      <div className="flex items-center gap-1.5 text-[11px] font-medium">
        {status === 'connected'
          ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
          : status === 'checking'
            ? <Loader className="w-3.5 h-3.5 text-sky-400 animate-spin" />
            : <Info className="w-3.5 h-3.5 text-[color:var(--oem-ink-3)]" />
        }
        <span className={toneOf(status)}>{credentialStatusMessage(status)}</span>
      </div>

      {notice && (
        <div className="px-3 py-2 rounded-lg text-[11px] font-medium border bg-[var(--oem-surface)] border-[var(--oem-line)] text-[color:var(--oem-ink-2)]">
          {notice}
        </div>
      )}

      {/* Yalnız OpenRouter satırında: Mavi'nin yeni AI Gateway şalteri */}
      {desc.id === GATEWAY_CREDENTIAL_ID && (
        <MaviGatewayToggle configured={configured} verified={status === 'connected'} />
      )}
    </div>
  );
});

/* ── Birleşik panel ───────────────────────────────────────────────────────── */

export const ApiCredentialsPanel = memo(function ApiCredentialsPanel() {
  const [showAdvanced, setShowAdvanced]   = useState(false);
  const [clipboardHint, setClipboardHint] = useState<string | null>(null);
  const [waitingClip, setWaitingClip]     = useState(false);
  const [refreshTick, setRefreshTick]     = useState(0);
  const [deviceBackupStatus, setDeviceBackupStatus] =
    useState<{ writable: boolean; needsAllFiles: boolean } | null>(null);
  const clipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const primary  = API_CREDENTIALS.filter((c) => !c.advanced);
  const advanced = API_CREDENTIALS.filter((c) => c.advanced);

  const refreshDeviceBackupStatus = useCallback(() => {
    if (!isNative) return;
    void (CarLauncher as unknown as {
      deviceKeyBackupStatus?: () => Promise<{ writable: boolean; needsAllFiles: boolean }>;
    }).deviceKeyBackupStatus?.().then((s) => setDeviceBackupStatus(s)).catch(() => undefined);
  }, []);

  useEffect(() => { refreshDeviceBackupStatus(); }, [refreshDeviceBackupStatus]);
  useEffect(() => () => { if (clipTimerRef.current) clearTimeout(clipTimerRef.current); }, []);

  /**
   * Panoyu okur ve KAYIT DEFTERİNDEKİ desenlere göre doğru sağlayıcıya yazar.
   * Sağlayıcıya özel `if` yok — `matchCredentialByClipboard` karar verir.
   */
  const checkClipboard = useCallback(async () => {
    try {
      let text = '';
      if (isNative) {
        const { value } = await Clipboard.read();
        text = value ?? '';
      } else {
        text = await navigator.clipboard.readText().catch(() => '');
      }
      const desc = matchCredentialByClipboard(text);
      if (desc) {
        const saved = await saveCredential(desc.id, text);
        if (saved.ok) {
          if (desc.advanced) setShowAdvanced(true);   // girilen anahtar görünür kalsın
          setRefreshTick((t) => t + 1);               // satırlar kendini tazelesin
          setClipboardHint(`${desc.label} anahtarı otomatik algılandı!`);
          setWaitingClip(false);
        }
      }
      if (clipTimerRef.current) clearTimeout(clipTimerRef.current);
      clipTimerRef.current = setTimeout(() => setClipboardHint(null), 4000);
    } catch { /* pano izni yok */ }
  }, []);

  useEffect(() => {
    if (!waitingClip) return;
    const onFocus = () => { void checkClipboard(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') void checkClipboard(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [waitingClip, checkClipboard]);

  const onSaved = useCallback(() => { setRefreshTick((t) => t + 1); }, []);

  return (
    <div className="mt-8 pt-8 border-t border-white/10 flex flex-col gap-4">
      <div className="flex items-center gap-2 mb-1">
        <Mic className="w-4 h-4 text-purple-400" />
        <span className="text-[10px] font-black uppercase tracking-[0.4em] text-purple-400/70">Yapay Zekâ Anahtarları</span>
        <span className="ml-auto text-[9px] px-2 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/20 font-mono">İnternet gerektirir</span>
      </div>

      {/* Rol rehberi — kayıt defterinden üretilir */}
      <div className="flex flex-col gap-2 p-3 rounded-xl bg-purple-500/10 border border-purple-500/20">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-purple-300 flex-shrink-0" />
          <span className="text-[11px] font-bold text-purple-200">Asistan senin kendi anahtarlarınla çalışır:</span>
        </div>
        <ul className="flex flex-col gap-1.5 pl-1 text-[11px] text-[color:var(--oem-ink-2)] leading-snug">
          {API_CREDENTIALS.filter((c) => c.roleHint).map((c) => (
            <li key={c.id}>
              <span className="font-bold text-purple-300">{c.label}</span> — {c.roleHint}
            </li>
          ))}
        </ul>
        <p className="text-[10px] text-[color:var(--oem-ink-3)] leading-snug pl-1">
          Anahtarlar yalnızca cihazında şifreli olarak saklanır. Kullanım, kendi hesabının kota ve ücretlendirmesine tabidir.
        </p>
      </div>

      {/* Cihaz-içi anahtar yedeği — Google'sız, uninstall'a dayanıklı */}
      {isNative && deviceBackupStatus && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-medium border bg-[var(--oem-surface-2)] border-[var(--oem-line)] text-[color:var(--oem-ink-2)]">
          {deviceBackupStatus.needsAllFiles ? (
            <>
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
              <span className="flex-1">Anahtarlar cihaza yedeklenmiyor — izin gerekli</span>
              <button
                onClick={() => { void CarLauncher.requestAllFilesAccess().then(refreshDeviceBackupStatus); }}
                className="px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 font-bold hover:bg-amber-500/25 active:scale-[0.98] transition-all"
              >
                İzin ver
              </button>
            </>
          ) : (
            <>
              <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 text-emerald-400" />
              <span>Anahtarlar cihaza yedekleniyor ✓ — uygulama silinse bile kaybolmaz</span>
            </>
          )}
        </div>
      )}

      {clipboardHint && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border ${
          clipboardHint.includes('algılandı')
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-blue-500/10 border-blue-500/30 text-blue-400'
        }`}>
          {clipboardHint.includes('algılandı')
            ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
            : <Loader className="w-3.5 h-3.5 flex-shrink-0 animate-spin" />
          }
          {clipboardHint}
        </div>
      )}

      {primary.map((c) => (
        <CredentialRow key={c.id} desc={c} refreshTick={refreshTick} onSaved={onSaved} />
      ))}

      {advanced.length > 0 && (
        <>
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-2 w-full py-2 text-[11px] font-bold text-[color:var(--oem-ink-3)] hover:text-[color:var(--oem-ink)] transition-colors"
          >
            <ChevronRight className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
            Gelişmiş — yedek beyinler ve internet araması ({advanced.length})
          </button>
          {showAdvanced && advanced.map((c) => (
            <CredentialRow key={c.id} desc={c} refreshTick={refreshTick} onSaved={onSaved} />
          ))}
        </>
      )}

      <div className="p-3 rounded-xl bg-[var(--oem-surface-2)] border border-[var(--oem-line)] text-[10px] text-[color:var(--oem-ink-3)] leading-relaxed">
        <span className="text-[color:var(--oem-ink-2)] font-bold">Nasıl çalışır?</span>
        {' '}Offline parser tanıyamadığında (%50 altı güven) AI devreye girer. İnternet yoksa otomatik olarak offline modda çalışır.
        {' '}<span className="text-[color:var(--oem-ink-3)]">Anahtarlar cihazda şifrelenmiş olarak saklanır.</span>
      </div>
    </div>
  );
});

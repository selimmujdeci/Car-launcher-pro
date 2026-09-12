/**
 * CarosLabShell — CAROS LAB geliştirici merkezi (FAZ A).
 *
 * SORUMLULUK: kategori sekmeleri + araç kartları + tek aktif araç ekranı. Shell'in
 * KENDİSİ hiçbir OBD/AI servisi başlatmaz — mount maliyeti yalnız statik katalog
 * render'ıdır. Servis dokunuşu YALNIZ açılan ekranın içindedir ve ekran kapanınca
 * unmount ile temizlenir (zero-leak).
 *
 * GERİ NAVİGASYON: araç açıkken "GERİ" katalog'a döner; katalogdayken "KAPAT"
 * çekmeceyi kapatır (MainLayout'un mevcut Android geri tuşu davranışı DEĞİŞMEZ —
 * donanım geri tuşu çekmeceyi kapatır, o yol hiç ellenmedi).
 */

import { memo, useCallback, useMemo, useReducer, useState } from 'react';
import { ChevronLeft, ClipboardCopy, FlaskConical, X } from 'lucide-react';
import {
  CAROS_LAB_CATEGORIES, CAROS_LAB_CATEGORY_LABEL, CAROS_LAB_STATUS_LABEL,
  toolsByCategory, getCarosLabTool, statusTone,
  type CarosLabTool, type CarosLabToolId, type CarosLabToolStatus,
} from '../../platform/devtools/carosLabCatalog';
import {
  carosLabNavReduce, CAROS_LAB_INITIAL_NAV,
} from '../../platform/devtools/carosLabNavigation';
import { CarosLabToolHost } from './CarosLabToolHost';
import { CarosLabRefreshBar } from './CarosLabRefreshBar';
import { useObdTrafficCapture, useCanCollect } from '../../hooks/useDevtoolsCapture';
import {
  buildCarosLabCopy, buildCarosLabDomainCopy, type CarosLabCopyDomain,
} from '../../platform/devtools/carosLabCopyModel';
import { readCarosLabCopyInput } from '../../platform/devtools/carosLabCopySources';
import { copyTextFailSoft, describeClipboardRoute } from '../../platform/devtools/carosLabClipboard';

/* BÖLÜM-BAZLI KOPYA MENÜSÜ — repo authority map'inde GERÇEKTEN bulunan ana LAB
   domainleri (`CarosLabCopyDomain`, bkz. carosLabCopyModel.ts). 'genel' bilerek
   DIŞARIDA: o bir domain değil, tek bir kategoriye ait olmayan kalıntı
   kovasıdır (katalog/kanıt/hata kütüğü) — hızlı menüde AYRI bir "ana domain"
   gibi sunulması yanıltıcı olurdu; `buildCarosLabDomainCopy(input,'genel')`
   programatik olarak yine kullanılabilir. */
const DOMAIN_COPY_BUTTONS: readonly [CarosLabCopyDomain, string][] = [
  ['mavi',       'Mavi Kopyala'],
  ['obd',        'OBD Kopyala'],
  ['can',        'CAN Kopyala'],
  ['navigation', 'Navigasyon Kopyala'],
  ['runtime',    'Runtime Kopyala'],
  ['phoneLink',  'Phone Link Kopyala'],
];

/* TEMA (SAHA 2026-07-25): CAROS LAB gündüz/aydınlık temada da SİYAH kalıyor ve
   düşük-opaklık metinler okunmuyordu — shell ve tüm araç ekranları sabit `#070b12`
   ve `text-white/xx` · `border-white/xx` değerleri kullanıyordu, yani hiçbir tema
   değişkenine abone DEĞİLDİ. Artık tasarım sisteminin `--oem-*` token'ları kullanılır:
   `html.light-ui` (aydınlık-pro) açık zemin + koyu mürekkep, gece koyu zemin + açık
   mürekkep OTOMATİK gelir; `sunlight-mode` de aynı token'ları ezdiği için güneş altı
   kontrastı bedava. Yeni palet katmanı YOK — mevcut tek katman (design-system.css).
   Kural: bu ağaçta sabit renk (hex / text-white / *-500) KULLANILMAZ.
   Not: soluk `--oem-ink-4` (α .34) güneşte okunmadığı için en soluk seviye
   `--oem-ink-3`'tür. Marka aksanı cyan yerine `--oem-info` (açık zeminde okunur). */
const TONE_CLASS: Record<'ok' | 'muted' | 'blocked', string> = {
  ok:      'border-[var(--oem-good)]   bg-[var(--oem-good-soft)]   text-[var(--oem-good)]',
  muted:   'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  blocked: 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
};

/* ── Araç kartı ──────────────────────────────────────────────────────────── */

const ToolCard = memo(function ToolCard({
  tool, onOpen,
}: { tool: CarosLabTool; onOpen: (id: CarosLabToolId) => void }) {
  const disabled = tool.status === 'DISABLED';
  const tone = statusTone(tool.status);

  // DISABLED kart için `disabled` + reducer'ın 'open' NO-OP'u iki katmanlı koruma sağlar.
  const handleClick = useCallback(() => { onOpen(tool.id); }, [tool.id, onOpen]);

  return (
    <button
      type="button"
      data-testid={`lab-card-${tool.id}`}
      data-status={tool.status}
      disabled={disabled}
      aria-disabled={disabled}
      onClick={handleClick}
      className={`flex flex-col items-start gap-1.5 rounded border p-3 text-left transition-colors ${
        disabled
          ? 'cursor-not-allowed border-[var(--oem-line)] bg-[var(--oem-surface-0)] opacity-60'
          : 'border-[var(--oem-line)] bg-[var(--oem-surface-1)] hover:border-[var(--oem-accent)] hover:bg-[var(--oem-accent-soft)]'
      }`}
    >
      <div className="flex w-full items-center gap-2">
        <span className="font-mono text-[12px] uppercase tracking-wide text-[var(--oem-ink)]">{tool.name}</span>
        <span
          data-status={tool.status}
          title={tool.status}
          className={`ml-auto shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${TONE_CLASS[tone]}`}
        >
          {CAROS_LAB_STATUS_LABEL[tool.status]}
        </span>
      </div>

      {tool.layer && (
        <span className="rounded border border-[var(--oem-line-strong)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
          {tool.layer}
        </span>
      )}

      <p className="text-[11px] leading-relaxed text-[var(--oem-ink-2)]">{tool.desc}</p>

      {tool.note && (
        <p className="mt-0.5 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{tool.note}</p>
      )}
    </button>
  );
});

/* ── Shell ───────────────────────────────────────────────────────────────── */

export const CarosLabShell = memo(function CarosLabShell({ onClose }: { onClose: () => void }) {
  const [nav, dispatch] = useReducer(carosLabNavReduce, CAROS_LAB_INITIAL_NAV);
  const { category, activeId } = nav;

  /* YAKALAMA KAPSAMI (SAHA 2026-07-25): önce OBD ham trafiği ve CAN kütüğü YALNIZ
     kendi ekranları açıkken toplanıyordu → katalogdan "TÜMÜNÜ KOPYALA" basınca o iki
     bölüm boş çıkıyordu ("(kayıt yok)"), çünkü tampon hiç dolmamıştı. Artık yakalama
     LAB AÇIK OLDUĞU SÜRECE etkindir; LAB kapanınca durur.
     ZERO-LEAK / İKİNCİ MOTOR YOK: kanal ref-count'ludur — ekranlar da aynı kanalı
     acquire eder, iki kez açılmaz ve biri kapanınca diğerininki KAPANMAZ.
     BÜTÇE: maliyet yalnız LAB açıkken oluşur; normal sürüşte (LAB kapalı) SIFIR. */
  useObdTrafficCapture();
  useCanCollect();

  const tools  = useMemo(() => toolsByCategory(category), [category]);
  const active = useMemo(() => (activeId ? getCarosLabTool(activeId) : null), [activeId]);

  const openTool  = useCallback((id: CarosLabToolId) => dispatch({ type: 'open', id }), []);
  const backToHub = useCallback(() => dispatch({ type: 'back' }), []);

  /* ── TÜMÜNÜ KOPYALA ────────────────────────────────────────────────────────
     SALT-OKUNUR: yalnız mevcut senkron getter'lar okunur (yeni servis/abonelik/
     timer/native pull YOK). Maskeleme saf modelde, ÜÇ kapıdan geçer. Pano üç
     kademeli fail-soft; üçü de düşerse sessizce "kopyalandı" DEMEZ — metni
     seçilebilir biçimde ekrana basar (K24 WebView gerçeği). */
  const [copyMsg,  setCopyMsg]  = useState<string | null>(null);
  const [copyText, setCopyText] = useState<string | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const [domainMenuOpen, setDomainMenuOpen] = useState(false);

  /**
   * TEK ÜRETİM YOLU: `domain === null` → TAM KOPYA (`buildCarosLabCopy`),
   * aksi halde BÖLÜM KOPYASI (`buildCarosLabDomainCopy`) — ikisi de AYNI
   * `readCarosLabCopyInput` + AYNI maskeleme zincirini kullanır; bölüm
   * kopyası TAM KOPYA'nın süzülmüş alt kümesidir, ikinci bir okuma/üretim
   * yolu AÇILMAZ.
   */
  const runCopy = useCallback(async (domain: CarosLabCopyDomain | null) => {
    setCopyBusy(true);
    setCopyText(null);
    try {
      let platform = 'web';
      try {
        const { Capacitor } = await import('@capacitor/core');
        platform = Capacitor.getPlatform();
      } catch { /* fail-soft: platform bilinmiyor */ }

      const input = readCarosLabCopyInput({
        generatedAtWallMs: Date.now(),
        platform,
        // vite.config `VITE_APP_VERSION`i gradle versionName'den enjekte eder.
        appVersion: (import.meta.env.VITE_APP_VERSION as string | undefined) ?? null,
        category,
        activeTool: activeId,
      });
      const built = domain === null ? buildCarosLabCopy(input) : buildCarosLabDomainCopy(input, domain);

      const route = await copyTextFailSoft(built.text);
      const extra = [
        built.droppedCount > 0 ? `${built.droppedCount} kayıt maskelenemedi (düşürüldü)` : null,
        built.truncated ? 'tavan nedeniyle kırpıldı' : null,
        /* S2 (#505): rapor gövdesindeki uyarıyı kaçırmamak için EKRANDA da söylenir —
           tazelenmemiş kanıtla alınan kopya extended poll hakkında hüküm VEREMEZ. */
        built.pollEvidenceStale
          ? '⚠ poll kanıtı TAZELENMEDİ — yukarıdaki TÜMÜNÜ YENİLE ile tazeleyip tekrar kopyalayın'
          : null,
      ].filter(Boolean).join(' · ');
      setCopyMsg(describeClipboardRoute(route, built.chars) + (extra ? ` · ${extra}` : ''));
      if (route === 'failed') setCopyText(built.text);
    } catch {
      // Kopyalama BAŞARISIZ oldu — sahte başarı gösterme.
      setCopyMsg('Kopyalama başarısız oldu (kaynak okunamadı).');
    } finally {
      setCopyBusy(false);
    }
  }, [category, activeId]);

  const copyEverything = useCallback(() => runCopy(null), [runCopy]);
  const copyDomain = useCallback((domain: CarosLabCopyDomain) => {
    setDomainMenuOpen(false);
    void runCopy(domain);
  }, [runCopy]);

  return (
    <div className="flex h-full w-full flex-col bg-[var(--oem-bg)] text-[var(--oem-ink)]" style={{ fontFamily: 'monospace' }}>
      {/* ── SABİT KOMUTA ŞERİDİ ────────────────────────────────────────────
          SAHA (2026-08-25, gerçek cihaz): başlık · yenileme çubuğu · araç künyesi
          ÜÇ AYRI şerittti ve alt alta ~4 satır yiyordu; 7"/10" ünitede içerik için
          neredeyse yer kalmıyordu. Araç künyesi (GERİ · ad · durum · katman) artık
          BU şeride katlandı — bir tam satır kazanıldı. Hiçbir düğme kaldırılmadı,
          hiçbir testid değişmedi; yalnız konum değişti. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--oem-line)] bg-[var(--oem-surface-0)] px-3 py-1.5">
        {active && (
          <button
            type="button"
            data-testid="lab-back"
            onClick={backToHub}
            className="flex shrink-0 items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[10px] text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <ChevronLeft size={12} /> GERİ
          </button>
        )}
        <FlaskConical size={15} className="shrink-0 text-[var(--oem-info)]" />
        <span className="shrink-0 text-[12px] font-bold tracking-[0.18em] text-[var(--oem-info)]">CAROS LAB</span>
        {!active && (
          <span className="hidden text-[10px] text-[var(--oem-ink-3)] sm:inline">FAZ A · GELİŞTİRİCİ PLATFORMU</span>
        )}

        {active && (
          <>
            <span data-testid="lab-breadcrumb" className="min-w-0 truncate text-[11px] uppercase text-[var(--oem-ink-2)]">
              {CAROS_LAB_CATEGORY_LABEL[active.category]} / {active.name}
            </span>
            <StatusChip status={active.status} />
            {active.layer && (
              <span className="hidden shrink-0 rounded border border-[var(--oem-line-strong)] px-1.5 py-0.5 text-[9px] text-[var(--oem-ink-3)] sm:inline">
                {active.layer}
              </span>
            )}
          </>
        )}

        <button
          type="button"
          data-testid="lab-copy-all"
          onClick={() => { void copyEverything(); }}
          disabled={copyBusy}
          title="Katalog · oturum · zamanlama · kanıt · ham OBD/CAN · keşif — hepsi maskeli olarak"
          className="ml-auto flex shrink-0 items-center gap-1 rounded border border-[var(--oem-info)] bg-[var(--oem-info-soft)] px-2 py-1 text-[10px] text-[var(--oem-info)] disabled:opacity-50"
        >
          <ClipboardCopy size={11} /> {copyBusy ? 'KOPYALANIYOR…' : 'TÜMÜNÜ KOPYALA'}
        </button>

        {/* BÖLÜM-BAZLI KOPYA — TAM KOPYA saha teşhisinde bazen ÇOK BÜYÜK
            (Mavi'ye bakan biri 180 bin karakterlik dökümü paylaşmak zorunda
            kalıyordu). Tek dokunuşluk domain kopyası: AYNI kaynak, AYNI
            maskeleme, yalnız SÜZÜLMÜŞ alt küme. Menü — 6 ayrı tam-boy düğme
            dar ekranda komuta şeridini taşırdı (bkz. dosya başındaki şerit
            notu). */}
        <div className="relative shrink-0">
          <button
            type="button"
            data-testid="lab-copy-domain-toggle"
            onClick={() => setDomainMenuOpen((v) => !v)}
            disabled={copyBusy}
            title="Yalnız tek domain — Mavi/OBD/CAN/Navigasyon/Runtime/Phone Link"
            aria-expanded={domainMenuOpen}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[10px] text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)] disabled:opacity-50"
          >
            <ClipboardCopy size={11} /> BÖLÜM ▾
          </button>
          {domainMenuOpen && (
            <div
              data-testid="lab-copy-domain-menu"
              className="absolute right-0 top-full z-10 mt-1 flex w-44 flex-col overflow-hidden rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] py-1 shadow-lg"
            >
              {DOMAIN_COPY_BUTTONS.map(([domain, label]) => (
                <button
                  key={domain}
                  type="button"
                  data-testid={`lab-copy-domain-${domain}`}
                  onClick={() => copyDomain(domain)}
                  disabled={copyBusy}
                  className="px-2 py-1.5 text-left text-[10px] text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)] disabled:opacity-50"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="flex shrink-0 items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[10px] text-[var(--oem-ink-2)] hover:border-[var(--oem-danger)] hover:bg-[var(--oem-danger-soft)]"
        >
          <X size={11} /> KAPAT
        </button>
      </div>

      {/* TÜMÜNÜ YENİLE — tek tuş + otomatik tur. Katalogda da, araç ekranı
          açıkken de görünür: kanıt tazeliği hangi ekranda olduğuna BAĞLI DEĞİLDİR.
          Periyodik turun sahibi bu bileşendir → LAB kapanınca durur (zero-leak). */}
      <CarosLabRefreshBar />

      {copyMsg && (
        <div
          data-testid="lab-copy-msg"
          className="shrink-0 border-b border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-4 py-1 font-mono text-[10px] text-[var(--oem-ink-2)]"
        >
          {copyMsg}
          <button
            type="button"
            onClick={() => { setCopyMsg(null); setCopyText(null); }}
            className="ml-2 underline"
          >
            kapat
          </button>
        </div>
      )}

      {/* Pano üç yolda da düştüyse: metni SEÇİLEBİLİR göster (sahte başarı yerine
          kullanıcının elle kopyalayabileceği gerçek çıkış — K24 WebView deseni). */}
      {copyText && (
        <textarea
          data-testid="lab-copy-fallback"
          readOnly
          value={copyText}
          onFocus={(e) => e.currentTarget.select()}
          className="h-40 shrink-0 resize-none border-b border-[var(--oem-line)] bg-[var(--oem-surface-0)] px-4 py-2 font-mono text-[10px] text-[var(--oem-ink)] outline-none"
        />
      )}

      {active ? (
        /* ── Araç ekranı — YALNIZ BU BÖLGE KAYAR ────────────────────────────
           ÖLÇÜLEN KUSUR (gerçek cihaz): bu sarmalayıcı `overflow-hidden` idi.
           Kendi iç kaydırmasını kuran 45 ekran çalışıyordu, ama kurmayan 24 ekran
           (DTC Kapsamı & ECU Adreslenebilirlik · DTC Otoritesi · Trip Engine ·
           Fleet ekranları …) katlanın ALTINDA KALAN içeriği GÖSTEREMİYORDU —
           içerik kırpılıyordu ve ulaşmanın hiçbir yolu yoktu. "ECU KEŞİF &
           ADRESLENEBİLİRLİK bölümü LAB'da yok" gözlemi tam olarak buydu: bölüm
           vardı, ekrana sığmıyordu.
           `h-full` + kendi kaydırmasını kuran ekranlar ETKİLENMEZ: sarmalayıcı
           kesin yükseklik taşıdığı için `h-full` yine tam oturur, çift kaydırma
           çubuğu OLUŞMAZ. `overscroll-contain`: kaydırma çekmeceye SIZMAZ. */
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          <CarosLabToolHost tool={active} />
        </div>
      ) : (
        /* ── Katalog ── */
        <>
          <div className="flex shrink-0 gap-0 overflow-x-auto border-b border-[var(--oem-line)] bg-[var(--oem-surface-2)]">
            {CAROS_LAB_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                data-testid={`lab-category-${c}`}
                onClick={() => dispatch({ type: 'category', category: c })}
                className={`shrink-0 border-r border-[var(--oem-line)] px-4 py-2 text-[11px] uppercase tracking-wider transition-colors ${
                  category === c
                    ? 'border-b-2 border-b-[var(--oem-info)] bg-[var(--oem-surface-0)] text-[var(--oem-info)]'
                    : 'text-[var(--oem-ink-3)] hover:bg-[var(--oem-surface-0)] hover:text-[var(--oem-ink)]'
                }`}
              >
                {CAROS_LAB_CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {tools.map((t) => (
                <ToolCard key={t.id} tool={t} onOpen={openTool} />
              ))}
            </div>

            <p className="mt-4 font-mono text-[10px] leading-relaxed text-[var(--oem-ink-3)]">
              HAZIR = ekran gerçekten var ve açılıyor · EKRAN YOK = araç henüz yazılmadı ·
              KAPALI = güvenlik politikası gereği kapalı. Ekran içi "YALNIZ ALTYAPI" /
              "BAĞLI DEĞİL" alt-durumları o ekranın kendi başlığında gösterilir.
            </p>
          </div>
        </>
      )}
    </div>
  );
});

const StatusChip = memo(function StatusChip({ status }: { status: CarosLabToolStatus }) {
  return (
    <span
      data-status={status}
      title={status}
      className={`rounded border px-1.5 py-0.5 text-[9px] ${TONE_CLASS[statusTone(status)]}`}
    >
      {CAROS_LAB_STATUS_LABEL[status]}
    </span>
  );
});

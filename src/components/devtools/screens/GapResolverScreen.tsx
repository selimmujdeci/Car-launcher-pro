/**
 * GapResolverScreen — CAROS LAB · Araç · Self-Healing / Gap Resolver.
 *
 * SALT-OKUNUR. Çözüm turu KOŞTURMAZ, ölçüm yapmaz, PDU göndermez, boşluk
 * sicilini DEĞİŞTİRMEZ, timer kurmaz, ağa çıkmaz. Yalnız mevcut senkron
 * getter'ları okur ve elle YENİLE ile tazelenir.
 *
 * ── EKRANIN TEK İDDİASI ─────────────────────────────────────────────────────
 * "Hangi tanı eksikleri AÇIK, kök nedeni NE, hangi GÜVENLİ ölçüm seçildi,
 *  NEDEN seçildi, kaç kez denendi ve kanıt boşluğu GERÇEKTEN kapattı mı."
 *
 * ⚠️ İKİ FARKLI SIFIR AYRI GÖSTERİLİR:
 *   · Çözücü hiç koşmadı → `KAYNAK YOK`
 *   · Koştu ve açık boşluk 0 → `AÇIK GAP 0 — ÖLÇÜLDÜ`
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Wrench } from 'lucide-react';
import {
  readGapResolverSnapshot, type GapResolverRawSnapshot,
} from '../../../platform/devtools/gapResolverSources';
import {
  buildResolverCards, buildResolverRows, deriveResolverVerdict,
  RESOLVER_VERDICT_LABEL, type ResolverVerdict,
} from '../../../platform/devtools/gapResolverModel';
import {
  formatAge, OBSERVABILITY_LABEL,
  type InspectorField, type Observability,
} from '../../../platform/devtools/sessionInspectorModel';

const CLASS_STYLE: Record<Observability, string> = {
  OBSERVED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:     'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

const VERDICT_STYLE: Record<ResolverVerdict, string> = {
  NEVER_RAN:        'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
  NO_GAPS_MEASURED: 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  ACTIVE:           'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  ALL_BLOCKED:      'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  EXHAUSTED_ONLY:   'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

/* P0-VDK-F5D — kanıt bağı rozeti: SAĞLAM yeşil, EKSİK/YOK fail-closed uyarı. */
const EV_OK = 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]';
const EV_BAD = 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]';

const FieldRow = memo(function FieldRow(
  { field, nowMs }: { field: InspectorField; nowMs: number },
) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`heal-field-${field.id}`}
      data-class={field.klass}
      className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-[var(--oem-ink-2)]">{field.label}</span>
          <span className="break-all font-mono text-[11px] text-[var(--oem-ink)]">{field.value}</span>
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
          {field.source}
          {age ? <> · {age}</> : <> · zaman damgası yok</>}
        </div>
        {field.note && (
          <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{field.note}</div>
        )}
      </div>
      <span
        title={field.klass}
        className={`h-fit shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${CLASS_STYLE[field.klass]}`}
      >
        {OBSERVABILITY_LABEL[field.klass]}
      </span>
    </div>
  );
});

export const GapResolverScreen = memo(function GapResolverScreen() {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<GapResolverRawSnapshot>(
    () => readGapResolverSnapshot());

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readGapResolverSnapshot());
  }, []);

  const cards = useMemo(() => buildResolverCards(snap), [snap]);
  const rows = useMemo(() => buildResolverRows(snap), [snap]);
  const verdict = useMemo(() => deriveResolverVerdict(snap), [snap]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="gap-resolver">
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Wrench size={12} /> SELF-HEALING / GAP RESOLVER
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — ölçüm tetiklemez
          </span>
          <button
            type="button"
            data-testid="heal-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Bu ekran çözüm turu KOŞTURMAZ, PDU göndermez, sicili değiştirmez —
          <b>ekranı açmak Self-Healing BAŞLATMAZ</b>. Çözücü hiç koşmadıysa sayaç
          <b>0 değil KAYNAK YOK</b> gösterir; koştu ve açık boşluk gerçekten 0 ise
          <b>AÇIK GAP 0 — ÖLÇÜLDÜ</b> yazar.
        </p>
      </div>

      <div
        data-testid="heal-verdict"
        data-verdict={verdict.status}
        title={verdict.status}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${VERDICT_STYLE[verdict.status]}`}
      >
        ÇÖZÜCÜ GERÇEĞİ: {RESOLVER_VERDICT_LABEL[verdict.status]}
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed opacity-80">
          {verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        <div className="mt-1 text-[9px] opacity-50">
          `RESOLVED` YALNIZ yeni CANLI kanıt boşluğu gerçekten kapattığında verilir;
          "komut gönderdim" ya da "yeniden denedim" çözüm SAYILMAZ.
        </div>
      </div>

      {cards.map((card) => (
        <div
          key={card.id}
          data-testid={`heal-card-${card.id}`}
          className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
              {card.title}
            </span>
          </div>
          <div>
            {card.fields.map((f) => <FieldRow key={f.id} field={f} nowMs={snap.readAt} />)}
          </div>
        </div>
      ))}

      <div
        data-testid="heal-gaps"
        className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
      >
        <div className="border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
          12 · Boşluklar · Seçilen Ölçüm · Kanıt Bağı
        </div>
        {rows.length === 0 ? (
          <div className="px-3 py-3 font-mono text-[10px] text-[var(--oem-ink-3)]">
            KAYNAK YOK — çözücü henüz hiçbir boşluk değerlendirmedi.
          </div>
        ) : (
          <div className="overflow-x-auto">
            {rows.map((r) => (
              <div
                key={r.key}
                data-testid="heal-gap-row"
                data-lifecycle={r.lifecycle}
                className="border-b border-[var(--oem-line)] px-3 py-2 last:border-b-0"
              >
                <div className="flex flex-wrap items-baseline gap-2 font-mono text-[11px]">
                  <span className="font-bold text-[var(--oem-ink)]">{r.gapClass}</span>
                  <span className="text-[var(--oem-ink-2)]">{r.target}</span>
                  <span className="rounded border border-[var(--oem-line-strong)] px-1.5 py-0.5 text-[9px] text-[var(--oem-ink-2)]">
                    {r.lifecycle}
                  </span>
                </div>
                <div className="mt-1 grid gap-0.5 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
                  <div>kaynak: {r.origin} · kök katman: {r.rootLayer} · kök neden: {r.rootCause}</div>
                  <div>seçilen ölçüm: <b>{r.selected}</b></div>
                  <div>neden seçildi: {r.selectionReason}</div>
                  <div>deneme: {r.attempts} · son sonuç: {r.lastOutcome} · istek: {r.requests}</div>
                  {r.detail !== '' && <div>gerekçe: {r.detail}</div>}
                </div>
                {/* P0-VDK-F5D · KANIT BAĞI — ham yanıt GÖSTERİLMEZ. */}
                <div
                  data-testid="heal-gap-evidence"
                  data-evidence={r.evidenceState}
                  className={`mt-1 grid gap-0.5 rounded border px-2 py-1 font-mono text-[9px] leading-relaxed ${
                    r.evidenceState === 'MEASURED' ? EV_OK : EV_BAD}`}
                >
                  <div><b>{r.evidenceLabel}</b></div>
                  <div>
                    ECU: {r.evidenceEcu} · servis: {r.evidenceService} ·
                    sonuç: {r.evidenceOutcome} · NRC: {r.evidenceNrc}
                  </div>
                  <div>köken: {r.evidenceProvenance} · bağ: {r.evidenceCorrelation}</div>
                  <div>kapatan kanıt: {r.resolutionEvidence}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        ARAÇ BÖLÜMLERİ (F5-G): <b>Yetenek öğrenmesi de fiziksel olarak araca
        bağlıdır</b> — her aracın kendi dosyası vardır, dosya sahibini taşır ve
        başka bir aracın kenarını taşıyan dosya tümüyle bozuk sayılır. Boşluk
        sicili ile öğrenme <b>tek çağrıda, tek kapsamla</b> bağlanır; ikisinin
        farklı araca bakması yapısal olarak imkânsızdır (yukarıda <b>parite</b>
        olarak gösterilir). Bölüm sayısı deterministik çöp toplamayla sınırlıdır
        ve <b>aktif aracın bölümü hiçbir koşulda silinmez</b>; kapanmamış tanı
        eksiği olan bir araç, eksiği olmayan uğruna asla önce silinmez. Silme
        yarım kalırsa sessizce başarı sayılmaz, <b>YARIM TEMİZLİK</b> olarak
        görünür ve yeniden denenir.
        <br />
        ARAÇ KAPSAMI (F5-F): Boşluk sicili <b>araca göre bölümlenmiştir</b>.
        Açılışta araç kimliği henüz ölçülmediği için <b>hiçbir sicil yüklenmez</b>;
        gerçek hidrasyon, F4-C parmak izi ölçülüp <b>yeterince güçlü</b> bulunduktan
        sonra üretim keşfi içinde yapılır. Kimlik zayıf ya da yoksa sicil yalnız
        bellekte kalır — <b>başka bir aracın sicili ASLA yüklenmez</b>. Araç
        değişirse eski bölüm yazılıp ayrılır, çözüm durumları ve yoklama defteri
        boşaltılır: iki aracın çalışma durumu karışamaz. Bölüm anahtarı parmak izi
        <b>karmasıdır</b> — ham VIN/MAC ne anahtara ne de dosyaya girer.
        <br />
        KALICILIK (F5-E): Boşluk sicili artık <b>yalnız yerel</b> olarak kalıcıdır
        (mevcut <code>safeStorage</code> atomik yolu; Supabase/FleetKB/ağ TEK BAYT
        yazılmaz). Diske <b>yalnız kökeni <code>live</code> olan</b> kanıtlı satır
        yazılır — replay/sentetik bir boşluk ürünün kalıcı sicilini kirletemez.
        Depo bozuk ya da şeması tanınmazsa sicil <b>FAIL-CLOSED boş başlar</b> ve
        bu durum yukarıda <b>KAYNAK YOK</b> olarak görünür; kayıp kayıt asla
        "çözüldü" sayılmaz. Yer darlığında <b>çözülmemiş bir boşluk, çözülmüş bir
        boşluktan önce ASLA düşmez</b>; tek bir ECU ya da tek bir sinyal ailesi
        sicili işgal edemez (aile ve ECU kotaları) ve her düşürme gerekçesiyle
        birlikte sayılır.
        <br />
        ÜRETİM TETİĞİ (F5-B): Self-Healing yalnız <b>tam araç taraması bittikten
        sonra</b>, AYNI `DiagnosticTransaction` içinde ve onun KALAN bütçesinden
        alınan bir PAYLA çalışır — kendi bütçesini/zamanlayıcısını KURMAZ. Normal
        tanı rezervi korunur; kısmi/başarısız tarama varsa iyileştirme ERTELENİR.
        Aynı OBD oturumunda tur tavanı vardır (anti-storm) ve yeni bir timer
        kurulmadan uygulanır.
        <br />
        KAPSAM SINIRI (dürüstlük): Çözücü KENDİ ölçüm motorunu KURMAZ — her ölçüm
        mevcut F1-A işlem → F1-B oturum → F1-C tuning → F3/F4-A PDU köprüsü →
        F4-B keşif → F4-C öğrenme yolundan geçer. Destructive hiçbir aksiyon
        üretilemez (04 · 11 · 14 · 27 · 28 · 2E · 2F · 31 · 34-37 · 3B · 85);
        aday sözlüğünde yazma/aktüatör/güvenlik eylemi YOKTUR ve TS bozulsa bile
        F4-A native kapısı son kapıdır. Kör ECU/adres taraması YOKTUR: hedef
        çağırandan gelir, uydurulmaz. TAŞIMA sınırı araç sınırı SAYILMAZ — köprü
        taşıyamadıysa "araç desteklemiyor" DENMEZ. Bu fazda YALNIZ salt-okunur
        ölçümler hatta çıkar; oturum açma, keepalive tetikleme, zaman aşımı
        bütçesi oynatma ve ham iz toplama aday olarak GÖRÜNÜR ama ÇALIŞTIRILMAZ
        (`ENGELLİ` gerekçesiyle). Yalnız CANLI kanıt boşluk kapatır;
        replay/sentetik başarı saha başarısı SAYILMAZ. Gerçek araç doğrulaması
        YAPILMADI — saha kütüğü tek otoritedir.
      </p>
    </div>
  );
});

export default GapResolverScreen;

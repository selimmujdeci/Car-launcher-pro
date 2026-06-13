import { memo } from 'react';
import { ArrowLeft, Shield } from 'lucide-react';

interface Props {
  onBack: () => void;
}

export const PrivacyPolicy = memo(function PrivacyPolicy({ onBack }: Props) {
  return (
    <div className="h-full flex flex-col glass-card border-none !shadow-none bg-[var(--oem-surface-0)] backdrop-blur-3xl animate-slide-up">
      {/* Header */}
      <div className="flex items-center gap-6 px-10 py-10 border-b border-[var(--oem-line)] flex-shrink-0 bg-[var(--oem-surface-1)]">
        <button
          onClick={onBack}
          className="flex items-center gap-4 px-8 py-4 bg-[var(--oem-surface-2)] border border-[var(--oem-line)] rounded-2xl active:scale-95 transition-all hover:bg-[var(--oem-surface-3)] group shadow-lg"
        >
          <ArrowLeft className="w-6 h-6 text-[color:var(--oem-ink-2)] group-hover:-translate-x-1 transition-transform" />
          <span className="text-[color:var(--oem-ink)] text-base font-black uppercase tracking-widest">Geri</span>
        </button>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[var(--oem-info-soft)] flex items-center justify-center border border-[var(--oem-info)]">
            <Shield className="w-7 h-7 text-[color:var(--oem-info)]" />
          </div>
          <div>
            <span className="text-[color:var(--oem-ink)] text-3xl font-black uppercase tracking-tight">Gizlilik Politikası</span>
            <div className="text-[color:var(--oem-ink-3)] text-[10px] font-black uppercase tracking-[0.4em] mt-1">Caros Güvenlik Merkezi</div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-10 py-12 space-y-10 custom-scrollbar bg-[var(--oem-surface-0)]">
        <div className="max-w-5xl mx-auto flex flex-col gap-10">
          <Section title="1. Veri Toplama">
            <p>
              Caros Pro, cihazınızda yerel olarak çalışır. Uygulama; GPS konumu,
              OBD araç verileri ve trip logları gibi bilgileri <strong className="text-[color:var(--oem-ink)]">yalnızca cihazınızda</strong> saklar.
              Bu veriler hiçbir sunucuya gönderilmez.
            </p>
          </Section>

          <Section title="2. Konum Verisi">
            <p>
              GPS konumu; navigasyon ve harita gösterimi için kullanılır. Konum verisi
              üçüncü taraflarla paylaşılmaz ve cihaz dışına çıkmaz. Uygulamayı kapattığınızda
              konum izleme durur.
            </p>
          </Section>

          <Section title="3. Araç Teşhis Verileri (OBD)">
            <p>
              OBD-II bağlantısıyla okunan araç hızı, motor sıcaklığı ve DTC kodları
              yalnızca ekranda gösterim amaçlıdır. Bu veriler cihazınızda saklanmaz
              ve herhangi bir sunucuya iletilmez.
            </p>
          </Section>

          <Section title="4. Trip Log">
            <p>
              Trip log kayıtları (süre, mesafe, ort. hız) cihazınızın yerel depolama alanında
              tutulur. Bu kayıtlar isteğe bağlıdır ve uygulama ayarlarından silinebilir.
            </p>
          </Section>

          <Section title="5. Üçüncü Taraf Hizmetler">
            <p>
              Çevrimiçi harita modu etkinleştirildiğinde tile istekleri ilgili harita
              sağlayıcısına (OpenStreetMap, Mapbox vb.) iletilir. Çevrimdışı modda
              herhangi bir dış bağlantı kurulmaz.
            </p>
          </Section>

          <div className="mt-10 py-10 border-t border-[var(--oem-line)] text-center">
            <p className="text-[color:var(--oem-ink-3)] text-[11px] font-black uppercase tracking-[0.5em] opacity-60">
              Son güncelleme: Nisan 2026 · Caros Pro v5.0 Platinum
            </p>
          </div>
        </div>
      </div>
    </div>
  );
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h3 className="text-[color:var(--oem-ink)] font-black text-xl uppercase tracking-widest border-b border-[var(--oem-line)] pb-3">
        {title}
      </h3>
      <div className="text-[color:var(--oem-ink-2)] text-base leading-relaxed font-medium">{children}</div>
    </div>
  );
}



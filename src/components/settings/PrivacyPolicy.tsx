import { memo } from 'react';
import { ArrowLeft, Shield } from 'lucide-react';

interface Props {
  onBack: () => void;
}

export const PrivacyPolicy = memo(function PrivacyPolicy({ onBack }: Props) {
  return (
    <div className="h-full flex flex-col glass-card border-none !shadow-none var(--panel-bg-secondary) backdrop-blur-3xl animate-slide-up">
      {/* Header */}
      <div className="flex items-center gap-6 px-10 py-10 border-b border-white/10 flex-shrink-0 var(--panel-bg-secondary)">
        <button
          onClick={onBack}
          className="flex items-center gap-4 px-8 py-4 var(--panel-bg-secondary) border border-white/10 rounded-2xl active:scale-95 transition-all hover:bg-white/20 group shadow-lg"
        >
          <ArrowLeft className="w-6 h-6 text-primary group-hover:-translate-x-1 transition-transform" />
          <span className="text-primary text-base font-black uppercase tracking-widest">Geri</span>
        </button>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
            <Shield className="w-7 h-7 text-blue-500" />
          </div>
          <div>
            <span className="text-primary text-3xl font-black uppercase tracking-tight">Gizlilik Politikası</span>
            <div className="text-secondary text-[10px] font-black uppercase tracking-[0.4em] opacity-50 mt-1">Caros Güvenlik Merkezi</div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-10 py-12 space-y-10 custom-scrollbar">
        <div className="max-w-5xl mx-auto flex flex-col gap-10">
          <Section title="1. Veri Toplama">
            <p>
              CockpitOS, cihazınızda yerel olarak çalışır. Uygulama; GPS konumu,
              OBD araç verileri ve trip logları gibi bilgileri <strong className="text-primary">yalnızca cihazınızda</strong> saklar.
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

          <div className="mt-10 py-10 border-t border-white/5 text-center">
            <p className="text-secondary text-[11px] font-black uppercase tracking-[0.5em] opacity-30">
              Son güncelleme: Nisan 2026 · CockpitOS v5.0 Platinum
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
      <h3 className="text-primary font-black text-xl uppercase tracking-widest border-b border-primary/10 pb-3">
        {title}
      </h3>
      <div className="text-secondary text-base leading-relaxed font-medium opacity-80">{children}</div>
    </div>
  );
}



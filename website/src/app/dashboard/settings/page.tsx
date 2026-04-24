export default function SettingsPage() {
  return (
    <div className="max-w-2xl flex flex-col gap-6">
      {/* Profil */}
      <section className="p-6 rounded-2xl bg-white/[0.03] border border-white/[0.07]">
        <h2 className="text-sm font-semibold text-white/70 mb-5">Profil</h2>
        <div className="flex flex-col gap-4">
          {[
            { label: 'Ad Soyad', placeholder: 'Admin Kullanıcı', type: 'text' },
            { label: 'E-posta', placeholder: 'admin@carlauncher.pro', type: 'email' },
            { label: 'Şirket', placeholder: 'Caros Pro Ltd.', type: 'text' },
          ].map(({ label, placeholder, type }) => (
            <div key={label}>
              <label className="block text-[11px] text-white/30 mb-1.5 font-medium">{label}</label>
              <input
                type={type}
                defaultValue={placeholder}
                className="w-full bg-white/[0.04] border border-white/[0.1] rounded-xl px-4 py-3 text-sm text-white/70 placeholder-white/20 focus:outline-none focus:border-accent/50 focus:bg-white/[0.06] transition-all"
              />
            </div>
          ))}
          <button className="self-start px-5 py-2.5 rounded-xl bg-accent hover:bg-accent/90 text-white text-sm font-medium transition-colors">
            Kaydet
          </button>
        </div>
      </section>

      {/* Bildirimler */}
      <section className="p-6 rounded-2xl bg-white/[0.03] border border-white/[0.07]">
        <h2 className="text-sm font-semibold text-white/70 mb-5">Bildirim Tercihleri</h2>
        <div className="flex flex-col gap-4">
          {[
            { label: 'Alarm bildirimleri', sub: 'Araç alarmlarında anında bildirim al', on: true },
            { label: 'Hız aşımı uyarıları', sub: '90 km/h üzerinde bildirim', on: true },
            { label: 'Yakıt uyarısı', sub: '%20 altında bildirim', on: true },
            { label: 'Günlük rapor', sub: 'Her gün 09:00\'da özet e-posta', on: false },
          ].map(({ label, sub, on }) => (
            <div key={label} className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm text-white/70">{label}</p>
                <p className="text-[11px] text-white/30 mt-0.5">{sub}</p>
              </div>
              <div className={`w-11 h-6 rounded-full border transition-colors relative cursor-pointer ${on ? 'bg-accent/20 border-accent/40' : 'bg-white/[0.05] border-white/[0.1]'}`}>
                <div className={`absolute top-0.5 w-5 h-5 rounded-full transition-all ${on ? 'left-5 bg-accent' : 'left-0.5 bg-white/20'}`} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Bölge */}
      <section className="p-6 rounded-2xl bg-white/[0.03] border border-white/[0.07]">
        <h2 className="text-sm font-semibold text-white/70 mb-5">Bölge & Zaman</h2>
        <div className="flex flex-col gap-4">
          {[
            { label: 'Zaman Dilimi', value: 'Europe/Istanbul (UTC+3)' },
            { label: 'Dil', value: 'Türkçe' },
            { label: 'Sürüm', value: 'v2.0.0 — Production' },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between py-1 border-b border-white/[0.04] last:border-0">
              <span className="text-sm text-white/40">{label}</span>
              <span className="text-sm text-white/65 font-medium">{value}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

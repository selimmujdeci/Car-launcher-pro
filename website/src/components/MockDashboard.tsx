export default function MockDashboard() {
  return (
    <div className="relative w-full max-w-4xl mx-auto rounded-2xl overflow-hidden border border-white/[0.1] shadow-[0_40px_120px_rgba(0,0,0,0.7)] bg-surface">
      {/* Browser chrome */}
      <div className="flex items-center gap-2 px-4 h-9 bg-[#0a1628] border-b border-white/[0.06]">
        <div className="flex gap-1.5 flex-shrink-0">
          <div className="w-2.5 h-2.5 rounded-full bg-white/[0.08]" />
          <div className="w-2.5 h-2.5 rounded-full bg-white/[0.08]" />
          <div className="w-2.5 h-2.5 rounded-full bg-white/[0.08]" />
        </div>
        <div className="flex-1 mx-3 h-5 bg-white/[0.04] rounded flex items-center px-2.5 gap-1.5">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="flex-shrink-0">
            <path d="M1 4a3 3 0 106 0A3 3 0 001 4z" stroke="rgba(255,255,255,0.2)" strokeWidth="1"/>
          </svg>
          <span className="text-white/20 text-[10px] font-mono">panel.carlauncher.pro/dashboard</span>
        </div>
        <div className="text-[9px] text-white/20 font-mono flex-shrink-0">v2.0</div>
      </div>

      {/* Dashboard */}
      <div className="flex h-[400px]">
        {/* Sidebar */}
        <div className="w-44 border-r border-white/[0.05] flex flex-col py-3 px-2.5 gap-0.5 flex-shrink-0">
          <div className="px-2.5 py-2 mb-2">
            <div className="text-[11px] font-semibold text-accent">Caros Pro</div>
            <div className="text-[9px] text-white/25 mt-0.5">Admin Panel</div>
          </div>
          {[
            { label: 'Genel Bakış', active: true },
            { label: 'Filo Haritası', active: false },
            { label: 'Araçlar', active: false },
            { label: 'Sürücüler', active: false },
            { label: 'Raporlar', active: false },
            { label: 'Ayarlar', active: false },
          ].map(({ label, active }) => (
            <div
              key={label}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] transition-colors ${
                active ? 'bg-accent/15 text-accent' : 'text-white/30'
              }`}
            >
              <div className={`w-1 h-1 rounded-full flex-shrink-0 ${active ? 'bg-accent' : 'bg-white/15'}`} />
              {label}
            </div>
          ))}

          <div className="mt-auto px-2.5 py-2 border-t border-white/[0.05]">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-accent/20 border border-accent/30 flex-shrink-0" />
              <div>
                <div className="text-[9px] text-white/40">Süper Admin</div>
                <div className="text-[9px] text-white/20">admin@filo.co</div>
              </div>
            </div>
          </div>
        </div>

        {/* Main */}
        <div className="flex-1 min-w-0 p-4 flex flex-col gap-3">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-2.5">
            {[
              { label: 'Aktif Araç', value: '24', sub: '+3 bu hafta', color: 'text-emerald-400', dot: 'bg-emerald-400' },
              { label: 'Sürücü', value: '31', sub: '28 çevrimiçi', color: 'text-blue-400', dot: 'bg-blue-400' },
              { label: 'Ort. Hız', value: '67 km/h', sub: 'Son 1 saat', color: 'text-white/70', dot: 'bg-white/30' },
              { label: 'Uyarı', value: '2', sub: 'Hız aşımı', color: 'text-amber-400', dot: 'bg-amber-400' },
            ].map(({ label, value, sub, color, dot }) => (
              <div key={label} className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className={`w-1 h-1 rounded-full ${dot}`} />
                  <div className="text-[9px] text-white/30">{label}</div>
                </div>
                <div className={`text-sm font-bold ${color}`}>{value}</div>
                <div className="text-[9px] text-white/20 mt-0.5">{sub}</div>
              </div>
            ))}
          </div>

          {/* Map + list */}
          <div className="flex gap-3 flex-1 min-h-0">
            {/* Fake map */}
            <div className="flex-1 rounded-xl bg-[#0c1a30] border border-white/[0.05] relative overflow-hidden">
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage:
                    'linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)',
                  backgroundSize: '28px 28px',
                }}
              />
              {/* Roads */}
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 300 200" preserveAspectRatio="xMidYMid slice">
                <path d="M0 105 Q80 85 150 100 Q220 115 300 95" stroke="rgba(255,255,255,0.055)" strokeWidth="7" fill="none" strokeLinecap="round"/>
                <path d="M145 0 Q155 55 150 100 Q145 148 152 200" stroke="rgba(255,255,255,0.055)" strokeWidth="5" fill="none" strokeLinecap="round"/>
                <path d="M0 65 Q60 55 120 80 Q160 95 200 70 L300 55" stroke="rgba(255,255,255,0.035)" strokeWidth="3" fill="none" strokeLinecap="round"/>
                <path d="M60 200 Q90 150 100 110 Q108 80 130 50" stroke="rgba(255,255,255,0.03)" strokeWidth="3" fill="none" strokeLinecap="round"/>
              </svg>

              {/* Vehicle markers */}
              {[
                { x: '22%', y: '42%', id: '001' },
                { x: '51%', y: '33%', id: '002' },
                { x: '67%', y: '58%', id: '003' },
                { x: '38%', y: '67%', id: '004' },
                { x: '78%', y: '27%', id: '005' },
              ].map(({ x, y, id }) => (
                <div key={id} className="absolute" style={{ left: x, top: y, transform: 'translate(-50%,-50%)' }}>
                  <div className="relative w-3.5 h-3.5">
                    <div className="absolute inset-0 rounded-full bg-accent/25 animate-ping" />
                    <div className="absolute inset-1 rounded-full bg-accent" />
                  </div>
                </div>
              ))}

              <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/40 backdrop-blur-sm rounded-lg px-2 py-1">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[9px] text-white/50 font-mono">CANLI • 5 araç</span>
              </div>
            </div>

            {/* Vehicle list */}
            <div className="w-36 flex flex-col gap-1.5 flex-shrink-0 overflow-hidden">
              <div className="text-[9px] text-white/25 px-0.5 mb-0.5 font-semibold tracking-wide uppercase">Araçlar</div>
              {[
                { plate: '34 ABC 001', speed: '72', active: true },
                { plate: '34 XYZ 445', speed: '0', active: false },
                { plate: '06 DEF 223', speed: '95', active: true },
                { plate: '35 GHI 780', speed: '54', active: true },
                { plate: '41 JKL 112', speed: '0', active: false },
              ].map(({ plate, speed, active }) => (
                <div key={plate} className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                  <div className="text-[9px] font-mono text-white/40 mb-1">{plate}</div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-white/65">{speed} km/h</span>
                    <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-400' : 'bg-white/15'}`} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom glow */}
      <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-bg via-transparent to-transparent pointer-events-none" />
    </div>
  );
}

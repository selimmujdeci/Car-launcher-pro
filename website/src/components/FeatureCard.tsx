interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
}

export default function FeatureCard({ icon, title, description, badge }: FeatureCardProps) {
  return (
    <div className="group relative p-6 rounded-2xl bg-white/[0.03] border border-white/[0.07] hover:border-accent/30 hover:bg-white/[0.05] transition-all duration-300 overflow-hidden">
      {/* Subtle glow on hover */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none bg-[radial-gradient(ellipse_at_top_left,rgba(59,130,246,0.06)_0%,transparent_60%)]" />

      <div className="relative">
        {/* Icon */}
        <div className="w-11 h-11 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center mb-5 group-hover:border-accent/40 transition-colors">
          {icon}
        </div>

        {/* Badge */}
        {badge && (
          <span className="absolute top-0 right-0 text-[10px] font-semibold tracking-widest uppercase px-2 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/20">
            {badge}
          </span>
        )}

        <h3 className="font-semibold text-white mb-2.5">{title}</h3>
        <p className="text-sm text-white/50 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

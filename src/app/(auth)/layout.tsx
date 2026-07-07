import { UsersIcon, CalendarBlankIcon, CoinsIcon, BankIcon } from "@phosphor-icons/react/dist/ssr";
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left panel */}
      <div className="relative hidden lg:flex flex-col justify-between bg-zinc-950 p-12 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        <div className="flex items-center gap-2.5 relative">
          <div className="size-8 rounded-lg bg-white flex items-center justify-center">
            <span className="text-xs font-bold text-zinc-900">A</span>
          </div>
          <span className="text-lg font-semibold text-white tracking-tight">Adhéra</span>
        </div>

        <div className="relative space-y-10">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-sky-400">
              Plateforme de gestion associative
            </p>
            <h2 className="text-3xl font-semibold text-white leading-snug">
              Gérez votre association.<br />Simplement.
            </h2>
            <p className="text-zinc-400 text-sm leading-relaxed max-w-xs">
              Membres, cotisations, événements et trésorerie — tout en un seul endroit.
            </p>
          </div>

          <ul className="space-y-4">
            {[
              { Icon: UsersIcon,    label: "Gestion des membres & adhérents" },
              { Icon: CoinsIcon,    label: "Suivi des cotisations"           },
              { Icon: CalendarBlankIcon, label: "Événements & présences"          },
              { Icon: BankIcon, label: "Trésorerie simplifiée"           },
            ].map(({ Icon, label }) => (
              <li key={label} className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-lg bg-white/5">
                  <Icon className="size-4 text-zinc-300" />
                </span>
                <span className="text-sm text-zinc-300">{label}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-zinc-600">
          © {new Date().getFullYear()} Adhéra · Données hébergées en France
        </p>
      </div>

      {/* Right panel */}
      <div className="flex items-center justify-center bg-background p-8">
        {children}
      </div>
    </div>
  )
}

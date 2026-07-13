import {
  UsersIcon,
  CalendarBlankIcon,
  CoinsIcon,
  BankIcon,
} from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import { APP_NAME } from "@/config/brand";
import { LogoMark } from "@/components/layout/logo-mark";
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left panel */}
      <div className="relative hidden lg:flex flex-col justify-between bg-zinc-950 p-12 overflow-hidden">
        <Image
          src="/app/authimage.avif"
          alt="Connexion"
          fill
          priority
          sizes="(min-width: 1024px) 400px, 100vw"
          className="object-cover"
        />
        {/* Overlay — darkest at the bottom, where the heading/list/footer text sits, lighter
            near the top behind the logo so the photo still shows through there. A diagonal
            gradient left the text block sitting over the lightest, busiest part of the photo
            (desk/chair in warm tones), hurting legibility regardless of text color. */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/75 to-black/95" />

        <div
          className="flex items-center gap-2.5 relative animate-in fade-in slide-in-from-left-4 duration-700"
          style={{ animationFillMode: "both" }}
        >
          <LogoMark />
          <span className="text-lg font-semibold text-white tracking-tight">
            {APP_NAME}
          </span>
        </div>

        <div className="relative space-y-10">
          <div
            className="space-y-3 animate-in fade-in slide-in-from-left-4 duration-700"
            style={{ animationDelay: "100ms", animationFillMode: "both" }}
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-200">
              Plateforme de gestion associative
            </p>
            <h2 className="text-3xl font-semibold text-white leading-snug">
              Gérez votre association.
              <br />
              Simplement.
            </h2>
            <p className="text-zinc-300 text-sm leading-relaxed max-w-xs">
              Membres, cotisations, événements et trésorerie — tout en un seul
              endroit.
            </p>
          </div>

          <ul className="space-y-4">
            {[
              { Icon: UsersIcon, label: "Gestion des membres & adhérents" },
              { Icon: CoinsIcon, label: "Suivi des cotisations" },
              { Icon: CalendarBlankIcon, label: "Événements & présences" },
              { Icon: BankIcon, label: "Trésorerie simplifiée" },
            ].map(({ Icon, label }, i) => (
              <li
                key={label}
                className="flex items-center gap-3 animate-in fade-in slide-in-from-left-4 duration-700"
                style={{ animationDelay: `${200 + i * 60}ms`, animationFillMode: "both" }}
              >
                <span className="flex size-8 items-center justify-center rounded-lg bg-white/10">
                  <Icon className="size-4 text-zinc-200" />
                </span>
                <span className="text-sm text-zinc-200">{label}</span>
              </li>
            ))}
          </ul>
        </div>

        <p
          className="relative text-xs text-zinc-400 animate-in fade-in slide-in-from-left-4 duration-700"
          style={{ animationDelay: "500ms", animationFillMode: "both" }}
        >
          © {new Date().getFullYear()} {APP_NAME} · Données hébergées en France
        </p>
      </div>

      {/* Right panel */}
      <div className="flex items-center justify-center bg-background p-8">
        {children}
      </div>
    </div>
  );
}

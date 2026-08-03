import {
  UsersIcon,
  CalendarBlankIcon,
  CoinsIcon,
  BankIcon,
} from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { APP_NAME } from "@/config/brand";
import { LogoMark } from "@/components/layout/logo-mark";
export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("auth.layout");

  const features = [
    { Icon: UsersIcon, label: t("featureMembers") },
    { Icon: CoinsIcon, label: t("featureCotisations") },
    { Icon: CalendarBlankIcon, label: t("featureEvents") },
    { Icon: BankIcon, label: t("featureTreasury") },
  ];

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left panel */}
      <div className="relative hidden lg:flex flex-col justify-between bg-zinc-950 p-12 overflow-hidden">
        <Image
          src="/app/authimage.avif"
          alt={t("imageAlt")}
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
              {t("eyebrow")}
            </p>
            <h2 className="text-3xl font-semibold text-white leading-snug">
              {t("headingLine1")}
              <br />
              {t("headingLine2")}
            </h2>
            <p className="text-zinc-300 text-sm leading-relaxed max-w-xs">
              {t("subtitle")}
            </p>
          </div>

          <ul className="space-y-4">
            {features.map(({ Icon, label }, i) => (
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
          © {new Date().getFullYear()} {APP_NAME} · {t("footerSuffix")}
        </p>
      </div>

      {/* Right panel */}
      <div className="flex items-center justify-center bg-background p-8">
        {children}
      </div>
    </div>
  );
}

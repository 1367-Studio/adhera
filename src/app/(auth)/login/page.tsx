import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/components/layout/login-form";
import { APP_NAME } from "@/config/brand";
import { LogoMark } from "@/components/layout/logo-mark";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.login");
  return { title: t("pageTitle") };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; suspended?: string }>;
}) {
  const { callbackUrl, suspended } = await searchParams;
  const t = await getTranslations("auth.login");

  return (
    <div className="w-full max-w-sm">
      {" "}
      <div className="lg:hidden flex items-center gap-2 mb-8">
        <LogoMark className="size-6" />
        <span className="text-base font-semibold">{APP_NAME}</span>
      </div>
      <div className="rounded-lg border bg-card p-8 space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">{t("heading")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>

        {suspended && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t("suspended")}
          </p>
        )}

        <LoginForm callbackUrl={callbackUrl} />

        <p className="text-center text-sm text-muted-foreground">
          {t("noAccount")}{" "}
          <Link
            href="/register"
            className="font-medium text-foreground underline underline-offset-4 hover:text-foreground/80 transition-colors"
          >
            {t("createAccount")}
          </Link>
        </p>
      </div>
    </div>
  );
}

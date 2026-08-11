"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { CheckCircleIcon, CircleNotchIcon, FileTextIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { BASE_PATH } from "@/lib/env";

type YoutrustConfig = { youtrustConfigured: boolean };

export function YoutrustSettings({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations("reunions.youtrustSettings");
  const tc = useTranslations("common");
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery<YoutrustConfig>({
    queryKey: ["youtrust-config"],
    queryFn: async () => {
      const res = await fetch(`${BASE_PATH}/api/youtrust/config`);
      if (!res.ok) throw new Error();
      return res.json();
    },
  });

  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const canSave = !!apiKey;

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/youtrust/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtrustApiKey: apiKey }),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok) throw new Error(result?.error);
      toast.success(t("toasts.saved"));
      setApiKey("");
      refetch();
      qc.invalidateQueries({ queryKey: ["youtrust-config"] });
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t("toasts.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setSaving(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/youtrust/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtrustApiKey: null }),
      });
      if (!res.ok) throw new Error();
      toast.success(t("toasts.credentialsRemoved"));
      setApiKey("");
      refetch();
    } catch {
      toast.error(t("toasts.removeError"));
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-9 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <FileTextIcon className="size-3.5 text-sky-600" />
          <h3 className="text-sm font-semibold">{t("heading")}</h3>
        </div>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>

      {data?.youtrustConfigured ? (
        <div className="rounded-lg border bg-emerald-50 dark:bg-emerald-950/30 p-3 flex items-start gap-2.5">
          <CheckCircleIcon className="size-4 mt-0.5 shrink-0 text-emerald-600" />
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{t("configuredTitle")}</p>
        </div>
      ) : (
        <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/20 p-3 flex items-start gap-2.5">
          <WarningIcon className="size-4 mt-0.5 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-700 dark:text-amber-300">{t("notConfiguredWarning")}</p>
        </div>
      )}

      {canEdit && (
        <div className="space-y-4">
          <FormField
            label={t("apiKeyLabel")}
            type="password"
            placeholder={data?.youtrustConfigured ? t("apiKeyPlaceholderReplace") : "•••••••••••••••••••••••••••••••"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <p className="text-xs text-muted-foreground -mt-2">
            {t("credentialsHint")} <span className="font-mono">app.yousign.com</span>
          </p>

          <div className="flex gap-2 flex-wrap">
            <Button size="sm" onClick={handleSave} disabled={!canSave || saving}>
              {saving ? (
                <>
                  <CircleNotchIcon className="mr-1.5 size-3.5 animate-spin" />
                  {t("saving")}
                </>
              ) : (
                <>
                  <FileTextIcon className="mr-1.5 size-3.5" />
                  {tc("save")}
                </>
              )}
            </Button>
            {data?.youtrustConfigured && (
              <Button size="sm" variant="ghost" onClick={handleRemove} disabled={saving} className="text-xs text-muted-foreground">
                {t("removeCredentials")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

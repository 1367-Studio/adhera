"use client"

import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { CircleNotchIcon } from "@phosphor-icons/react/dist/ssr";
interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel?: string
  loading?: boolean
  confirmDisabled?: boolean
  onConfirm: () => void | Promise<void>
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  loading,
  confirmDisabled,
  onConfirm,
}: ConfirmDialogProps) {
  const t = useTranslations()

  async function handleConfirm() {
    try {
      await onConfirm()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.genericError"))
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description ?? t("common.irreversibleAction")}
      size="sm"
      dismissable={!loading}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={loading || confirmDisabled}>
            {loading && <CircleNotchIcon className="mr-2 size-4 animate-spin" />}
            {confirmLabel ?? t("common.confirm")}
          </Button>
        </>
      }
    />
  )
}

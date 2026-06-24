"use client"

import { toast } from "sonner"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { LoaderCircleIcon } from "lucide-react"

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
  description = "Cette action est irréversible.",
  confirmLabel = "Confirmer",
  loading,
  confirmDisabled,
  onConfirm,
}: ConfirmDialogProps) {
  async function handleConfirm() {
    try {
      await onConfirm()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ocorreu um erro")
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      dismissable={!loading}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Annuler
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={loading || confirmDisabled}>
            {loading && <LoaderCircleIcon className="mr-2 size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </>
      }
    />
  )
}

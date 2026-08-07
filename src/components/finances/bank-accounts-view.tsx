"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { PlusIcon, PencilSimpleIcon, TrashIcon, BankIcon } from "@phosphor-icons/react/dist/ssr";
import { useBankAccounts, useCreateBankAccount, useUpdateBankAccount, useDeleteBankAccount } from "@/hooks/use-bank-accounts"
import type { BankAccountInput } from "@/lib/schemas"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RowActions } from "@/components/ui/row-actions"
import { BankAccountForm } from "@/components/finances/bank-account-form"

type Account = {
  id:             string
  bankName:       string
  accountName:    string
  ibanLast4:      string | null
  currency:       string
  openingBalance: string
  currentBalance: string
  isActive:       boolean
}

export function BankAccountsView() {
  const t = useTranslations()
  const [createOpen, setCreateOpen]     = useState(false)
  const [editTarget, setEditTarget]     = useState<Account | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null)

  const { data: accounts = [], isLoading } = useBankAccounts()

  const createMutation = useCreateBankAccount()
  const updateMutation = useUpdateBankAccount(editTarget?.id ?? "")
  const deleteMutation = useDeleteBankAccount()

  async function handleCreate(data: BankAccountInput) {
    try {
      await createMutation.mutateAsync(data)
      toast.success(t("finances.accountsView.toasts.created"))
      setCreateOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleUpdate(data: BankAccountInput) {
    try {
      await updateMutation.mutateAsync(data)
      toast.success(t("finances.accountsView.toasts.updated"))
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success(t("finances.accountsView.toasts.deleted"))
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  const fmt = (n: string | number) => Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

  const columns: Column<Account>[] = [
    {
      key: "account",
      header: t("finances.accountsView.columns.account"),
      cell: (a) => (
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
            <BankIcon className="size-4 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium">{a.accountName}</p>
            <p className="text-xs text-muted-foreground">{a.bankName}{a.ibanLast4 ? ` · ****${a.ibanLast4}` : ""}</p>
          </div>
        </div>
      ),
    },
    {
      key: "balance",
      header: t("finances.accountsView.columns.balance"),
      className: "w-32 text-right",
      cell: (a) => (
        <span className={`font-semibold tabular-nums ${Number(a.currentBalance) >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
          {fmt(a.currentBalance)}
        </span>
      ),
    },
    {
      key: "status",
      header: t("finances.accountsView.columns.status"),
      className: "w-24",
      cell: (a) => a.isActive
        ? <Badge variant="default" className="bg-green-600 hover:bg-green-700">{t("finances.accountsView.status.actif")}</Badge>
        : <Badge variant="secondary">{t("finances.accountsView.status.inactif")}</Badge>,
    },
    {
      key: "actions",
      header: "",
      className: "w-10",
      cell: (a) => (
        <RowActions actions={[
          { label: t("finances.accountsView.actions.edit"),  icon: <PencilSimpleIcon className="size-3.5" />, onClick: () => setEditTarget(a) },
          { label: t("finances.accountsView.actions.delete"), icon: <TrashIcon className="size-3.5" />,  destructive: true, separator: true, onClick: () => setDeleteTarget(a) },
        ]} />
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("finances.accountsView.title")}
        description={t("finances.accountsView.description")}
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" />
            {t("finances.accountsView.add")}
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={accounts as Account[]}
        loading={isLoading}
        keyExtractor={(a) => a.id}
        empty={t("finances.accountsView.noAccounts")}
      />

      <Modal open={createOpen} onOpenChange={setCreateOpen} title={t("finances.accountsView.newAccountTitle")} size="md" dismissable={false}>
        <BankAccountForm onSubmit={handleCreate} onCancel={() => setCreateOpen(false)} loading={createMutation.isPending} />
      </Modal>

      <Modal open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)} title={t("finances.accountsView.editAccountTitle")} size="md" dismissable={false}>
        <BankAccountForm
          defaultValues={editTarget ? {
            bankName:       editTarget.bankName,
            accountName:    editTarget.accountName,
            ibanLast4:      editTarget.ibanLast4 ?? "",
            currency:       editTarget.currency,
            openingBalance: parseFloat(editTarget.openingBalance),
            isActive:       editTarget.isActive,
          } : undefined}
          onSubmit={handleUpdate}
          onCancel={() => setEditTarget(null)}
          loading={updateMutation.isPending}
        />
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t("finances.accountsView.deleteConfirmTitle")}
        description={deleteTarget ? `${deleteTarget.accountName} — ${deleteTarget.bankName}` : ""}
        confirmLabel={t("common.delete")}
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}

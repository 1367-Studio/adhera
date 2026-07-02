import { useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getPusherClient } from "@/lib/pusher-client"
import { useCurrentUser } from "@/lib/user-context"

export type Notification = {
  id:        string
  title:     string
  body:      string | null
  link:      string | null
  read:      boolean
  createdAt: string
}

const QK = ["notifications"]

export function useNotifications() {
  const { associationId } = useCurrentUser()
  const qc = useQueryClient()

  useEffect(() => {
    if (!associationId) return
    const pusher = getPusherClient()
    if (!pusher) return
    const channelName = `private-association-${associationId}`
    const channel = pusher.subscribe(channelName)
    channel.bind("new-notification", () => {
      qc.invalidateQueries({ queryKey: QK })
    })
    return () => {
      pusher.unsubscribe(channelName)
    }
  }, [associationId, qc])

  return useQuery<Notification[]>({
    queryKey: QK,
    queryFn: async () => {
      const res = await fetch("/api/notifications")
      if (!res.ok) return []
      return res.json()
    },
  })
}

export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/notifications/${id}`, { method: "PATCH" })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  })
}

export function useMarkAllRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await fetch("/api/notifications/read-all", { method: "POST" })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  })
}

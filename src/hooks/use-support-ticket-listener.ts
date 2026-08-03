import { useEffect, useRef } from "react"
import { getPusherClient } from "@/lib/pusher-client"
import { useCurrentUser } from "@/lib/user-context"

type SupportTicketMessagePayload = { ticketId: string }

// Shared subscribe/unbind plumbing — mirrors useMeetingChannelListener in
// src/hooks/use-meetings.ts, generalized to take the channel name directly since this file
// has two different channels to bind the same event on (see the two exported hooks below).
function useChannelListener<T>(channelName: string | null, event: string, onEvent: (data: T) => void) {
  const onEventRef = useRef(onEvent)
  useEffect(() => {
    onEventRef.current = onEvent
  })

  useEffect(() => {
    if (!channelName) return
    const pusher = getPusherClient()
    if (!pusher) return

    const channel = pusher.subscribe(channelName)
    const handler = (data: T) => onEventRef.current(data)
    channel.bind(event, handler)

    return () => {
      channel.unbind(event, handler)
      pusher.unsubscribe(channelName)
    }
  }, [channelName, event])
}

// Tenant side — an association's own channel (already used for the notification bell etc.),
// new event. Fires for both directions (see notifySupportMessage in
// src/lib/support-tickets.ts), so a ticket list or open thread refetches whether the message
// came from this association's own other tab or from staff.
export function useSupportTicketMessageListener(onMessage: (data: SupportTicketMessagePayload) => void) {
  const { associationId } = useCurrentUser()
  useChannelListener<SupportTicketMessagePayload>(
    associationId ? `private-association-${associationId}` : null,
    "support-ticket-message",
    onMessage,
  )
}

// Backoffice side — the one fixed channel every SUPER_ADMIN subscribes to, not tied to any
// single association, so the global inbox live-updates regardless of which association wrote.
export function useSupportStaffTicketListener(onMessage: (data: SupportTicketMessagePayload) => void) {
  const { role } = useCurrentUser()
  useChannelListener<SupportTicketMessagePayload>(
    role === "SUPER_ADMIN" ? "private-support-staff" : null,
    "support-ticket-message",
    onMessage,
  )
}

export type SmsSettings = {
  rsvpConfirmation: boolean
  eventReminder:    boolean
  memberWelcome:    boolean
}

export const DEFAULT_SMS_SETTINGS: SmsSettings = {
  rsvpConfirmation: false,
  eventReminder:    false,
  memberWelcome:    false,
}

export function parseSmsSettings(raw: unknown): SmsSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SMS_SETTINGS }
  return { ...DEFAULT_SMS_SETTINGS, ...(raw as Partial<SmsSettings>) }
}

// Lets any client component (the notification bell) ask the "What's new" pop-up, mounted once
// in the dashboard layout, to open — optionally on a given entry. A window event keeps the two
// decoupled: no context provider, and nothing happens if the pop-up isn't mounted.
export const OPEN_RELEASE_NOTES_EVENT = "release-notes:open"

export type OpenReleaseNotesDetail = { noteId?: string }

export function openReleaseNotes(noteId?: string) {
  window.dispatchEvent(new CustomEvent<OpenReleaseNotesDetail>(OPEN_RELEASE_NOTES_EVENT, { detail: { noteId } }))
}

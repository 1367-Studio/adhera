import { describe, expect, it } from "vitest"
import { isTacheOverdue, shouldFireReminderToday, tacheDueDateLocal } from "@/lib/tache-status"

const NOW = new Date("2026-11-25T12:00:00Z")

describe("isTacheOverdue", () => {
  it("a past due date on an open task is overdue", () => {
    expect(isTacheOverdue({ status: "A_FAIRE", dueDate: "2026-11-24T12:00:00Z" }, NOW)).toBe(true)
    expect(isTacheOverdue({ status: "EN_COURS", dueDate: "2026-11-01T00:00:00Z" }, NOW)).toBe(true)
  })

  it("a future due date is not overdue", () => {
    expect(isTacheOverdue({ status: "A_FAIRE", dueDate: "2026-11-26T12:00:00Z" }, NOW)).toBe(false)
  })

  it("exactly at the due date is not yet overdue", () => {
    expect(isTacheOverdue({ status: "A_FAIRE", dueDate: NOW }, NOW)).toBe(false)
  })

  it("a terminée task is never overdue, regardless of due date", () => {
    expect(isTacheOverdue({ status: "TERMINEE", dueDate: "2020-01-01T00:00:00Z" }, NOW)).toBe(false)
  })

  it("accepts a Date object as well as a string", () => {
    expect(isTacheOverdue({ status: "A_FAIRE", dueDate: new Date("2026-11-24T00:00:00Z") }, NOW)).toBe(true)
  })

  it("a task with no due date is never overdue", () => {
    expect(isTacheOverdue({ status: "A_FAIRE", dueDate: null }, NOW)).toBe(false)
    expect(isTacheOverdue({ status: "EN_COURS", dueDate: null }, NOW)).toBe(false)
  })
})

describe("tacheDueDateLocal", () => {
  it("reproduces the UTC calendar day as local-midnight fields, regardless of the caller's own timezone", () => {
    const utcMidnight = new Date("2026-11-27T00:00:00.000Z")
    const local = tacheDueDateLocal(utcMidnight)
    expect(local.getFullYear()).toBe(2026)
    expect(local.getMonth()).toBe(10) // novembre (0-indexé)
    expect(local.getDate()).toBe(27)
  })

  it("accepts a string the same way as a Date", () => {
    const local = tacheDueDateLocal("2026-11-27T00:00:00.000Z")
    expect(local.getDate()).toBe(27)
  })
})

// dueDate chosen mid-day UTC in winter (CET = UTC+1), so its Paris calendar day never
// crosses a UTC date boundary — keeps the fixtures below legible.
const DUE_DATE = new Date("2026-11-27T10:00:00Z")

describe("shouldFireReminderToday", () => {
  it("fires exactly on the Paris calendar day N days before the due date (AVANT)", () => {
    const reminder = { offsetDays: 2, direction: "AVANT" as const }
    expect(shouldFireReminderToday(DUE_DATE, reminder, new Date("2026-11-25T08:00:00Z"))).toBe(true)
    expect(shouldFireReminderToday(DUE_DATE, reminder, new Date("2026-11-25T22:00:00Z"))).toBe(true)
  })

  it("does not fire the day before or the day after the target day (AVANT)", () => {
    const reminder = { offsetDays: 2, direction: "AVANT" as const }
    expect(shouldFireReminderToday(DUE_DATE, reminder, new Date("2026-11-24T12:00:00Z"))).toBe(false)
    expect(shouldFireReminderToday(DUE_DATE, reminder, new Date("2026-11-26T12:00:00Z"))).toBe(false)
  })

  it("fires exactly on the Paris calendar day N days after the due date (APRES)", () => {
    const reminder = { offsetDays: 1, direction: "APRES" as const }
    expect(shouldFireReminderToday(DUE_DATE, reminder, new Date("2026-11-28T08:00:00Z"))).toBe(true)
    expect(shouldFireReminderToday(DUE_DATE, reminder, new Date("2026-11-27T12:00:00Z"))).toBe(false)
    expect(shouldFireReminderToday(DUE_DATE, reminder, new Date("2026-11-29T00:00:00Z"))).toBe(false)
  })

  it("a second sweep run the same day still matches (idempotent at the day-bucket level)", () => {
    const reminder = { offsetDays: 2, direction: "AVANT" as const }
    const morning = shouldFireReminderToday(DUE_DATE, reminder, new Date("2026-11-25T07:00:00Z"))
    const evening = shouldFireReminderToday(DUE_DATE, reminder, new Date("2026-11-25T21:00:00Z"))
    expect(morning).toBe(true)
    expect(evening).toBe(true)
  })
})

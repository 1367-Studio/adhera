"use client"

import { CheckIcon } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"

// Mirrors the `z.string().min(8)` every password entry point already enforces server-side
// (/api/register, /api/public/[slug]/inscription, the adhésion checkout). Kept as a named
// constant so the rule the visitor reads and the length the form checks can't drift apart.
export const PASSWORD_MIN_LENGTH = 8

export type PasswordRule = { label: string; met: boolean }

// Live checklist under a password field: says what is expected, and marks each rule as it is
// satisfied. Deliberately a plain list rather than a bordered panel — it sits inside a form
// that is already long, and a container here would compete with the fields themselves.
//
// Unmet rules stay muted rather than turning red: nothing is wrong until the visitor tries to
// submit, and the disabled button already explains itself (see blockingReason in the public
// membership form).
export function PasswordRequirements({ title, rules }: { title: string; rules: PasswordRule[] }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{title}</p>
      <ul className="space-y-0.5">
        {rules.map(rule => (
          <li
            key={rule.label}
            className={cn(
              "flex items-center gap-1.5 text-xs transition-colors",
              rule.met ? "text-green-700 dark:text-green-400" : "text-muted-foreground",
            )}
          >
            <span className="flex size-3.5 shrink-0 items-center justify-center" aria-hidden>
              {rule.met
                ? <CheckIcon className="size-3.5" weight="bold" />
                : <span className="size-1 rounded-full bg-current" />}
            </span>
            {rule.label}
          </li>
        ))}
      </ul>
    </div>
  )
}

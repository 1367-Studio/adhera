import { requireModule } from "@/lib/auth/require-module"

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireModule("evenements")
  return <>{children}</>
}

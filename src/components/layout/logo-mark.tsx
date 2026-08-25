import { cn } from "@/lib/utils"

interface LogoMarkProps {
  className?: string
}

// La marque formwise, identique au tracé de src/app/icon0.svg (favicon, apple-icon,
// manifeste) : le glyphe bleu #023D9D remplit le carré, l'arche du bas étant du vide.
//
// Couleur de marque en dur et non un token de thème, volontairement : c'est une identité
// visuelle, elle ne doit pas virer au bleu clair du mode sombre. Le fond blanc du
// conteneur suit la même logique que apple-icon (cf. commit eb9868e) — #023D9D ne tient
// que 1.96:1 sur le noir du mode sombre, donc un glyphe posé à même la surface
// disparaîtrait ; sur blanc il reste lisible quel que soit le thème.
//
// Auparavant : un astérisque blanc sur l'orange #f84a00, hérité de l'ancienne identité,
// resté en place quand la marque est passée au bleu.
export function LogoMark({ className }: LogoMarkProps) {
  return (
    <div
      className={cn(
        "flex aspect-square size-8 items-center justify-center overflow-hidden rounded-lg bg-white",
        className,
      )}
    >
      <svg viewBox="0 0 765 765" className="size-full" role="img" aria-hidden focusable="false">
        <path
          d="M765 0V765H592.875V508.725C592.875 452.93 570.71 399.421 531.258 359.968C491.805 320.515 438.295 298.35 382.5 298.35C326.705 298.35 273.195 320.515 233.742 359.968C194.29 399.421 172.125 452.93 172.125 508.725V765H0V0H765Z"
          fill="#023D9D"
        />
      </svg>
    </div>
  )
}

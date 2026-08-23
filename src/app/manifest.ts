import type { MetadataRoute } from "next"
import { APP_NAME } from "@/config/brand"
import { BASE_PATH } from "@/lib/env"

// Next ne réécrit pas le contenu d'un manifeste statique : `basePath` doit donc être
// préfixé à la main sur chaque URL, d'où BASE_PATH plutôt que des chemins "/..." nus.
// Les icônes 192/512 sont rendues depuis icon0.svg (voir public/web-app-manifest-*.png).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name:             APP_NAME,
    short_name:       APP_NAME,
    description:      "Gestion simplifiée pour associations françaises",
    start_url:        BASE_PATH,
    scope:            BASE_PATH,
    display:          "standalone",
    lang:             "fr",
    theme_color:      "#023D9D",
    background_color: "#ffffff",
    icons: [
      { src: `${BASE_PATH}/icon0.svg`,                    sizes: "any",     type: "image/svg+xml" },
      { src: `${BASE_PATH}/web-app-manifest-192x192.png`, sizes: "192x192", type: "image/png" },
      { src: `${BASE_PATH}/web-app-manifest-512x512.png`, sizes: "512x512", type: "image/png" },
    ],
  }
}

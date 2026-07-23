export function hexToRgb255(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// Fetches the association's logo and turns it into a data URL + intrinsic size, both of
// which jsPDF's addImage() needs — never throws, a broken/unreachable logo just falls
// back to the platform's default header text at the call site.
export async function loadLogoForPdf(url: string): Promise<{ dataUrl: string; format: "PNG" | "JPEG"; width: number; height: number } | null> {
  try {
    const res  = await fetch(url)
    const blob = await res.blob()
    const format: "PNG" | "JPEG" = blob.type.includes("png") ? "PNG" : "JPEG"
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload  = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    const { width, height } = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image()
      img.onload  = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = reject
      img.src = dataUrl
    })
    return { dataUrl, format, width, height }
  } catch {
    return null
  }
}

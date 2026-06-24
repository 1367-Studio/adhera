'use client'

import { Suspense, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { usePathname, useSearchParams } from 'next/navigation'

const MAX_DURATION_MS = 10_000
const COLOR = '#2563eb'

let triggerStart: (() => void) | null = null

export function useNavigate() {
  const router = useRouter()
  return (href: string) => {
    triggerStart?.()
    router.push(href)
  }
}

function isSamePageHref(href: string, currentPathname: string): boolean {
  try {
    const url = new URL(href, window.location.href)
    return url.pathname === currentPathname
  } catch {
    return false
  }
}

function TopLoaderInner() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const barRef = useRef<HTMLDivElement>(null)
  const isLoadingRef = useRef(false)
  const isPopStateRef = useRef(false)
  const pathnameRef = useRef(pathname)
  const tickRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maxRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    pathnameRef.current = pathname
  })

  const show = () => {
    if (!barRef.current) return
    barRef.current.style.transition = 'none'
    barRef.current.style.opacity = '1'
    barRef.current.style.width = '0%'
    void barRef.current.offsetWidth
    barRef.current.style.transition = 'width 0.4s ease'
    barRef.current.style.width = '15%'
  }

  const complete = () => {
    if (!barRef.current) return
    barRef.current.style.transition = 'width 0.2s ease-out'
    barRef.current.style.width = '100%'
    hideRef.current = setTimeout(() => {
      if (!barRef.current) return
      barRef.current.style.transition = 'opacity 0.3s ease'
      barRef.current.style.opacity = '0'
    }, 200)
  }

  const reset = () => {
    if (!barRef.current) return
    isLoadingRef.current = false
    if (tickRef.current) clearTimeout(tickRef.current)
    if (maxRef.current) clearTimeout(maxRef.current)
    if (hideRef.current) clearTimeout(hideRef.current)
    barRef.current.style.transition = 'none'
    barRef.current.style.opacity = '0'
    barRef.current.style.width = '0%'
  }

  const startRef = useRef(() => {})
  const resetRef = useRef(() => {})

  useEffect(() => {
    resetRef.current = reset
    triggerStart = () => startRef.current()
    return () => { triggerStart = null }
  }, [])

  useEffect(() => {
    resetRef.current = reset
    startRef.current = () => {
      if (isLoadingRef.current) return
      isLoadingRef.current = true
      if (tickRef.current) clearTimeout(tickRef.current)
      if (maxRef.current) clearTimeout(maxRef.current)
      if (hideRef.current) clearTimeout(hideRef.current)

      show()

      let p = 15
      const tick = () => {
        p = Math.min(p + (p < 50 ? 12 : p < 70 ? 6 : 2), 85)
        if (barRef.current) {
          barRef.current.style.transition = 'width 0.4s ease'
          barRef.current.style.width = `${p}%`
        }
        if (p < 85) tickRef.current = setTimeout(tick, 400)
      }
      tickRef.current = setTimeout(tick, 400)
      maxRef.current = setTimeout(() => resetRef.current(), MAX_DURATION_MS)
    }
  })

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return
      const anchor = (e.target as Element).closest('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      if (anchor.hasAttribute('download')) return
      const href = anchor.getAttribute('href') ?? ''
      if (
        !href ||
        href.startsWith('http') ||
        href.startsWith('//') ||
        href.startsWith('#') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        anchor.target === '_blank'
      ) return
      if (isSamePageHref(href, pathnameRef.current)) return
      startRef.current()
    }

    const handlePopState = () => {
      isPopStateRef.current = true
      resetRef.current()
      setTimeout(() => { isPopStateRef.current = false }, 100)
    }

    const origPush = window.history.pushState
    const origReplace = window.history.replaceState

    window.history.pushState = function (...args) {
      if (!isPopStateRef.current) startRef.current()
      return origPush.apply(window.history, args)
    }
    window.history.replaceState = function (...args) {
      if (!isPopStateRef.current) startRef.current()
      return origReplace.apply(window.history, args)
    }

    document.addEventListener('click', handleClick, true)
    window.addEventListener('popstate', handlePopState)

    return () => {
      document.removeEventListener('click', handleClick, true)
      window.removeEventListener('popstate', handlePopState)
      window.history.pushState = origPush
      window.history.replaceState = origReplace
      if (tickRef.current) clearTimeout(tickRef.current)
      if (maxRef.current) clearTimeout(maxRef.current)
      if (hideRef.current) clearTimeout(hideRef.current)
    }
  }, [])

  useEffect(() => {
    if (!isLoadingRef.current) return
    isLoadingRef.current = false
    if (tickRef.current) clearTimeout(tickRef.current)
    if (maxRef.current) clearTimeout(maxRef.current)
    complete()
  }, [pathname, searchParams])

  return (
    <div
      ref={barRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 9999,
        height: '3px',
        width: '0%',
        opacity: 0,
        backgroundColor: COLOR,
        boxShadow: '0 0 8px rgba(37, 99, 235, 0.6)',
        borderRadius: '0 9999px 9999px 0',
        pointerEvents: 'none',
      }}
    />
  )
}

export function TopLoader() {
  return (
    <Suspense fallback={null}>
      <TopLoaderInner />
    </Suspense>
  )
}

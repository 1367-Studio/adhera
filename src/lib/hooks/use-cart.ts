"use client"

import { useState, useEffect, useCallback } from "react"

export type CartItem = {
  produitId:     string
  varianteId:    string
  produitName:   string
  varianteLabel: string
  price:         number // cents
  quantity:      number
  imageUrl:      string | null
  stock:         number // snapshot of available stock when added — server re-validates at checkout
}

const STORAGE_KEY = "adhera_boutique_cart"

function readCart(slug: string): CartItem[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}_${slug}`)
    const items = raw ? (JSON.parse(raw) as CartItem[]) : []
    // Carts persisted before the `stock` field existed won't have it — don't let that break capping.
    return items.map(i => ({ ...i, stock: i.stock ?? 99 }))
  } catch {
    return []
  }
}

function writeCart(slug: string, items: CartItem[]) {
  localStorage.setItem(`${STORAGE_KEY}_${slug}`, JSON.stringify(items))
}

export function useCart(slug: string) {
  const [items, setItems] = useState<CartItem[]>([])
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setItems(readCart(slug))
    setHydrated(true)
  }, [slug])

  const persist = useCallback((next: CartItem[]) => {
    setItems(next)
    writeCart(slug, next)
  }, [slug])

  function addItem(item: Omit<CartItem, "quantity">, quantity = 1) {
    const qty = Math.max(1, Math.floor(quantity))
    setItems(prev => {
      const existing = prev.find(i => i.varianteId === item.varianteId)
      const next = existing
        ? prev.map(i => i.varianteId === item.varianteId
            ? { ...i, stock: item.stock, quantity: Math.min(i.quantity + qty, 99, item.stock) }
            : i)
        : [...prev, { ...item, quantity: Math.min(qty, item.stock) }]
      writeCart(slug, next)
      return next
    })
  }

  function updateQuantity(varianteId: string, quantity: number) {
    if (quantity < 1) return removeItem(varianteId)
    setItems(prev => {
      const next = prev.map(i => i.varianteId === varianteId ? { ...i, quantity: Math.min(quantity, i.stock) } : i)
      writeCart(slug, next)
      return next
    })
  }

  function removeItem(varianteId: string) {
    setItems(prev => {
      const next = prev.filter(i => i.varianteId !== varianteId)
      writeCart(slug, next)
      return next
    })
  }

  function clearCart() {
    persist([])
  }

  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0)
  const count = items.reduce((sum, i) => sum + i.quantity, 0)

  return { items, total, count, hydrated, addItem, updateQuantity, removeItem, clearCart }
}

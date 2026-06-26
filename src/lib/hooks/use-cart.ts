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
}

const STORAGE_KEY = "adhera_boutique_cart"

function readCart(slug: string): CartItem[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}_${slug}`)
    return raw ? JSON.parse(raw) : []
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
        ? prev.map(i => i.varianteId === item.varianteId ? { ...i, quantity: Math.min(i.quantity + qty, 99) } : i)
        : [...prev, { ...item, quantity: qty }]
      writeCart(slug, next)
      return next
    })
  }

  function updateQuantity(varianteId: string, quantity: number) {
    if (quantity < 1) return removeItem(varianteId)
    setItems(prev => {
      const next = prev.map(i => i.varianteId === varianteId ? { ...i, quantity } : i)
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

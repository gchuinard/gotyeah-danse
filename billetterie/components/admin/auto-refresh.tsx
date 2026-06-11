'use client'

// Rafraîchit le server component parent à intervalle régulier (soir J : les
// compteurs de scan du tableau de bord bougent tout seuls). Coupe le polling
// quand l'onglet est masqué pour épargner le Pi.

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter()

  useEffect(() => {
    const tick = () => {
      if (!document.hidden) router.refresh()
    }
    const id = setInterval(tick, seconds * 1000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [router, seconds])

  return null
}

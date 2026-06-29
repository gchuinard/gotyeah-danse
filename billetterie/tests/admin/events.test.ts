// Journal d'audit : on ne teste QUE les données pures du module — l'auteur
// public (ACTOR_PUBLIC) et le catalogue de libellés FR (ACTION_LABELS) affiché
// dans l'historique des demandes. logBookingEvent écrit via le prisma global :
// hors périmètre ici.
//
// `@/lib/admin/events` importe `@/lib/db`, qui instancie `new PrismaClient()`
// au chargement du module. On neutralise cet import par un stub : le test reste
// pur (pas de base, pas de `prisma generate` requis) et aucun client réel n'est
// jamais créé.

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))

import { ACTION_LABELS, ACTOR_PUBLIC } from '@/lib/admin/events'

describe('ACTOR_PUBLIC', () => {
  it('vaut exactement « demande en ligne »', () => {
    expect(ACTOR_PUBLIC).toBe('demande en ligne')
  })

  it('est une chaîne non vide (auteur affichable)', () => {
    expect(typeof ACTOR_PUBLIC).toBe('string')
    expect(ACTOR_PUBLIC.trim().length).toBeGreaterThan(0)
  })
})

// Couple code → libellé exact, recopié verbatim du module (accents compris).
// Sert de table de référence pour le rendu de l'historique.
const LIBELLES: ReadonlyArray<readonly [string, string]> = [
  ['created', 'Demande créée'],
  ['paid', 'Marquée payée'],
  ['payment_added', 'Versement enregistré'],
  ['payment_removed', 'Versement supprimé'],
  ['unpaid', 'Règlement annulé'],
  ['free_seats', 'Places offertes modifiées'],
  ['child_count', 'Répartition adultes / enfants modifiée'],
  ['placed', 'Placée'],
  ['moved', 'Places déplacées'],
  ['cancelled', 'Annulée'],
  ['extended', 'Échéance prolongée (+14 j)'],
  ['party_changed', 'Nombre de places modifié'],
  ['ticket_mode', 'Mode de remise changé'],
  ['note', 'Note interne modifiée'],
  ['tickets_sent', 'Billets (r)envoyés'],
  ['refunded', 'Remboursement'],
]

describe('ACTION_LABELS — catalogue', () => {
  // NOMINAL : chaque code connu rend son libellé FR exact.
  it.each(LIBELLES)('« %s » → « %s »', (code, libelle) => {
    expect(ACTION_LABELS[code]).toBe(libelle)
  })

  it('expose exactement les codes attendus (ni plus, ni moins)', () => {
    const attendus = LIBELLES.map(([code]) => code).sort()
    expect(Object.keys(ACTION_LABELS).sort()).toEqual(attendus)
  })

  it('tous les libellés sont des chaînes non vides', () => {
    for (const libelle of Object.values(ACTION_LABELS)) {
      expect(typeof libelle).toBe('string')
      expect(libelle.trim().length).toBeGreaterThan(0)
    }
  })

  it('toutes les clés sont en snake_case minuscule', () => {
    for (const code of Object.keys(ACTION_LABELS)) {
      expect(code).toMatch(/^[a-z]+(_[a-z]+)*$/)
    }
  })

  it('aucun doublon de libellé (chaque action est distincte à l’écran)', () => {
    const libelles = Object.values(ACTION_LABELS)
    expect(new Set(libelles).size).toBe(libelles.length)
  })
})

describe('ACTION_LABELS — repli sur action inconnue', () => {
  // Le module n'a pas de helper : le repli est fait côté appelant via
  // `ACTION_LABELS[action] ?? action` (cf. app/admin/.../demandes/page.tsx).
  const libelleOuCode = (action: string) => ACTION_LABELS[action] ?? action

  it('action inconnue → undefined (le repli reste à la charge de l’appelant)', () => {
    expect(ACTION_LABELS['action_qui_nexiste_pas']).toBeUndefined()
  })

  it('clé vide → undefined', () => {
    expect(ACTION_LABELS['']).toBeUndefined()
  })

  it('sensible à la casse : « CREATED » n’est pas mappé', () => {
    expect(ACTION_LABELS['CREATED']).toBeUndefined()
  })

  it('repli appelant : code connu → libellé, code inconnu → code brut', () => {
    expect(libelleOuCode('created')).toBe('Demande créée')
    expect(libelleOuCode('charabia')).toBe('charabia')
  })
})

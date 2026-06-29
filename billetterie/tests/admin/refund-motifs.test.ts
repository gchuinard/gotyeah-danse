// Motifs de remboursement : ce module n'exporte que des constantes, mais leur
// raison d'être est un contrat de FORMAT — « Place(s) retirée(s) : N » avec un
// préfixe stable, pour qu'une ré-ouverture retrouve le motif ET le nombre.
// On teste donc les valeurs des constantes ET ce contrat composer/relire, en
// reproduisant fidèlement la logique des deux appelants (serveur + client) à
// partir des SEULES constantes exportées (aucun code de prod n'est modifié).

import { describe, expect, it } from 'vitest'

import {
  MOTIF_AUTRE,
  MOTIF_PLACES_RETIREES,
  MOTIF_PLACES_RETIREES_SEP,
  REFUND_MOTIFS,
} from '@/lib/admin/refund-motifs'

// Miroir EXACT de la composition côté serveur (actions.ts) : « Place(s)
// retirée(s) : N » si un nombre est fourni, sinon le libellé seul.
function serveurEnregistreMotif(n?: number): string {
  return n != null
    ? `${MOTIF_PLACES_RETIREES}${MOTIF_PLACES_RETIREES_SEP}${n}`
    : MOTIF_PLACES_RETIREES
}

// Miroir EXACT de la ré-ouverture côté client (demande-row.tsx) : retrouve le
// choix (preset / « places retirées » / « autre ») et ré-extrait le nombre.
const PREFIXE_PLACES = `${MOTIF_PLACES_RETIREES}${MOTIF_PLACES_RETIREES_SEP}`
function reouvreMotif(initial: string | null): { choix: string; count: string } {
  const presets = REFUND_MOTIFS as readonly string[]
  if (!initial) return { choix: presets[0], count: '' }
  if (initial.startsWith(PREFIXE_PLACES)) {
    return {
      choix: MOTIF_PLACES_RETIREES,
      count: initial.slice(PREFIXE_PLACES.length).replace(/\D/g, ''),
    }
  }
  if (presets.includes(initial)) return { choix: initial, count: '' }
  return { choix: MOTIF_AUTRE, count: '' }
}

describe('MOTIF_AUTRE — sentinelle « Autre… »', () => {
  it('vaut la sentinelle technique « __autre__ »', () => {
    expect(MOTIF_AUTRE).toBe('__autre__')
  })

  it('n’est pas un motif proposé dans la liste (c’est une sentinelle)', () => {
    expect((REFUND_MOTIFS as readonly string[]).includes(MOTIF_AUTRE)).toBe(false)
  })

  it('encadrée de doubles underscores → pas de collision avec un libellé saisi', () => {
    expect(MOTIF_AUTRE.startsWith('__')).toBe(true)
    expect(MOTIF_AUTRE.endsWith('__')).toBe(true)
  })
})

describe('MOTIF_PLACES_RETIREES et son séparateur', () => {
  it('libellé exact « Place(s) retirée(s) »', () => {
    expect(MOTIF_PLACES_RETIREES).toBe('Place(s) retirée(s)')
  })

  it('séparateur = « espace deux-points espace » (« : »)', () => {
    expect(MOTIF_PLACES_RETIREES_SEP).toBe(' : ')
    expect(MOTIF_PLACES_RETIREES_SEP.startsWith(' ')).toBe(true)
    expect(MOTIF_PLACES_RETIREES_SEP.endsWith(' ')).toBe(true)
    expect(MOTIF_PLACES_RETIREES_SEP).toContain(':')
  })

  it('préfixe combiné stable = « Place(s) retirée(s) : »', () => {
    expect(PREFIXE_PLACES).toBe('Place(s) retirée(s) : ')
    // Le préfixe inclut le séparateur → il diffère du libellé nu.
    expect(PREFIXE_PLACES).not.toBe(MOTIF_PLACES_RETIREES)
  })
})

describe('REFUND_MOTIFS — options du menu déroulant', () => {
  it('liste exacte et ordonnée', () => {
    expect(REFUND_MOTIFS).toEqual([
      'Place(s) retirée(s)',
      'Demande annulée',
      'Erreur de montant',
      'Geste commercial',
    ])
  })

  it('compte 4 motifs', () => {
    expect(REFUND_MOTIFS).toHaveLength(4)
  })

  it('le premier motif est « Place(s) retirée(s) »', () => {
    expect(REFUND_MOTIFS[0]).toBe(MOTIF_PLACES_RETIREES)
  })

  it('ne contient pas la sentinelle MOTIF_AUTRE', () => {
    expect((REFUND_MOTIFS as readonly string[]).includes(MOTIF_AUTRE)).toBe(false)
  })

  it('aucun doublon', () => {
    expect(new Set(REFUND_MOTIFS).size).toBe(REFUND_MOTIFS.length)
  })

  it('que des libellés non vides', () => {
    for (const m of REFUND_MOTIFS) {
      expect(typeof m).toBe('string')
      expect(m.trim().length).toBeGreaterThan(0)
    }
  })

  it('contient bien le libellé « places retirées »', () => {
    expect((REFUND_MOTIFS as readonly string[]).includes(MOTIF_PLACES_RETIREES)).toBe(true)
  })
})

describe('Composition serveur — « Place(s) retirée(s) : N »', () => {
  it('avec un nombre → préfixe stable suivi du nombre', () => {
    expect(serveurEnregistreMotif(3)).toBe('Place(s) retirée(s) : 3')
    expect(serveurEnregistreMotif(3).startsWith(PREFIXE_PLACES)).toBe(true)
  })

  it('sans nombre → libellé seul, pas de séparateur orphelin', () => {
    expect(serveurEnregistreMotif()).toBe(MOTIF_PLACES_RETIREES)
    expect(serveurEnregistreMotif()).not.toContain(MOTIF_PLACES_RETIREES_SEP)
  })

  it('nombre à deux chiffres conservé tel quel', () => {
    expect(serveurEnregistreMotif(12)).toBe('Place(s) retirée(s) : 12')
  })
})

describe('Ré-ouverture — parse d’un motif déjà enregistré', () => {
  it('reconnaît un motif « places retirées » et ré-extrait le nombre', () => {
    expect(reouvreMotif('Place(s) retirée(s) : 3')).toEqual({
      choix: MOTIF_PLACES_RETIREES,
      count: '3',
    })
  })

  it('ré-extrait un nombre à plusieurs chiffres', () => {
    expect(reouvreMotif('Place(s) retirée(s) : 12').count).toBe('12')
  })

  it('conserve un nombre nul (« 0 »)', () => {
    expect(reouvreMotif('Place(s) retirée(s) : 0').count).toBe('0')
  })

  it('ne garde que les chiffres (caractères non numériques retirés)', () => {
    // Défensif : `replace(/\D/g, '')` ne conserve que les chiffres.
    expect(reouvreMotif('Place(s) retirée(s) : 2 places').count).toBe('2')
  })

  it('un preset simple est restitué tel quel, sans nombre', () => {
    expect(reouvreMotif('Geste commercial')).toEqual({ choix: 'Geste commercial', count: '' })
  })

  it('le libellé « places retirées » SANS nombre → preset, count vide', () => {
    // Pas de séparateur → ne matche pas le préfixe, mais reste un preset connu.
    expect(reouvreMotif(MOTIF_PLACES_RETIREES)).toEqual({
      choix: MOTIF_PLACES_RETIREES,
      count: '',
    })
  })

  it('un motif libre inconnu → bascule sur MOTIF_AUTRE', () => {
    expect(reouvreMotif('Remboursement client VIP')).toEqual({ choix: MOTIF_AUTRE, count: '' })
  })

  it('initial null → défaut = premier preset', () => {
    expect(reouvreMotif(null)).toEqual({ choix: REFUND_MOTIFS[0], count: '' })
  })

  it('initial vide → défaut = premier preset', () => {
    expect(reouvreMotif('')).toEqual({ choix: REFUND_MOTIFS[0], count: '' })
  })

  it('la sentinelle stockée telle quelle est traitée comme « autre »', () => {
    expect(reouvreMotif(MOTIF_AUTRE).choix).toBe(MOTIF_AUTRE)
  })

  it('un autre preset ne matche pas le préfixe « places retirées »', () => {
    expect('Demande annulée'.startsWith(PREFIXE_PLACES)).toBe(false)
    expect(reouvreMotif('Demande annulée').choix).toBe('Demande annulée')
  })
})

describe('Aller-retour serveur → ré-ouverture (préfixe stable)', () => {
  it('compose(n) puis relit → retrouve le choix et le nombre', () => {
    for (const n of [1, 4, 12, 99]) {
      const enregistre = serveurEnregistreMotif(n)
      const relu = reouvreMotif(enregistre)
      expect(relu.choix).toBe(MOTIF_PLACES_RETIREES)
      expect(relu.count).toBe(String(n))
    }
  })

  it('compose sans nombre puis relit → choix « places retirées », count vide', () => {
    const relu = reouvreMotif(serveurEnregistreMotif())
    expect(relu).toEqual({ choix: MOTIF_PLACES_RETIREES, count: '' })
  })
})

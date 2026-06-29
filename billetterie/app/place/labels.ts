// Libellés d'affichage partagés par la route /place (le formulaire ET le lien
// direct /place/[qrToken]) : libellé de section + date FR à l'heure de Paris.

const SECTION_LABELS: Record<string, string> = {
  gauche: 'Gauche',
  centre: 'Centre',
  droite: 'Droite',
}

export function sectionLabel(id: string): string {
  return SECTION_LABELS[id] ?? id
}

// « 20:30 » → « 20h30 », heure de Paris.
export function formatDateHeure(d: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(d)
    .replace(/(\d{2}):(\d{2})/, '$1h$2')
}

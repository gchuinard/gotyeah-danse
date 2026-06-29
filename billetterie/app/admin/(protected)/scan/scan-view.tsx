'use client'

// Vue de scan — pensée pour un téléphone de bénévole dans un hall sombre,
// SANS réseau fiable :
//
//  - au chargement, le manifeste complet des billets arrive en mémoire
//    (Map<qrToken, billet>) ; chaque scan est ensuite validé 100 % en
//    LOCAL, instantanément, sans aucun aller-retour réseau ;
//  - chaque scan valide rejoint une file de synchro miroir localStorage
//    (clé par représentation : survit à un refresh) ; une tâche de flush
//    POSTe les entrées une à une avec backoff, relancée quand le réseau
//    revient (évènement 'online') ;
//  - premier scan gagne : si la base connaît un scannedAt antérieur
//    ('deja-scanne' au flush), on l'adopte localement.
//
// html5-qrcode est importé DYNAMIQUEMENT (la lib touche window au chargement)
// et on utilise la classe de base Html5Qrcode — pas le Scanner clé en main —
// pour garder la main sur l'UI (gros boutons, panneaux contrastés).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Html5Qrcode } from 'html5-qrcode'

import styles from './scan.module.css'

type TicketInfo = {
  qrToken: string
  section: string
  rowLabel: string
  number: number
  name: string
  phone: string
  email: string
  scannedAt: string | null // ISO — vérité locale (peut précéder la base)
}

// Annuaire : toutes les demandes (toutes reps / statuts), pour l'indice quand le
// manifeste de CETTE rep ne contient pas la personne cherchée.
type DirEntry = {
  name: string
  phone: string
  email: string
  status: string
  repTitle: string
}

// Pourquoi une personne de l'annuaire n'est pas scannable ici.
function indiceStatut(d: DirEntry): string {
  switch (d.status) {
    case 'pending':
      return `en attente (non réglée, non placée) — ${d.repTitle}`
    case 'paid':
      return `réglée mais pas encore placée — ${d.repTitle}`
    case 'placed':
      return `placée sur « ${d.repTitle} » (autre date)`
    case 'cancelled':
      return `demande annulée — ${d.repTitle}`
    case 'expired':
      return `demande expirée — ${d.repTitle}`
    default:
      return d.repTitle
  }
}

type QueueEntry = { qrToken: string; scannedAt: string }

type PanelState =
  | { kind: 'ok'; ticket: TicketInfo }
  | { kind: 'deja'; ticket: TicketInfo; strict: boolean }
  | { kind: 'inconnu' }

type Props = {
  representations: { id: string; label: string }[]
  repId: string
}

const PANEL_MS = 6500 // le panneau reste ~6,5 s (ou jusqu'au scan suivant)
const DEBOUNCE_MS = 3000 // anti-rebond : la caméra décode le même QR en rafale
const RETRY_BASE_MS = 2000
const RETRY_MAX_MS = 30_000

const heureFmt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  hour: '2-digit',
  minute: '2-digit',
})

function formatHeure(iso: string): string {
  return heureFmt.format(new Date(iso))
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Critère de la recherche manuelle. Le nom est stocké « Prénom Nom » dans un
// seul champ : on le scinde au premier espace (premier mot = prénom, le reste
// = nom). Un nom d'un seul mot reste cherchable sous les deux critères.
type SearchField = 'nom' | 'prenom' | 'tel' | 'email' | 'place'

const SEARCH_FIELDS: { value: SearchField; label: string; placeholder: string }[] = [
  { value: 'nom', label: 'Nom', placeholder: 'Nom de famille' },
  { value: 'prenom', label: 'Prénom', placeholder: 'Prénom' },
  { value: 'tel', label: 'Téléphone', placeholder: 'ex. 06 12 34 56 78' },
  { value: 'email', label: 'Email', placeholder: 'ex. martin@email.fr' },
  { value: 'place', label: 'Place', placeholder: 'ex. G12' },
]

function splitName(name: string): { first: string; last: string } {
  const t = name.trim().replace(/\s+/g, ' ')
  const sp = t.indexOf(' ')
  if (sp === -1) return { first: t, last: t }
  return { first: t.slice(0, sp), last: t.slice(sp + 1) }
}

function seatLabel(t: TicketInfo): string {
  return `Rang ${t.rowLabel} · Place ${t.number} · ${capitalize(t.section)}`
}

// Recherche insensible à la casse ET aux accents (Lefèvre ↔ lefevre).
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function vibrate(kind: 'success' | 'error') {
  try {
    // Succès : impulsion courte. Erreur : motif long, sentie même en poche.
    navigator.vibrate?.(kind === 'success' ? 80 : [150, 80, 300])
  } catch {
    // Vibration indisponible : tant pis, le panneau couleur suffit.
  }
}

export default function ScanView({ representations, repId }: Props) {
  const router = useRouter()
  const storageKey = `billetterie-scan-queue:${repId}`

  // --- Billets : état React pour le rendu + miroir ref pour les callbacks
  // de la caméra (créés une fois au démarrage du scan, donc closures figées).
  const [tickets, setTickets] = useState<Map<string, TicketInfo> | null>(null)
  const ticketsRef = useRef<Map<string, TicketInfo> | null>(null)
  // Annuaire (toutes les demandes) chargé avec le manifeste, pour les indices.
  const [directory, setDirectory] = useState<DirEntry[]>([])
  const applyTickets = useCallback((next: Map<string, TicketInfo>) => {
    ticketsRef.current = next
    setTickets(next)
  }, [])

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sessionExpired, setSessionExpired] = useState(false)

  // Contrôle strict des doublons (OFF par défaut) : en souple, un billet déjà
  // scanné n'est PAS bloqué — le scan sert au comptage, l'humain laisse entrer.
  // Préférence par appareil (localStorage), lue APRÈS le montage (évite tout
  // décalage d'hydratation).
  const [controleStrict, setControleStrict] = useState(false)
  const toggleStrict = useCallback(() => {
    setControleStrict((v) => {
      const next = !v
      try {
        localStorage.setItem('billetterie-scan-strict', next ? '1' : '0')
      } catch {
        // tant pis pour la persistance
      }
      return next
    })
  }, [])

  // --- File de synchro : ref (vérité) + compteur d'état (indicateur).
  const queueRef = useRef<QueueEntry[]>([])
  const [queueCount, setQueueCount] = useState(0)
  const persistQueue = useCallback(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(queueRef.current))
    } catch {
      // localStorage plein/indisponible : la file vit en mémoire, on
      // perdrait seulement la résilience au refresh.
    }
    setQueueCount(queueRef.current.length)
  }, [storageKey])

  // --- Panneau de résultat.
  const [panel, setPanel] = useState<PanelState | null>(null)
  const panelTimerRef = useRef<number | null>(null)
  const showPanel = useCallback((p: PanelState) => {
    if (panelTimerRef.current !== null) clearTimeout(panelTimerRef.current)
    setPanel(p)
    panelTimerRef.current = window.setTimeout(() => setPanel(null), PANEL_MS)
  }, [])

  // --- Flush de la file : une entrée à la fois, backoff exponentiel simple,
  // relancé par tout nouveau scan et par le retour du réseau.
  const flushingRef = useRef(false)
  const retryDelayRef = useRef(RETRY_BASE_MS)
  const retryTimerRef = useRef<number | null>(null)

  const flush = useCallback(
    async function doFlush(): Promise<void> {
      if (flushingRef.current) return
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
      flushingRef.current = true
      try {
        while (queueRef.current.length > 0) {
          const entry = queueRef.current[0]

          let res: Response
          try {
            res = await fetch('/api/admin/scan', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(entry),
            })
          } catch {
            // Pas de réseau (le cas nominal de la salle) : on garde la file
            // et on retentera — backoff + déclencheur 'online'.
            const delay = retryDelayRef.current
            retryDelayRef.current = Math.min(delay * 2, RETRY_MAX_MS)
            retryTimerRef.current = window.setTimeout(() => {
              retryTimerRef.current = null
              void doFlush()
            }, delay)
            return
          }

          if (res.status === 401) {
            setSessionExpired(true)
            return
          }
          if (!res.ok) {
            // 5xx ou autre pépin serveur : même traitement qu'un échec réseau.
            const delay = retryDelayRef.current
            retryDelayRef.current = Math.min(delay * 2, RETRY_MAX_MS)
            retryTimerRef.current = window.setTimeout(() => {
              retryTimerRef.current = null
              void doFlush()
            }, delay)
            return
          }

          const data = (await res.json()) as {
            status: 'ok' | 'deja-scanne' | 'inconnu'
            scannedAt: string | null
          }

          // Premier scan gagne : un autre bénévole a synchronisé ce billet
          // avant nous → la base fait foi, on adopte son heure si antérieure.
          if (data.status === 'deja-scanne' && data.scannedAt !== null) {
            const dbTime = data.scannedAt
            const map = ticketsRef.current
            const t = map?.get(entry.qrToken)
            if (
              map &&
              t &&
              (t.scannedAt === null || Date.parse(dbTime) < Date.parse(t.scannedAt))
            ) {
              const next = new Map(map)
              next.set(entry.qrToken, { ...t, scannedAt: dbTime })
              applyTickets(next)
            }
          }

          // Succès (ok / deja-scanne / inconnu) : l'entrée est traitée.
          queueRef.current = queueRef.current.slice(1)
          persistQueue()
          retryDelayRef.current = RETRY_BASE_MS
        }
      } finally {
        flushingRef.current = false
      }
    },
    [applyTickets, persistQueue],
  )

  // --- Chargement du manifeste (au montage + bouton « Recharger »).
  const loadTickets = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/admin/scan-data/${repId}`, { cache: 'no-store' })
      if (res.status === 401) {
        setSessionExpired(true)
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { tickets: TicketInfo[]; directory?: DirEntry[] }
      setDirectory(data.directory ?? [])
      const map = new Map(data.tickets.map((t) => [t.qrToken, t]))
      // Les scans locaux pas encore synchronisés priment sur un scannedAt
      // null venu du serveur (sinon on re-validerait un billet déjà passé).
      for (const e of queueRef.current) {
        const t = map.get(e.qrToken)
        if (t && t.scannedAt === null) map.set(e.qrToken, { ...t, scannedAt: e.scannedAt })
      }
      applyTickets(map)
    } catch {
      setLoadError('Impossible de charger les billets — vérifiez le réseau puis réessayez.')
    } finally {
      setLoading(false)
    }
  }, [repId, applyTickets])

  // Montage : recharger la file résiduelle (refresh pendant la soirée),
  // puis le manifeste, puis tenter un flush.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as QueueEntry[]
        if (Array.isArray(parsed)) {
          queueRef.current = parsed.filter(
            (e) => typeof e?.qrToken === 'string' && typeof e?.scannedAt === 'string',
          )
          setQueueCount(queueRef.current.length)
        }
      }
    } catch {
      // file illisible : on repart à vide
    }
    try {
      // Préférence « contrôle strict » par appareil (souple par défaut).
      if (localStorage.getItem('billetterie-scan-strict') === '1') setControleStrict(true)
    } catch {
      // préférence illisible : on reste en souple
    }
    void loadTickets().then(() => void flush())
  }, [storageKey, loadTickets, flush])

  // Le retour du réseau relance la synchro immédiatement.
  useEffect(() => {
    const onOnline = () => void flush()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [flush])

  // --- Traitement d'un token (caméra OU saisie manuelle) : 100 % local.
  const processToken = useCallback(
    (rawToken: string) => {
      const token = rawToken.trim()
      const map = ticketsRef.current
      if (!map) return // manifeste pas encore chargé

      const ticket = map.get(token)
      if (!ticket) {
        showPanel({ kind: 'inconnu' })
        vibrate('error')
        return
      }
      if (ticket.scannedAt !== null) {
        // Déjà scanné (localement ou en base) : l'heure affichée est celle du
        // PREMIER passage. En souple (défaut), ce n'est PAS un blocage — on
        // informe et on laisse entrer ; en strict, c'est une alerte. L'humain
        // tranche dans les deux cas.
        showPanel({ kind: 'deja', ticket, strict: controleStrict })
        vibrate(controleStrict ? 'error' : 'success')
        return
      }

      const now = new Date().toISOString()
      const updated: TicketInfo = { ...ticket, scannedAt: now }
      const next = new Map(map)
      next.set(token, updated)
      applyTickets(next)

      queueRef.current = [...queueRef.current, { qrToken: token, scannedAt: now }]
      persistQueue()

      showPanel({ kind: 'ok', ticket: updated })
      vibrate('success')
      void flush()
    },
    [applyTickets, persistQueue, showPanel, flush, controleStrict],
  )

  // Anti-rebond caméra : le même QR décodé en rafale = un seul traitement.
  const lastDecodeRef = useRef<{ token: string; at: number }>({ token: '', at: 0 })
  const onDecoded = useCallback(
    (text: string) => {
      const now = Date.now()
      const last = lastDecodeRef.current
      if (text === last.token && now - last.at < DEBOUNCE_MS) {
        last.at = now // décodages continus : on prolonge la fenêtre
        return
      }
      lastDecodeRef.current = { token: text, at: now }
      processToken(text)
    },
    [processToken],
  )
  // Le callback passé à html5-qrcode est figé au démarrage de la caméra :
  // on passe par une ref toujours à jour (mise à jour en effet, pas pendant
  // le rendu — exigence des règles React).
  const onDecodedRef = useRef(onDecoded)
  useEffect(() => {
    onDecodedRef.current = onDecoded
  }, [onDecoded])

  // --- Caméra.
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const startingRef = useRef(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  const startCamera = useCallback(async () => {
    if (startingRef.current || scannerRef.current) return
    startingRef.current = true
    setCameraError(null)
    try {
      // Import dynamique : html5-qrcode touche window à l'évaluation.
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
      const scanner = new Html5Qrcode('scan-camera', {
        verbose: false,
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      })
      await scanner.start(
        { facingMode: 'environment' }, // caméra arrière
        { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1 },
        (decodedText) => onDecodedRef.current(decodedText),
        undefined, // les frames sans QR sont normales, pas une erreur
      )
      scannerRef.current = scanner
      setCameraOn(true)
    } catch {
      setCameraError(
        "Caméra indisponible — autorisez l'accès dans le navigateur, et vérifiez que la page est servie en HTTPS (ou localhost).",
      )
    } finally {
      startingRef.current = false
    }
  }, [])

  const stopCamera = useCallback(async () => {
    const scanner = scannerRef.current
    scannerRef.current = null
    setCameraOn(false)
    if (!scanner) return
    try {
      if (scanner.isScanning) await scanner.stop()
    } catch {
      // déjà arrêtée
    }
    try {
      scanner.clear()
    } catch {
      // élément déjà démonté
    }
  }, [])

  // Démontage : arrêt propre de la caméra + purge des timers.
  useEffect(() => {
    return () => {
      const scanner = scannerRef.current
      scannerRef.current = null
      if (scanner?.isScanning) {
        scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => {})
      }
      if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current)
      if (panelTimerRef.current !== null) clearTimeout(panelTimerRef.current)
    }
  }, [])

  // --- Saisie manuelle de secours : on choisit le critère (nom, prénom, tél.,
  // email ou place « G12 »), puis on tape. Filtrage 100 % local sur le manifeste.
  const [field, setField] = useState<SearchField>('nom')
  const [query, setQuery] = useState('')
  const results = useMemo(() => {
    if (!tickets) return []
    const q = query.trim()
    if (q.length < 2) return []
    const nq = normalize(q)
    // Séparateurs ignorés des deux côtés pour le téléphone.
    const qDigits = q.replace(/\D/g, '')
    const seatMatch = /^([a-z])\s*(\d{1,3})$/i.exec(q)
    const found: TicketInfo[] = []
    for (const t of tickets.values()) {
      let match = false
      switch (field) {
        case 'nom':
          match = normalize(splitName(t.name).last).includes(nq)
          break
        case 'prenom':
          match = normalize(splitName(t.name).first).includes(nq)
          break
        case 'tel':
          // ≥ 2 chiffres pour ne pas matcher tout le monde sur « 0 ».
          match = qDigits.length >= 2 && t.phone.replace(/\D/g, '').includes(qDigits)
          break
        case 'email':
          match = normalize(t.email).includes(nq)
          break
        case 'place':
          match =
            seatMatch !== null &&
            t.rowLabel.toLowerCase() === seatMatch[1].toLowerCase() &&
            t.number === Number(seatMatch[2])
          break
      }
      if (match) {
        found.push(t)
        if (found.length >= 30) break
      }
    }
    found.sort(
      (a, b) =>
        a.name.localeCompare(b.name, 'fr') ||
        a.rowLabel.localeCompare(b.rowLabel) ||
        a.number - b.number,
    )
    return found
  }, [tickets, query, field])

  // Indices : quand le manifeste de CETTE rep ne donne rien, on cherche la
  // personne dans l'annuaire global (autres reps, non placées, annulées) pour
  // expliquer pourquoi elle n'est pas scannable ici. Pas pour « place ».
  const hints = useMemo(() => {
    if (results.length > 0) return []
    const q = query.trim()
    if (q.length < 2 || field === 'place') return []
    const nq = normalize(q)
    const qDigits = q.replace(/\D/g, '')
    const out: DirEntry[] = []
    for (const d of directory) {
      let match = false
      switch (field) {
        case 'nom':
          match = normalize(splitName(d.name).last).includes(nq)
          break
        case 'prenom':
          match = normalize(splitName(d.name).first).includes(nq)
          break
        case 'tel':
          match = qDigits.length >= 2 && d.phone.replace(/\D/g, '').includes(qDigits)
          break
        case 'email':
          match = normalize(d.email).includes(nq)
          break
      }
      if (match) {
        out.push(d)
        if (out.length >= 10) break
      }
    }
    return out
  }, [results.length, directory, query, field])

  // --- Compteurs.
  const scannedCount = useMemo(() => {
    if (!tickets) return 0
    let n = 0
    for (const t of tickets.values()) if (t.scannedAt !== null) n += 1
    return n
  }, [tickets])

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Scan des billets</h1>
        <label className={styles.repPicker}>
          Représentation
          <select
            value={repId}
            onChange={(e) => router.push(`/admin/scan?rep=${encodeURIComponent(e.target.value)}`)}
          >
            {representations.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      {sessionExpired && (
        <div className={styles.sessionBanner} role="alert">
          Session expirée — <a href="/admin/login">reconnectez-vous</a> pour synchroniser les
          scans (ils sont conservés sur ce téléphone).
        </div>
      )}

      <div className={styles.statusRow}>
        <div className={styles.counter} aria-live="polite">
          {tickets ? (
            <>
              <strong>{scannedCount}</strong> scannés / {tickets.size} billets
            </>
          ) : loading ? (
            'Chargement des billets…'
          ) : (
            'Billets non chargés'
          )}
        </div>
        <div
          className={queueCount > 0 ? styles.syncPending : styles.syncOk}
          aria-live="polite"
        >
          {queueCount > 0 ? `${queueCount} scan${queueCount > 1 ? 's' : ''} en attente de synchro` : 'Synchro à jour'}
        </div>
        <button
          type="button"
          className={styles.reload}
          onClick={() => void loadTickets()}
          disabled={loading}
        >
          {loading ? 'Chargement…' : 'Recharger les billets'}
        </button>
      </div>

      <div className={styles.strictRow}>
        <label className={styles.strictToggle}>
          <input type="checkbox" checked={controleStrict} onChange={toggleStrict} />
          <span>Contrôle strict des doublons</span>
        </label>
        <span className={styles.strictHint}>
          {controleStrict
            ? 'Un billet déjà scanné déclenche une alerte.'
            : 'Souple : un billet déjà scanné n’est pas bloqué (le scan sert au comptage).'}
        </span>
      </div>

      {loadError && (
        <p className={styles.loadError} role="alert">
          {loadError}
        </p>
      )}

      {/* Panneau de résultat — couleurs franches, lisible dans le noir. */}
      <div className={styles.panelSlot} aria-live="assertive">
        {panel?.kind === 'ok' && (
          <div className={`${styles.panel} ${styles.panelOk}`}>
            <p className={styles.panelName}>{panel.ticket.name}</p>
            <p className={styles.panelSeat}>{seatLabel(panel.ticket)}</p>
          </div>
        )}
        {panel?.kind === 'deja' && panel.strict && (
          <div className={`${styles.panel} ${styles.panelDeja}`}>
            <p className={styles.panelHeadline}>
              Déjà scanné à {panel.ticket.scannedAt ? formatHeure(panel.ticket.scannedAt) : '—'}
            </p>
            <p className={styles.panelName}>{panel.ticket.name}</p>
            <p className={styles.panelSeat}>{seatLabel(panel.ticket)}</p>
          </div>
        )}
        {panel?.kind === 'deja' && !panel.strict && (
          <div className={`${styles.panel} ${styles.panelDejaSouple}`}>
            <p className={styles.panelHeadline}>Laissez entrer</p>
            <p className={styles.panelName}>{panel.ticket.name}</p>
            <p className={styles.panelSeat}>{seatLabel(panel.ticket)}</p>
            <p className={styles.panelNote}>
              Déjà passé à {panel.ticket.scannedAt ? formatHeure(panel.ticket.scannedAt) : '—'}
            </p>
          </div>
        )}
        {panel?.kind === 'inconnu' && (
          <div className={`${styles.panel} ${styles.panelInconnu}`}>
            <p className={styles.panelHeadline}>Billet inconnu</p>
          </div>
        )}
      </div>

      {/* Caméra : html5-qrcode injecte la vidéo dans #scan-camera. */}
      <section className={styles.cameraSection}>
        <div id="scan-camera" className={styles.camera} data-active={cameraOn || undefined} />
        <button
          type="button"
          className={cameraOn ? styles.cameraStop : styles.cameraStart}
          onClick={() => (cameraOn ? void stopCamera() : void startCamera())}
          disabled={loading && !tickets}
        >
          {cameraOn ? 'Arrêter le scan' : 'Démarrer le scan'}
        </button>
        {cameraError && (
          <p className={styles.cameraErrorMsg} role="alert">
            {cameraError}
          </p>
        )}
        <p className={styles.cameraNote}>
          La caméra exige une page servie en HTTPS (ou localhost).
        </p>
      </section>

      {/* Saisie manuelle de secours. */}
      <section className={styles.manual}>
        <h2 className={styles.manualTitle}>Recherche manuelle</h2>
        <label className={styles.fieldPicker}>
          Rechercher par
          <select value={field} onChange={(e) => setField(e.target.value as SearchField)}>
            {SEARCH_FIELDS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <input
          type="search"
          className={styles.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={SEARCH_FIELDS.find((f) => f.value === field)?.placeholder}
          inputMode={field === 'tel' ? 'tel' : undefined}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {query.trim().length >= 2 && (
          <ul className={styles.results}>
            {results.length === 0 && (
              <li className={styles.noResult}>
                Aucun billet à scanner ici.
                {hints.length > 0 && (
                  <ul className={styles.hints}>
                    {hints.map((h, i) => (
                      <li key={i} className={styles.hint}>
                        <span className={styles.hintName}>{h.name}</span>
                        <span className={styles.hintMeta}>{indiceStatut(h)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )}
            {results.map((t) => (
              <li key={t.qrToken} className={styles.result}>
                <div className={styles.resultInfo}>
                  <span className={styles.resultName}>{t.name}</span>
                  <span className={styles.resultSeat}>{seatLabel(t)}</span>
                </div>
                {t.scannedAt !== null ? (
                  <span className={styles.resultScanned}>Scanné à {formatHeure(t.scannedAt)}</span>
                ) : (
                  <button
                    type="button"
                    className={styles.markButton}
                    onClick={() => processToken(t.qrToken)}
                  >
                    Marquer scanné
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

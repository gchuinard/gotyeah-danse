'use client'

// Login en deux modes (onglets) :
//  - « Admin » : email → code 6 chiffres (saisi en 6 cases, cf. CodeInput).
//  - « Bénévole » : prénom + PIN partagé pour accéder au mode scan.
// Chaque formulaire est branché DIRECTEMENT sur sa server action.

import { useActionState, useState } from 'react'
import {
  connexionScan,
  demanderCode,
  verifierCode,
  type LoginState,
  type ScanLoginState,
} from './actions'
import { CodeInput } from './code-input'
import styles from './login.module.css'

const INITIAL: LoginState = { step: 'email' }
const SCAN_INITIAL: ScanLoginState = {}

type Mode = 'admin' | 'scan'

export function LoginForm() {
  const [mode, setMode] = useState<Mode>('admin')

  const [emailState, emailAction, emailPending] = useActionState<LoginState, FormData>(
    demanderCode,
    INITIAL,
  )
  const [codeState, codeAction, codePending] = useActionState<LoginState, FormData>(
    verifierCode,
    INITIAL,
  )
  const [scanState, scanAction, scanPending] = useActionState<ScanLoginState, FormData>(
    connexionScan,
    SCAN_INITIAL,
  )

  // On passe à l'étape code dès qu'un code a été demandé ; une erreur de
  // vérification "step email" (rate-limit) ramène au début.
  const step = codeState.error && codeState.step === 'email' ? 'email' : emailState.step
  const email = emailState.email ?? ''

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Billetterie</h1>

        <div className={styles.tabs} role="tablist" aria-label="Type de connexion">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'admin'}
            className={mode === 'admin' ? styles.tabActive : styles.tab}
            onClick={() => setMode('admin')}
          >
            Admin
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'scan'}
            className={mode === 'scan' ? styles.tabActive : styles.tab}
            onClick={() => setMode('scan')}
          >
            Bénévole · scan
          </button>
        </div>

        {mode === 'admin' ? (
          step === 'email' ? (
            <form className={styles.form} action={emailAction}>
              <label className={styles.label}>
                Email
                <input
                  className={styles.input}
                  type="email"
                  name="email"
                  autoComplete="username"
                  autoFocus
                  required
                />
              </label>
              {emailState.error && <p className={styles.error}>{emailState.error}</p>}
              {codeState.error && codeState.step === 'email' && (
                <p className={styles.error}>{codeState.error}</p>
              )}
              <button className={styles.button} type="submit" disabled={emailPending}>
                {emailPending ? 'Un instant…' : 'Recevoir un code'}
              </button>
            </form>
          ) : (
            <form className={styles.form} action={codeAction}>
              <p className={styles.info}>{emailState.info ?? `Code envoyé à ${email}.`}</p>
              <input type="hidden" name="email" value={email} />
              <label className={styles.label}>
                Code reçu par email
                <CodeInput disabled={codePending} />
              </label>
              {codeState.error && <p className={styles.error}>{codeState.error}</p>}
              <button className={styles.button} type="submit" disabled={codePending}>
                {codePending ? 'Un instant…' : 'Se connecter'}
              </button>
              <p className={styles.hint}>
                Pas de code reçu ? Vérifiez vos indésirables, ou rechargez la page pour redemander un
                code (valable 10 minutes).
              </p>
            </form>
          )
        ) : (
          <form className={styles.form} action={scanAction}>
            <p className={styles.info}>
              Accès au scan des billets le soir du spectacle. Demandez le PIN à l&apos;organisateur.
            </p>
            <label className={styles.label}>
              Votre prénom
              <input
                className={styles.input}
                type="text"
                name="prenom"
                autoComplete="given-name"
                maxLength={60}
                autoFocus
                required
              />
            </label>
            <label className={styles.label}>
              PIN
              <input
                className={styles.input}
                type="text"
                name="pin"
                inputMode="numeric"
                pattern="\d{4,8}"
                maxLength={8}
                autoComplete="off"
                required
              />
            </label>
            {scanState.error && <p className={styles.error}>{scanState.error}</p>}
            <button className={styles.button} type="submit" disabled={scanPending}>
              {scanPending ? 'Un instant…' : 'Accéder au scan'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}

'use client'

// Deux formulaires distincts (demande de code, puis vérification), chacun
// branché DIRECTEMENT sur sa server action : le login marche aussi sans
// JavaScript (progressive enhancement).

import { useActionState } from 'react'
import { demanderCode, verifierCode, type LoginState } from './actions'
import styles from './login.module.css'

const INITIAL: LoginState = { step: 'email' }

export function LoginForm() {
  const [emailState, emailAction, emailPending] = useActionState<LoginState, FormData>(
    demanderCode,
    INITIAL,
  )
  const [codeState, codeAction, codePending] = useActionState<LoginState, FormData>(
    verifierCode,
    INITIAL,
  )

  // On passe à l'étape code dès qu'un code a été demandé ; une erreur de
  // vérification "step email" (rate-limit) ramène au début.
  const step = codeState.error && codeState.step === 'email' ? 'email' : emailState.step
  const email = emailState.email ?? ''

  return (
    <main className={styles.page}>
      {step === 'email' ? (
        <form className={styles.card} action={emailAction}>
          <h1 className={styles.title}>Billetterie — Admin</h1>
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
        <form className={styles.card} action={codeAction}>
          <h1 className={styles.title}>Billetterie — Admin</h1>
          <p className={styles.info}>{emailState.info ?? `Code envoyé à ${email}.`}</p>
          <input type="hidden" name="email" value={email} />
          <label className={styles.label}>
            Code reçu par email
            <input
              className={styles.input}
              type="text"
              name="code"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              placeholder="123456"
              autoComplete="one-time-code"
              autoFocus
              required
            />
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
      )}
    </main>
  )
}

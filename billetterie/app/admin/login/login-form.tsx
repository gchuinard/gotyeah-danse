'use client'

import { useActionState } from 'react'
import { seConnecter, type LoginState } from './actions'
import styles from './login.module.css'

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(seConnecter, {})

  return (
    <main className={styles.page}>
      <form className={styles.card} action={action}>
        <h1 className={styles.title}>Billetterie — Admin</h1>
        <label className={styles.label}>
          Email
          <input className={styles.input} type="email" name="email" autoComplete="username" required />
        </label>
        <label className={styles.label}>
          Mot de passe
          <input className={styles.input} type="password" name="password" autoComplete="current-password" required />
        </label>
        {state.error && <p className={styles.error}>{state.error}</p>}
        <button className={styles.button} type="submit" disabled={pending}>
          {pending ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </main>
  )
}

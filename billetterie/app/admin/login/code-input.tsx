'use client'

// Saisie du code à 6 chiffres : une case par chiffre. Auto-avance, retour
// arrière, flèches, et coller (le code arrive souvent par copier-coller depuis
// l'email). Un <input hidden name="code"> agrège les 6 cases pour la server
// action — l'API du formulaire reste inchangée.

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import styles from './login.module.css'

const LEN = 6

export function CodeInput({ disabled }: { disabled?: boolean }) {
  const [digits, setDigits] = useState<string[]>(() => Array(LEN).fill(''))
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const code = digits.join('')

  function fill(value: string, start: number) {
    const chars = value
      .replace(/\D/g, '')
      .slice(0, LEN - start)
      .split('')
    if (chars.length === 0) return
    setDigits((prev) => {
      const next = [...prev]
      chars.forEach((c, k) => {
        next[start + k] = c
      })
      return next
    })
    refs.current[Math.min(start + chars.length, LEN - 1)]?.focus()
  }

  function handleChange(i: number, raw: string) {
    const v = raw.replace(/\D/g, '')
    if (v.length > 1) {
      fill(v, i)
      return
    }
    setDigits((prev) => {
      const next = [...prev]
      next[i] = v
      return next
    })
    if (v && i < LEN - 1) refs.current[i + 1]?.focus()
  }

  function handleKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && digits[i] === '' && i > 0) {
      refs.current[i - 1]?.focus()
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault()
      refs.current[i - 1]?.focus()
    } else if (e.key === 'ArrowRight' && i < LEN - 1) {
      e.preventDefault()
      refs.current[i + 1]?.focus()
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLDivElement>) {
    const text = e.clipboardData.getData('text')
    if (/\d/.test(text)) {
      e.preventDefault()
      fill(text, 0)
    }
  }

  return (
    <>
      <input type="hidden" name="code" value={code} />
      <div className={styles.otp} onPaste={handlePaste}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el
            }}
            className={styles.otpBox}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={d}
            disabled={disabled}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onFocus={(e) => e.currentTarget.select()}
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            aria-label={`Chiffre ${i + 1} sur ${LEN}`}
            autoFocus={i === 0}
          />
        ))}
      </div>
    </>
  )
}

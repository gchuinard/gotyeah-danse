'use client'

// Bouton de soumission avec confirmation JS native — composant client
// minimal. Sans JS, le formulaire se soumet sans confirmation (acceptable :
// l'admin est derrière login + proxy).

export function ConfirmSubmit({
  message,
  className,
  children,
}: {
  message: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault()
      }}
    >
      {children}
    </button>
  )
}

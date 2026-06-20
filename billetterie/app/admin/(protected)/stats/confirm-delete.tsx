'use client'

// Bouton « supprimer » avec confirmation aux couleurs du site. La suppression
// utilise un formAction qui SURCHARGE l'action du formulaire (qui sert au
// « modifier ») : au clic on bloque la soumission native et on ouvre la boîte ;
// à la confirmation on re-soumet le formulaire EN PASSANT ce bouton comme
// submitter, pour que son formAction (et non celui du form) soit pris en compte.

import { useRef, useState } from 'react'

import { ConfirmDialog } from '@/components/confirm-dialog'

export function ConfirmDeleteButton({
  formAction,
  message,
  className,
  title,
  ariaLabel,
  children,
}: {
  formAction: (formData: FormData) => void | Promise<void>
  message: string
  className?: string
  title?: string
  ariaLabel?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button
        ref={ref}
        type="submit"
        formAction={formAction}
        className={className}
        title={title}
        aria-label={ariaLabel}
        onClick={(e) => {
          e.preventDefault() // empêche la soumission immédiate
          setOpen(true)
        }}
      >
        {children}
      </button>
      <ConfirmDialog
        open={open}
        title="Supprimer cet article ?"
        message={message}
        confirmLabel="Supprimer"
        danger
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false)
          const btn = ref.current
          btn?.form?.requestSubmit(btn) // submitter = ce bouton → son formAction
        }}
      />
    </>
  )
}

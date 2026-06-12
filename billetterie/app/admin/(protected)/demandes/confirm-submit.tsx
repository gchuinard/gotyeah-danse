'use client'

// Bouton de soumission avec confirmation aux couleurs du site (ConfirmDialog).
// Au clic : ouvre la boîte ; à la confirmation : soumet le formulaire parent.

import { useRef, useState } from 'react'

import { ConfirmDialog } from '@/components/confirm-dialog'

export function ConfirmSubmit({
  message,
  className,
  children,
}: {
  message: string
  className?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button ref={ref} type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      <ConfirmDialog
        open={open}
        title="Confirmer"
        message={message}
        confirmLabel="Confirmer"
        danger
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false)
          ref.current?.form?.requestSubmit()
        }}
      />
    </>
  )
}

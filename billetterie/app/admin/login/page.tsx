import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { homeFor } from '@/lib/auth/roles'
import { getSession } from '@/lib/auth/session'
import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'Connexion — Billetterie' }
export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  const session = await getSession()
  if (session) redirect(homeFor(session.role))
  return <LoginForm />
}

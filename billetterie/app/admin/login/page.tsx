import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'Connexion — Billetterie' }
export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  if (await getSession()) redirect('/admin')
  return <LoginForm />
}

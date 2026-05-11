import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'

export default async function HomePage() {
  const session = await getServerSession()
  redirect(session ? '/dashboard' : '/login')
}

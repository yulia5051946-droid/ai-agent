import NextAuth from 'next-auth'
import { getServerSession, type NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import type { JWT } from 'next-auth/jwt'
import { saveSyncCredential } from '@/lib/db'
import { refreshGoogleAccessToken } from '@/lib/google-token'

const ALLOWED_DOMAINS = ['garena.com', 'sea.com']

async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    const data = await refreshGoogleAccessToken(token.refreshToken as string)
    return {
      ...token,
      accessToken: data.accessToken,
      expiresAt: data.expiresAt ?? token.expiresAt,
      refreshToken: data.refreshToken ?? token.refreshToken,
    }
  } catch {
    return { ...token, error: 'RefreshAccessTokenError' }
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: [
            'openid', 'email', 'profile',
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/drive',
          ].join(' '),
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      const domain = (user.email || '').split('@')[1]
      return Boolean(domain && ALLOWED_DOMAINS.includes(domain))
    },
    async jwt({ token, account, user }) {
      if (account) {
        const email = user?.email || token.email
        if (email && account.refresh_token) {
          saveSyncCredential(
            email,
            account.refresh_token,
            account.access_token,
            account.expires_at ?? null
          )
        }
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at,
        }
      }
      const expiresAt = token.expiresAt as number | undefined
      if (expiresAt && Date.now() / 1000 < expiresAt - 300) {
        return token
      }
      return refreshAccessToken(token)
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string
      session.refreshToken = token.refreshToken as string
      session.error = token.error as string | undefined
      return session
    },
  },
  pages: { signIn: '/login', error: '/login' },
}

export const handlers = NextAuth(authOptions)

export function auth() {
  return getServerSession(authOptions)
}

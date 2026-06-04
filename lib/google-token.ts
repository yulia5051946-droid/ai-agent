export interface GoogleTokenRefreshResult {
  accessToken: string
  refreshToken?: string
  expiresAt: number | null
}

export async function refreshGoogleAccessToken(refreshToken: string): Promise<GoogleTokenRefreshResult> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data?.error_description || data?.error || 'Google token refresh failed')
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: typeof data.expires_in === 'number'
      ? Math.floor(Date.now() / 1000) + data.expires_in
      : null,
  }
}

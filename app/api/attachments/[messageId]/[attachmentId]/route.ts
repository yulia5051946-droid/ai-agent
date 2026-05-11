import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { google } from 'googleapis'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ messageId: string; attachmentId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const { messageId, attachmentId } = await params
  const { searchParams } = new URL(request.url)
  const filename = searchParams.get('filename') || 'attachment'
  const mimeType = searchParams.get('mime') || 'application/octet-stream'

  const auth = new google.auth.OAuth2()
  auth.setCredentials({ access_token: session.accessToken })
  const gmail = google.gmail({ version: 'v1', auth })

  const res = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  })

  const data = res.data.data
  if (!data) return NextResponse.json({ error: '找不到附件' }, { status: 404 })

  const buffer = Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': String(buffer.length),
    },
  })
}

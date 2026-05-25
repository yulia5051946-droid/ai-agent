import { google } from 'googleapis'
import { Readable } from 'stream'

const ARCHIVE_FOLDER_ID = process.env.DRIVE_ARCHIVE_FOLDER_ID

function getAuth(accessToken: string) {
  const auth = new google.auth.OAuth2()
  auth.setCredentials({ access_token: accessToken })
  return auth
}

async function findOrCreateFolder(drive: ReturnType<typeof google.drive>, name: string, parentId: string): Promise<string> {
  const q = `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
  const res = await drive.files.list({
    q,
    fields: 'files(id)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  })
  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id!
  }
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
    supportsAllDrives: true,
  })
  return created.data.id!
}

export async function uploadContractFileToDrive(
  accessToken: string,
  game: string,
  year: string,
  fileName: string,
  mimeType: string,
  buffer: Buffer
): Promise<{ fileId: string; url: string }> {
  if (!ARCHIVE_FOLDER_ID) throw new Error('未設定 DRIVE_ARCHIVE_FOLDER_ID')

  const auth = getAuth(accessToken)
  const drive = google.drive({ version: 'v3', auth })

  const gameFolderId = await findOrCreateFolder(drive, game, ARCHIVE_FOLDER_ID)
  const yearFolderId = await findOrCreateFolder(drive, year, gameFolderId)

  const stream = new Readable({
    read() {
      this.push(buffer)
      this.push(null)
    },
  })
  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [yearFolderId],
    },
    media: {
      mimeType,
      body: stream,
    },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  })

  const fileId = res.data.id!
  const url = res.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`
  return { fileId, url }
}

export async function deleteFileFromDrive(accessToken: string, driveFileId: string): Promise<void> {
  const auth = getAuth(accessToken)
  const drive = google.drive({ version: 'v3', auth })
  await drive.files.delete({ fileId: driveFileId, supportsAllDrives: true })
}

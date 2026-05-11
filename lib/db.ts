import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import type { ContractCache, ManualLock, InvoiceRecord, ContractStatus } from '@/types'

const DB_PATH = process.env.DB_PATH || './data/contracts.db'

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (db) return db

  const dbDir = path.dirname(DB_PATH)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  initSchema(db)
  runMigrations(db)
  seedTeamMembers(db)
  return db
}

function initSchema(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS contract_cache (
      gr_number TEXT PRIMARY KEY,
      thread_id TEXT,
      game TEXT DEFAULT 'unknown',
      partner TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      applied_at TEXT,
      last_email_at TEXT,
      status TEXT DEFAULT '法務尚未回覆',
      responsible_legal TEXT,
      has_auth_letter INTEGER DEFAULT 0,
      contract_version TEXT,
      finance_confirmed INTEGER DEFAULT 0,
      next_action TEXT,
      summary TEXT,
      updated_at TEXT NOT NULL,
      description TEXT,
      contract_type TEXT,
      exposure_season TEXT,
      our_provisions TEXT,
      their_provisions TEXT,
      sponsor_amount_ntd TEXT,
      cooperation_period TEXT,
      responsible_person TEXT,
      legal_progress_note TEXT,
      game_manual INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS manual_locks (
      gr_number TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      locked_by TEXT NOT NULL,
      locked_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS legal_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gr_number TEXT NOT NULL,
      content TEXT NOT NULL,
      author TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contract_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gr_number TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      uploaded_by TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      drive_file_id TEXT,
      drive_url TEXT
    );

    CREATE TABLE IF NOT EXISTS invoice_records (
      gr_number TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL,
      issued_at TEXT,
      amount TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL
    );
  `)
}

function seedTeamMembers(database: Database.Database) {
  const { c } = database.prepare('SELECT COUNT(*) as c FROM team_members').get() as { c: number }
  if (c > 0) return
  const seeds = [
    { email: 'lindai@garena.com', displayName: 'Laura', role: '法務' },
    { email: 'tsengw@garena.com', displayName: 'Wayne', role: '法務' },
    { email: 'land@garena.com',   displayName: 'Dora',  role: '法務' },
    { email: 'wuc@sea.com',       displayName: 'WuC',   role: '財務' },
    { email: 'linr@sea.com',      displayName: 'LinR',  role: '財務' },
    { email: 'lui@sea.com',       displayName: 'LuI',   role: '財務' },
    { email: 'liny@garena.com',   displayName: 'Yulia', role: 'BD' },
    { email: 'chenla@garena.com', displayName: 'Larry', role: 'BD' },
  ]
  const stmt = database.prepare('INSERT OR IGNORE INTO team_members (email, display_name, role) VALUES (?, ?, ?)')
  for (const s of seeds) stmt.run(s.email, s.displayName, s.role)
}

function runMigrations(database: Database.Database) {
  const contractCacheCols: [string, string][] = [
    ['description', 'TEXT'],
    ['contract_type', 'TEXT'],
    ['exposure_season', 'TEXT'],
    ['our_provisions', 'TEXT'],
    ['their_provisions', 'TEXT'],
    ['sponsor_amount_ntd', 'TEXT'],
    ['cooperation_period', 'TEXT'],
    ['responsible_person', 'TEXT'],
    ['legal_progress_note', 'TEXT'],
    ['game_manual', 'INTEGER DEFAULT 0'],
  ]
  for (const [col, type] of contractCacheCols) {
    try { database.exec(`ALTER TABLE contract_cache ADD COLUMN ${col} ${type}`) } catch { /* already exists */ }
  }

  const contractFilesCols: [string, string][] = [
    ['drive_file_id', 'TEXT'],
    ['drive_url', 'TEXT'],
  ]
  for (const [col, type] of contractFilesCols) {
    try { database.exec(`ALTER TABLE contract_files ADD COLUMN ${col} ${type}`) } catch { /* already exists */ }
  }
}

export function upsertContractCache(data: ContractCache): void {
  const database = getDb()
  database.prepare(`
    INSERT INTO contract_cache (
      gr_number, thread_id, game, game_manual, partner, subject, applied_at, last_email_at,
      status, responsible_legal, has_auth_letter, contract_version,
      finance_confirmed, next_action, summary, updated_at,
      description, contract_type, exposure_season, our_provisions, their_provisions,
      sponsor_amount_ntd, cooperation_period, responsible_person, legal_progress_note
    ) VALUES (
      @grNumber, @threadId, @game, @gameManual, @partner, @subject, @appliedAt, @lastEmailAt,
      @status, @responsibleLegal, @hasAuthorizationLetter, @contractVersion,
      @financeConfirmed, @nextAction, @summary, @updatedAt,
      @description, @contractType, @exposureSeason, @ourProvisions, @theirProvisions,
      @sponsorAmountNTD, @cooperationPeriod, @responsiblePerson, @legalProgressNote
    )
    ON CONFLICT(gr_number) DO UPDATE SET
      thread_id = excluded.thread_id,
      game = CASE WHEN contract_cache.game_manual = 1 THEN contract_cache.game ELSE excluded.game END,
      partner = excluded.partner,
      subject = excluded.subject,
      applied_at = excluded.applied_at,
      last_email_at = excluded.last_email_at,
      status = excluded.status,
      responsible_legal = excluded.responsible_legal,
      has_auth_letter = excluded.has_auth_letter,
      contract_version = excluded.contract_version,
      finance_confirmed = excluded.finance_confirmed,
      next_action = excluded.next_action,
      summary = excluded.summary,
      updated_at = excluded.updated_at,
      description = excluded.description,
      contract_type = excluded.contract_type,
      exposure_season = excluded.exposure_season,
      our_provisions = excluded.our_provisions,
      their_provisions = excluded.their_provisions,
      sponsor_amount_ntd = excluded.sponsor_amount_ntd,
      cooperation_period = excluded.cooperation_period,
      responsible_person = excluded.responsible_person,
      legal_progress_note = excluded.legal_progress_note
  `).run({
    grNumber: data.grNumber,
    threadId: data.threadId,
    game: data.game,
    gameManual: data.gameManual ? 1 : 0,
    partner: data.partner,
    subject: data.subject,
    appliedAt: data.appliedAt,
    lastEmailAt: data.lastEmailAt,
    status: data.status,
    responsibleLegal: data.responsibleLegal,
    hasAuthorizationLetter: data.hasAuthorizationLetter ? 1 : 0,
    contractVersion: data.contractVersion,
    financeConfirmed: data.financeConfirmed ? 1 : 0,
    nextAction: data.nextAction,
    summary: data.summary,
    updatedAt: data.updatedAt,
    description: data.description,
    contractType: data.contractType,
    exposureSeason: data.exposureSeason,
    ourProvisions: data.ourProvisions,
    theirProvisions: data.theirProvisions,
    sponsorAmountNTD: data.sponsorAmountNTD,
    cooperationPeriod: data.cooperationPeriod,
    responsiblePerson: data.responsiblePerson,
    legalProgressNote: data.legalProgressNote,
  })
}

export function getAllContractCache(): ContractCache[] {
  const database = getDb()
  const rows = database.prepare('SELECT * FROM contract_cache ORDER BY last_email_at DESC').all() as Record<string, unknown>[]
  return rows.map(rowToCache)
}

export function getContractCache(grNumber: string): ContractCache | null {
  const database = getDb()
  const row = database.prepare('SELECT * FROM contract_cache WHERE gr_number = ?').get(grNumber) as Record<string, unknown> | undefined
  return row ? rowToCache(row) : null
}

export function setManualLock(lock: ManualLock): void {
  const database = getDb()
  database.prepare(`
    INSERT INTO manual_locks (gr_number, status, locked_by, locked_at)
    VALUES (@grNumber, @status, @lockedBy, @lockedAt)
    ON CONFLICT(gr_number) DO UPDATE SET
      status = excluded.status,
      locked_by = excluded.locked_by,
      locked_at = excluded.locked_at
  `).run(lock)
}

export function setManualGame(grNumber: string, game: string): void {
  const database = getDb()
  database.prepare('UPDATE contract_cache SET game = ?, game_manual = 1 WHERE gr_number = ?').run(game, grNumber)
}

export function removeManualLock(grNumber: string): void {
  const database = getDb()
  database.prepare('DELETE FROM manual_locks WHERE gr_number = ?').run(grNumber)
}

export function getManualLock(grNumber: string): ManualLock | null {
  const database = getDb()
  const row = database.prepare('SELECT * FROM manual_locks WHERE gr_number = ?').get(grNumber) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    grNumber: row.gr_number as string,
    status: row.status as ContractStatus,
    lockedBy: row.locked_by as string,
    lockedAt: row.locked_at as string,
  }
}

export function getAllManualLocks(): Map<string, ManualLock> {
  const database = getDb()
  const rows = database.prepare('SELECT * FROM manual_locks').all() as Record<string, unknown>[]
  const map = new Map<string, ManualLock>()
  for (const row of rows) {
    const lock: ManualLock = {
      grNumber: row.gr_number as string,
      status: row.status as ContractStatus,
      lockedBy: row.locked_by as string,
      lockedAt: row.locked_at as string,
    }
    map.set(lock.grNumber, lock)
  }
  return map
}

export function upsertInvoiceRecord(record: InvoiceRecord): void {
  const database = getDb()
  database.prepare(`
    INSERT INTO invoice_records (gr_number, applied_at, issued_at, amount, updated_at)
    VALUES (@grNumber, @appliedAt, @issuedAt, @amount, @updatedAt)
    ON CONFLICT(gr_number) DO UPDATE SET
      applied_at = excluded.applied_at,
      issued_at = excluded.issued_at,
      amount = excluded.amount,
      updated_at = excluded.updated_at
  `).run(record)
}

export function getAllInvoiceRecords(): InvoiceRecord[] {
  const database = getDb()
  const rows = database.prepare('SELECT * FROM invoice_records').all() as Record<string, unknown>[]
  return rows.map(row => ({
    grNumber: row.gr_number as string,
    appliedAt: row.applied_at as string,
    issuedAt: row.issued_at as string | null,
    amount: row.amount as string | null,
    updatedAt: row.updated_at as string,
  }))
}

export function getInvoiceRecord(grNumber: string): InvoiceRecord | null {
  const database = getDb()
  const row = database.prepare('SELECT * FROM invoice_records WHERE gr_number = ?').get(grNumber) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    grNumber: row.gr_number as string,
    appliedAt: row.applied_at as string,
    issuedAt: row.issued_at as string | null,
    amount: row.amount as string | null,
    updatedAt: row.updated_at as string,
  }
}

function rowToCache(row: Record<string, unknown>): ContractCache {
  return {
    grNumber: row.gr_number as string,
    threadId: row.thread_id as string,
    game: row.game as string,
    gameManual: Boolean(row.game_manual),
    partner: row.partner as string,
    subject: row.subject as string,
    appliedAt: row.applied_at as string | null,
    lastEmailAt: row.last_email_at as string | null,
    status: row.status as ContractStatus,
    responsibleLegal: row.responsible_legal as string | null,
    hasAuthorizationLetter: Boolean(row.has_auth_letter),
    contractVersion: row.contract_version as string | null,
    financeConfirmed: Boolean(row.finance_confirmed),
    nextAction: row.next_action as string | null,
    summary: row.summary as string | null,
    updatedAt: row.updated_at as string,
    description: row.description as string | null,
    contractType: row.contract_type as string | null,
    exposureSeason: row.exposure_season as string | null,
    ourProvisions: row.our_provisions as string | null,
    theirProvisions: row.their_provisions as string | null,
    sponsorAmountNTD: row.sponsor_amount_ntd as string | null,
    cooperationPeriod: row.cooperation_period as string | null,
    responsiblePerson: row.responsible_person as string | null,
    legalProgressNote: row.legal_progress_note as string | null,
  }
}

export interface LegalNote {
  id: number
  grNumber: string
  content: string
  author: string
  createdAt: string
}

export function getLegalNotesMap(): Map<string, LegalNote[]> {
  const database = getDb()
  const rows = database.prepare('SELECT * FROM legal_notes ORDER BY created_at ASC').all() as Record<string, unknown>[]
  const map = new Map<string, LegalNote[]>()
  for (const r of rows) {
    const note: LegalNote = {
      id: r.id as number,
      grNumber: r.gr_number as string,
      content: r.content as string,
      author: r.author as string,
      createdAt: r.created_at as string,
    }
    const existing = map.get(note.grNumber) || []
    existing.push(note)
    map.set(note.grNumber, existing)
  }
  return map
}

export function getLegalNotes(grNumber: string): LegalNote[] {
  const database = getDb()
  const rows = database.prepare('SELECT * FROM legal_notes WHERE gr_number = ? ORDER BY created_at ASC').all(grNumber) as Record<string, unknown>[]
  return rows.map(r => ({
    id: r.id as number,
    grNumber: r.gr_number as string,
    content: r.content as string,
    author: r.author as string,
    createdAt: r.created_at as string,
  }))
}

export function addLegalNote(grNumber: string, content: string, author: string): LegalNote {
  const database = getDb()
  const createdAt = new Date().toISOString()
  const result = database.prepare(
    'INSERT INTO legal_notes (gr_number, content, author, created_at) VALUES (?, ?, ?, ?)'
  ).run(grNumber, content, author, createdAt)
  return { id: result.lastInsertRowid as number, grNumber, content, author, createdAt }
}

export function deleteLegalNote(id: number): void {
  const database = getDb()
  database.prepare('DELETE FROM legal_notes WHERE id = ?').run(id)
}

export interface ContractFile {
  id: number
  grNumber: string
  originalName: string
  storedName: string
  mimeType: string
  size: number
  uploadedBy: string
  uploadedAt: string
  driveFileId?: string
  driveUrl?: string
}

export function getContractFiles(grNumber: string): ContractFile[] {
  const database = getDb()
  const rows = database.prepare('SELECT * FROM contract_files WHERE gr_number = ? ORDER BY uploaded_at DESC').all(grNumber) as Record<string, unknown>[]
  return rows.map(r => ({
    id: r.id as number,
    grNumber: r.gr_number as string,
    originalName: r.original_name as string,
    storedName: r.stored_name as string,
    mimeType: r.mime_type as string,
    size: r.size as number,
    uploadedBy: r.uploaded_by as string,
    uploadedAt: r.uploaded_at as string,
    driveFileId: r.drive_file_id as string | undefined,
    driveUrl: r.drive_url as string | undefined,
  }))
}

export function addContractFile(file: Omit<ContractFile, 'id'>): ContractFile {
  const database = getDb()
  const result = database.prepare(
    'INSERT INTO contract_files (gr_number, original_name, stored_name, mime_type, size, uploaded_by, uploaded_at, drive_file_id, drive_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(file.grNumber, file.originalName, file.storedName, file.mimeType, file.size, file.uploadedBy, file.uploadedAt, file.driveFileId ?? null, file.driveUrl ?? null)
  return { ...file, id: result.lastInsertRowid as number }
}

export function deleteContractFile(id: number): ContractFile | null {
  const database = getDb()
  const row = database.prepare('SELECT * FROM contract_files WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) return null
  database.prepare('DELETE FROM contract_files WHERE id = ?').run(id)
  return {
    id: row.id as number,
    grNumber: row.gr_number as string,
    originalName: row.original_name as string,
    storedName: row.stored_name as string,
    mimeType: row.mime_type as string,
    size: row.size as number,
    uploadedBy: row.uploaded_by as string,
    uploadedAt: row.uploaded_at as string,
    driveFileId: row.drive_file_id as string | undefined,
    driveUrl: row.drive_url as string | undefined,
  }
}

export interface TeamMember {
  id: number
  email: string
  displayName: string
  role: '法務' | '財務' | 'BD' | '系統'
}

export function getAllTeamMembers(): TeamMember[] {
  const database = getDb()
  const rows = database.prepare('SELECT * FROM team_members ORDER BY role, display_name').all() as Record<string, unknown>[]
  return rows.map(r => ({
    id: r.id as number,
    email: r.email as string,
    displayName: r.display_name as string,
    role: r.role as TeamMember['role'],
  }))
}

export function addTeamMember(email: string, displayName: string, role: TeamMember['role']): TeamMember {
  const database = getDb()
  const result = database.prepare('INSERT INTO team_members (email, display_name, role) VALUES (?, ?, ?)').run(email, displayName, role)
  return { id: result.lastInsertRowid as number, email, displayName, role }
}

export function updateTeamMember(id: number, email: string, displayName: string, role: TeamMember['role']): void {
  const database = getDb()
  database.prepare('UPDATE team_members SET email = ?, display_name = ?, role = ? WHERE id = ?').run(email, displayName, role, id)
}

export function deleteTeamMember(id: number): void {
  const database = getDb()
  database.prepare('DELETE FROM team_members WHERE id = ?').run(id)
}

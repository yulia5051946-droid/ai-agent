export type ContractStatus =
  | '法務尚未回覆'
  | '確定法務負責人'
  | '待財務確認'
  | '已提供最終清稿待用印'
  | '合約完成'
  | '合約取消'
  | (string & {}) // 版本動態狀態：法務已提供(第X版)合約 待BD反饋 / 已提供(第X版) 待品牌反饋 / 品牌已反饋(第X版) 待法務反饋

export type GameType = 'AOV' | 'DF' | 'CODM' | 'unknown'

export interface Contract {
  grNumber: string
  game: GameType
  partner: string
  subject: string
  appliedAt: string | null
  lastEmailAt: string | null
  status: ContractStatus
  isManuallyLocked: boolean
  manualStatus?: ContractStatus
  responsibleLegal?: string
  hasAuthorizationLetter?: boolean
  contractVersion?: string
  financeConfirmed?: boolean
  threadId?: string
  nextAction?: string
  daysStale?: number
  summary?: string
  // Extended fields
  description?: string
  contractType?: string
  exposureSeason?: string
  ourProvisions?: string
  theirProvisions?: string
  sponsorAmountNTD?: string
  cooperationPeriod?: string
  responsiblePerson?: string
  legalProgressNote?: string
  notes?: { content: string; author: string; createdAt: string }[]
}

export interface ContractDetail extends Contract {
  timeline: EmailTimelineItem[]
  financeInfo?: FinanceInfo
  sheetData?: SheetContractData
}

export interface EmailAttachmentRef {
  filename: string
  mimeType: string
  size: number
  attachmentId: string
  messageId: string
}

export interface EmailTimelineItem {
  date: string
  from: string
  role: 'BD' | '法務' | '財務' | '系統' | '其他'
  summary: string
  attachments?: EmailAttachmentRef[]
}

export interface FinanceInfo {
  confirmed: boolean
  invoiceAppliedAt?: string
  invoiceIssuedAt?: string
  amount?: string
  paymentTermsConfirmed?: boolean
}

export interface SheetContractData {
  partner: string
  company?: string       // 公司（法定名稱，對應 email subject 的合作對象）
  description: string
  type: string
  cooperationPeriod: string
  exposureSeason: string
  ourProvisions: string
  theirProvisions: string
  sponsorAmountNTD?: string
  sponsorAmountUSD?: string
  responsiblePerson: string
  game: GameType
}

export interface ContractCache {
  grNumber: string
  threadId: string
  game: string
  gameManual: boolean
  partner: string
  subject: string
  appliedAt: string | null
  lastEmailAt: string | null
  status: ContractStatus
  responsibleLegal: string | null
  hasAuthorizationLetter: boolean
  contractVersion: string | null
  financeConfirmed: boolean
  nextAction: string | null
  summary: string | null
  updatedAt: string
  // Extended fields
  description: string | null
  contractType: string | null
  exposureSeason: string | null
  ourProvisions: string | null
  theirProvisions: string | null
  sponsorAmountNTD: string | null
  cooperationPeriod: string | null
  responsiblePerson: string | null
  legalProgressNote: string | null
}

export interface ManualLock {
  grNumber: string
  status: ContractStatus
  lockedBy: string
  lockedAt: string
}

export interface InvoiceRecord {
  grNumber: string
  appliedAt: string
  issuedAt: string | null
  amount: string | null
  updatedAt: string
}

declare module 'next-auth' {
  interface Session {
    accessToken?: string
    refreshToken?: string
    error?: string
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string
    refreshToken?: string
    expiresAt?: number
    error?: string
  }
}

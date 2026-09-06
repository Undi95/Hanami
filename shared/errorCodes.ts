// Erreurs de l'API — le même contrat que la restauration (shared/types.ts) :
// le serveur renvoie un CODE (+ paramètres), jamais une phrase. Les phrases
// vivent dans les DEUX langues côté client (i18n.ts), et la table
// SERVER_ERROR_I18N y garantit qu'aucun code n'est sans phrase (tsc s'en
// charge : un code ajouté ici sans clé i18n casse le typecheck).
//
// Un code inconnu côté client (client plus ancien que le serveur) s'affiche
// tel quel, comme affichaient autrefois les phrases brutes : aucune erreur
// ne disparaît. Les erreurs internes imprévues (ni CodedError) passent aussi
// en message brut, inchangé.

export type ErrorParams = Record<string, string | number>

export const ErrorCodes = {
  // ── Auth & accès ─────────────────────────────────────────────────────────
  authRequired: 'authRequired',
  badPassword: 'badPassword',
  configUnreadable: 'configUnreadable',
  configUnreadableSave: 'configUnreadableSave',
  corsBlocked: 'corsBlocked',
  badOrigin: 'badOrigin',
  accessDenied: 'accessDenied',

  // ── Personnages, chats, fichiers ─────────────────────────────────────────
  characterNotFound: 'characterNotFound', // { id }
  chatNotFound: 'chatNotFound', // { id }
  bgNameExhausted: 'bgNameExhausted',
  invalidId: 'invalidId', // { id }
  chatCorrupt: 'chatCorrupt', // { id }
  invalidFileName: 'invalidFileName',
  memoryIndexProtected: 'memoryIndexProtected',
  invalidBackupName: 'invalidBackupName',
  backupNotFound: 'backupNotFound', // { name }
  fieldNameRequired: 'fieldNameRequired', // { field }

  // ── Validation des requêtes ──────────────────────────────────────────────
  charChatRequired: 'charChatRequired',
  chatPayloadRequired: 'chatPayloadRequired',
  editMessageRequired: 'editMessageRequired',
  variantRequired: 'variantRequired',
  deleteMessageRequired: 'deleteMessageRequired',
  summaryRequired: 'summaryRequired',
  sceneNotesRequired: 'sceneNotesRequired',
  pinRequired: 'pinRequired',
  characterIdRequired: 'characterIdRequired',
  uiBodyExpected: 'uiBodyExpected',
  uiTooLarge: 'uiTooLarge', // { maxKo }
  cardBodyRequired: 'cardBodyRequired',
  noReadableCard: 'noReadableCard',
  imageBodyRequired: 'imageBodyRequired',
  imageFormatUnsupported: 'imageFormatUnsupported',
  notAnImage: 'notAnImage',
  backupPreviewToken: 'backupPreviewToken',

  // ── Flux de chat & compaction ────────────────────────────────────────────
  nothingToRegenerate: 'nothingToRegenerate',
  nothingToContinue: 'nothingToContinue',
  nothingToImpersonate: 'nothingToImpersonate',
  openAlreadyRunning: 'openAlreadyRunning',
  openNotEmpty: 'openNotEmpty',
  compactionAlreadyRunning: 'compactionAlreadyRunning',
  toolBudgetExhausted: 'toolBudgetExhausted',
  variantNotFound: 'variantNotFound',
  variantStale: 'variantStale',
  messageNotFound: 'messageNotFound', // { index }
  messageNoVariants: 'messageNoVariants', // { index }
  noSummaryYet: 'noSummaryYet',
  responseTruncated: 'responseTruncated',
  responseLengthLimit: 'responseLengthLimit',
  nothingToCompact: 'nothingToCompact', // { min }
  windowTooSmallForCompact: 'windowTooSmallForCompact',
  compactNoSummary: 'compactNoSummary', // { finish }

  // ── Images du chat (data URLs du payload) ────────────────────────────────
  imagesNotArray: 'imagesNotArray',
  tooManyImages: 'tooManyImages', // { max }
  imageNotDataUrl: 'imageNotDataUrl',
  imageTooLarge: 'imageTooLarge', // { maxMo }

  // ── Backend LLM & TTS ────────────────────────────────────────────────────
  llmHttpError: 'llmHttpError', // { status, detail }
  llmNoBody: 'llmNoBody',
  llmNoSseChunk: 'llmNoSseChunk',
  llmUnreachable: 'llmUnreachable', // { detail }
  backendProbeFailed: 'backendProbeFailed', // { url, detail }
  ttsDisabled: 'ttsDisabled',
  ttsTextRequired: 'ttsTextRequired',
  ttsNoUrl: 'ttsNoUrl',
  ttsHttpError: 'ttsHttpError', // { status, detail }
  ttsUnreachable: 'ttsUnreachable', // { url, detail }
  ttsProbeUrlInvalid: 'ttsProbeUrlInvalid',
  ttsProbeTimeout: 'ttsProbeTimeout',

  // ── Rangement mémoire (tidy) ─────────────────────────────────────────────
  tidyNeedsTwoFiles: 'tidyNeedsTwoFiles',
  tidyAlreadyRunning: 'tidyAlreadyRunning',
  tidyNoJson: 'tidyNoJson',
  tidyBadJson: 'tidyBadJson',
  tidyNoIndex: 'tidyNoIndex',
  tidyNoFiles: 'tidyNoFiles',
  tidyFileNoName: 'tidyFileNoName', // { n }
  tidyIndexInFiles: 'tidyIndexInFiles',
  tidyDuplicateFile: 'tidyDuplicateFile', // { name }
  tidyEmptyFile: 'tidyEmptyFile', // { name }
  tidyTooBig: 'tidyTooBig', // { k, window }
  tidyNoAnswer: 'tidyNoAnswer',

  // ── Sauvegarde / restauration ────────────────────────────────────────────
  restoreZipExpected: 'restoreZipExpected',
  restoreEntryRefused: 'restoreEntryRefused', // { name }
  restoreEntryControl: 'restoreEntryControl', // { name }
  restoreEntryBackslash: 'restoreEntryBackslash', // { name }
  restoreEntryAbsolute: 'restoreEntryAbsolute', // { name }
  restoreEntryTraversal: 'restoreEntryTraversal', // { name }
  restoreEntryForbidden: 'restoreEntryForbidden', // { name }
  restoreEntryReserved: 'restoreEntryReserved', // { name }
  restoreEntryTrailing: 'restoreEntryTrailing', // { name }
  restoreEntryOutside: 'restoreEntryOutside', // { name }
  restoreManifestCorrupt: 'restoreManifestCorrupt',
  restoreNotHanami: 'restoreNotHanami',
  restoreVersionUnreadable: 'restoreVersionUnreadable',
  restoreVersionTooNew: 'restoreVersionTooNew', // { version, max }
  restoreUnrecognizable: 'restoreUnrecognizable',
  restoreNoData: 'restoreNoData',
  restoreInterrupted: 'restoreInterrupted', // { detail, file }
  restoreStagedIdInvalid: 'restoreStagedIdInvalid',
  restorePreviewExpired: 'restorePreviewExpired',

  // ── Lecture d'archives .zip ──────────────────────────────────────────────
  zipTooShort: 'zipTooShort',
  zipNotZip: 'zipNotZip',
  zipZip64: 'zipZip64',
  zipZip64Entry: 'zipZip64Entry', // { name }
  zipTruncatedIndex: 'zipTruncatedIndex',
  zipTruncatedCd: 'zipTruncatedCd',
  zipTruncatedEntry: 'zipTruncatedEntry', // { name }
  zipTooManyEntries: 'zipTooManyEntries', // { count, max }
  zipCorruptIndex: 'zipCorruptIndex',
  zipCorruptHeader: 'zipCorruptHeader', // { name }
  zipCorruptSizes: 'zipCorruptSizes', // { name }
  zipCorruptSize: 'zipCorruptSize', // { name }
  zipCorruptCrc: 'zipCorruptCrc', // { name }
  zipEncrypted: 'zipEncrypted', // { name }
  zipEntryTooLarge: 'zipEntryTooLarge', // { name, size }
  zipContentTooLarge: 'zipContentTooLarge',
  zipEntryUnreadable: 'zipEntryUnreadable', // { name, detail }
  zipMethodUnsupported: 'zipMethodUnsupported', // { name, method }
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

/**
 * Erreur portant un CODE : les routes (sendJsonError / lib/errors.ts) et
 * l'événement SSE « error » l'exposent au lieu du message. Le message reste
 * le code — utile aux journaux, et repli lisible si le client ne connaît pas
 * le code (il l'affiche tel quel, comportement d'avant).
 */
export class CodedError extends Error {
  readonly code: ErrorCode
  readonly params?: ErrorParams
  constructor(code: ErrorCode, params?: ErrorParams) {
    super(code)
    this.name = 'CodedError'
    this.code = code
    this.params = params
  }
}

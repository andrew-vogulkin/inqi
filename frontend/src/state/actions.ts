import { InqiEvent } from '@inqi/shared';
import { ToastKind } from '../conventions/enums';
import { StoredSession } from '../conventions/session-storage';
import { InquiryDto, LiveReportDto, CreditEntry, QuestionnaireDto, ReportOption, InquiryBoardDto, ThreadMessageDto, AuditEntryDto, WorkflowVersionDto, WorkflowInspectDto, VersionDiffResultDto } from '../api/types';
import { DossierOrigin } from '../conventions/enums';
import { SubtaskRecord } from '../conventions/subtask';
import { SettlementPreview } from '../conventions/run-controls';
import { AuditFilter } from '../conventions/audit';
import { WorkflowPanel } from '../conventions/workflow';
import { ProvenanceDto } from '@inqi/shared';

/** Action discriminators (convention #1). */
export const ActionType = {
  SessionRestored: 'session/restored',
  SignInStarted: 'session/signInStarted',
  SignInFailed: 'session/signInFailed',
  SignedIn: 'session/signedIn',
  SignedOut: 'session/signedOut',

  CreditsLoading: 'credits/loading',
  CreditsLoaded: 'credits/loaded',

  InquiriesLoaded: 'inquiries/loaded',
  InquiryUpserted: 'inquiries/upserted',

  ReportSnapshotReceived: 'report/snapshot',
  ReportCleared: 'report/cleared',
  UnlockStarted: 'report/unlockStarted',
  UnlockFailed: 'report/unlockFailed',

  AdminBoardLoaded: 'adminBoard/loaded',

  QuestionnaireLoaded: 'questionnaire/loaded',
  QuestionnaireLoadFailed: 'questionnaire/loadFailed',
  AnswerChanged: 'questionnaire/answerChanged',
  MultiAnswerToggled: 'questionnaire/multiAnswerToggled',
  ConfirmToggled: 'questionnaire/confirmToggled',
  SubmitStarted: 'questionnaire/submitStarted',
  SubmitSucceeded: 'questionnaire/submitSucceeded',
  SubmitFailed: 'questionnaire/submitFailed',

  SubtaskLoaded: 'subtask/loaded',
  SubtaskChainLoaded: 'subtask/chainLoaded',

  ThreadLoaded: 'thread/loaded',

  RunControlsLoaded: 'runControls/loaded',
  RunPreviewLoading: 'runControls/previewLoading',
  RunPreviewLoaded: 'runControls/previewLoaded',

  AuditFilterSelected: 'audit/filterSelected',
  AuditLoading: 'audit/loading',
  AuditLoaded: 'audit/loaded',
  AuditLoadFailed: 'audit/loadFailed',

  WorkflowsLoaded: 'workflow/loaded',
  WorkflowVersionSelected: 'workflow/versionSelected',
  WorkflowPanelToggled: 'workflow/panelToggled',
  WorkflowInspectLoaded: 'workflow/inspectLoaded',
  WorkflowDiffLoaded: 'workflow/diffLoaded',

  DossierLoaded: 'dossier/loaded',
  DossierLoadFailed: 'dossier/loadFailed',
  DossierChainLoaded: 'dossier/chainLoaded',
  DossierProvenanceLoaded: 'dossier/provenanceLoaded',

  ToastPushed: 'toast/pushed',
  ToastDismissed: 'toast/dismissed',

  /** A realtime event arrived (socket → reducers). Every slice may react. */
  EventReceived: 'realtime/event',
  /** Socket reconnected + replayed by cursor (→ reassuring toast). */
  SocketReconnected: 'realtime/reconnected',
} as const;
export type ActionType = (typeof ActionType)[keyof typeof ActionType];

export interface ToastItem { id: string; kind: ToastKind; message: string }

export type Action =
  | { type: typeof ActionType.SessionRestored; session: StoredSession | null }
  | { type: typeof ActionType.SignInStarted }
  | { type: typeof ActionType.SignInFailed; message: string }
  | { type: typeof ActionType.SignedIn; session: StoredSession }
  | { type: typeof ActionType.SignedOut }
  | { type: typeof ActionType.CreditsLoading }
  | { type: typeof ActionType.CreditsLoaded; balance: number; history: CreditEntry[] }
  | { type: typeof ActionType.InquiriesLoaded; inquiries: InquiryDto[] }
  | { type: typeof ActionType.InquiryUpserted; inquiry: InquiryDto }
  | { type: typeof ActionType.ReportSnapshotReceived; live: LiveReportDto }
  | { type: typeof ActionType.ReportCleared }
  | { type: typeof ActionType.UnlockStarted }
  | { type: typeof ActionType.UnlockFailed; message: string }
  | { type: typeof ActionType.AdminBoardLoaded; board: InquiryBoardDto }
  | { type: typeof ActionType.QuestionnaireLoaded; data: QuestionnaireDto; now: number }
  | { type: typeof ActionType.QuestionnaireLoadFailed; code: string }
  | { type: typeof ActionType.AnswerChanged; id: string; value: string }
  | { type: typeof ActionType.MultiAnswerToggled; id: string; option: string }
  | { type: typeof ActionType.ConfirmToggled; value: boolean }
  | { type: typeof ActionType.SubmitStarted }
  | { type: typeof ActionType.SubmitSucceeded }
  | { type: typeof ActionType.SubmitFailed; message: string; expired?: boolean }
  | { type: typeof ActionType.SubtaskLoaded; record: SubtaskRecord; at: string }
  | { type: typeof ActionType.SubtaskChainLoaded; messages: ThreadMessageDto[] }
  | { type: typeof ActionType.ThreadLoaded; subtaskId: string; messages: ThreadMessageDto[] }
  | { type: typeof ActionType.RunControlsLoaded; inquiryId: string; inquiryState: string }
  | { type: typeof ActionType.RunPreviewLoading }
  | { type: typeof ActionType.RunPreviewLoaded; preview: SettlementPreview }
  | { type: typeof ActionType.AuditFilterSelected; filter: AuditFilter }
  | { type: typeof ActionType.AuditLoading }
  | { type: typeof ActionType.AuditLoaded; entries: AuditEntryDto[] }
  | { type: typeof ActionType.AuditLoadFailed; message: string }
  | { type: typeof ActionType.WorkflowsLoaded; versions: WorkflowVersionDto[] }
  | { type: typeof ActionType.WorkflowVersionSelected; id: string }
  | { type: typeof ActionType.WorkflowPanelToggled; panel: WorkflowPanel }
  | { type: typeof ActionType.WorkflowInspectLoaded; inspect: WorkflowInspectDto }
  | { type: typeof ActionType.WorkflowDiffLoaded; diff: VersionDiffResultDto }
  | { type: typeof ActionType.DossierLoaded; option: ReportOption; rank: number; origin: DossierOrigin }
  | { type: typeof ActionType.DossierLoadFailed; message: string }
  | { type: typeof ActionType.DossierChainLoaded; messages: ThreadMessageDto[] }
  | { type: typeof ActionType.DossierProvenanceLoaded; provenance: ProvenanceDto }
  | { type: typeof ActionType.ToastPushed; toast: ToastItem }
  | { type: typeof ActionType.ToastDismissed; id: string }
  | { type: typeof ActionType.EventReceived; event: InqiEvent }
  | { type: typeof ActionType.SocketReconnected };

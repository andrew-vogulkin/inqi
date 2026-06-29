import { Action } from './actions';
import { SessionState, sessionReducer, hydratedSessionState } from './session.reducer';
import { CreditsState, creditsReducer, initialCreditsState } from './credits.reducer';
import { InquiriesState, inquiriesReducer, initialInquiriesState } from './inquiries.reducer';
import { ReportState, reportReducer, initialReportState } from './report.reducer';
import { AdminBoardState, adminBoardReducer, initialAdminBoardState } from './adminBoard.reducer';
import { QuestionnaireState, questionnaireReducer, initialQuestionnaireState } from './questionnaire.reducer';
import { DossierState, dossierReducer, initialDossierState } from './dossier.reducer';
import { SubtaskState, subtaskReducer, initialSubtaskState } from './subtask.reducer';
import { ThreadState, threadReducer, initialThreadState } from './thread.reducer';
import { RunControlsState, runControlsReducer, initialRunControlsState } from './runControls.reducer';
import { AuditState, auditReducer, initialAuditState } from './audit.reducer';
import { WorkflowState, workflowReducer, initialWorkflowState } from './workflow.reducer';
import { ToastsState, toastsReducer, initialToastsState } from './toasts.reducer';

export interface AppState {
  session: SessionState;
  credits: CreditsState;
  inquiries: InquiriesState;
  report: ReportState;
  adminBoard: AdminBoardState;
  questionnaire: QuestionnaireState;
  dossier: DossierState;
  subtask: SubtaskState;
  thread: ThreadState;
  runControls: RunControlsState;
  audit: AuditState;
  workflow: WorkflowState;
  toasts: ToastsState;
}

/** Combine slice reducers. A single dispatched event fans out to every slice. */
export function rootReducer(state: AppState, action: Action): AppState {
  return {
    session: sessionReducer(state.session, action),
    credits: creditsReducer(state.credits, action),
    inquiries: inquiriesReducer(state.inquiries, action),
    report: reportReducer(state.report, action),
    adminBoard: adminBoardReducer(state.adminBoard, action),
    questionnaire: questionnaireReducer(state.questionnaire, action),
    dossier: dossierReducer(state.dossier, action),
    subtask: subtaskReducer(state.subtask, action),
    thread: threadReducer(state.thread, action),
    runControls: runControlsReducer(state.runControls, action),
    audit: auditReducer(state.audit, action),
    workflow: workflowReducer(state.workflow, action),
    toasts: toastsReducer(state.toasts, action),
  };
}

/** Initial state; the session is hydrated from localStorage so a refresh stays signed in. */
export function initialAppState(): AppState {
  return {
    session: hydratedSessionState(),
    credits: initialCreditsState,
    inquiries: initialInquiriesState,
    report: initialReportState,
    adminBoard: initialAdminBoardState,
    questionnaire: initialQuestionnaireState,
    dossier: initialDossierState,
    subtask: initialSubtaskState,
    thread: initialThreadState,
    runControls: initialRunControlsState,
    audit: initialAuditState,
    workflow: initialWorkflowState,
    toasts: initialToastsState,
  };
}

import { Action } from './actions';
import { SessionState, sessionReducer, hydratedSessionState } from './session.reducer';
import { CreditsState, creditsReducer, initialCreditsState } from './credits.reducer';
import { ReportsState, reportsReducer, initialReportsState } from './reports.reducer';
import { ReportState, reportReducer, initialReportState } from './report.reducer';
import { AdminBoardState, adminBoardReducer, initialAdminBoardState } from './adminBoard.reducer';
import { QuestionnaireState, questionnaireReducer, initialQuestionnaireState } from './questionnaire.reducer';
import { DossierState, dossierReducer, initialDossierState } from './dossier.reducer';
import { InquiryState, inquiryReducer, initialInquiryState } from './inquiry.reducer';
import { ThreadState, threadReducer, initialThreadState } from './thread.reducer';
import { RunControlsState, runControlsReducer, initialRunControlsState } from './runControls.reducer';
import { AuditState, auditReducer, initialAuditState } from './audit.reducer';
import { WorkflowState, workflowReducer, initialWorkflowState } from './workflow.reducer';
import { ToastsState, toastsReducer, initialToastsState } from './toasts.reducer';

export interface AppState {
  session: SessionState;
  credits: CreditsState;
  reports: ReportsState;
  report: ReportState;
  adminBoard: AdminBoardState;
  questionnaire: QuestionnaireState;
  dossier: DossierState;
  inquiry: InquiryState;
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
    reports: reportsReducer(state.reports, action),
    report: reportReducer(state.report, action),
    adminBoard: adminBoardReducer(state.adminBoard, action),
    questionnaire: questionnaireReducer(state.questionnaire, action),
    dossier: dossierReducer(state.dossier, action),
    inquiry: inquiryReducer(state.inquiry, action),
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
    reports: initialReportsState,
    report: initialReportState,
    adminBoard: initialAdminBoardState,
    questionnaire: initialQuestionnaireState,
    dossier: initialDossierState,
    inquiry: initialInquiryState,
    thread: initialThreadState,
    runControls: initialRunControlsState,
    audit: initialAuditState,
    workflow: initialWorkflowState,
    toasts: initialToastsState,
  };
}

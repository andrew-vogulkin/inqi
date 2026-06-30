import { Paths } from '@inqi/shared';
import { request, HttpMethod } from './client';
import {
  SessionDto, InquiryDto, LiveReportDto, ReportDto, CreditsDto,
  QuestionnaireDto, CostSummaryDto, WorkflowVersionDto, InquiryBoardDto, ThreadMessageDto,
  AuditResultDto, WorkflowInspectDto, VersionDiffResultDto, PublishResultDto,
  CustomerDirectoryDto, ProvenanceDto, UnlockResultDto,
} from './types';

/** Auth (HP-10). `idToken` is a Google ID token, or `stub:<email>` in keyless dev. */
export const authApi = {
  signInWithGoogle: ({ idToken }: { idToken: string }) =>
    request<SessionDto>({ method: HttpMethod.Post, path: Paths.authGoogle(), body: { idToken }, auth: false }),
  me: () => request<{ sub: string; email: string; role: string }>({ method: HttpMethod.Get, path: Paths.authMe() }),
};

/** Inquiries (HP-08/10/19). Intake is authenticated + credit-gated; report-live is public. */
export const inquiriesApi = {
  create: ({ rawRequest, budgetMin, budgetMax, deadline }: { rawRequest: string; budgetMin?: number; budgetMax?: number; deadline?: string }) =>
    request<InquiryDto>({ method: HttpMethod.Post, path: Paths.inquiries(), body: { rawRequest, budgetMin, budgetMax, deadline } }),
  list: () => request<InquiryDto[]>({ method: HttpMethod.Get, path: Paths.inquiries() }),
  get: ({ id }: { id: string }) => request<InquiryDto & Record<string, unknown>>({ method: HttpMethod.Get, path: Paths.inquiry(id) }),
  // FE-10 admin board: the nested inquiry detail (epics → subtasks). Same endpoint, typed for the board.
  detail: ({ id }: { id: string }) => request<InquiryBoardDto>({ method: HttpMethod.Get, path: Paths.inquiry(id) }),
  reportLive: ({ id }: { id: string }) => request<LiveReportDto>({ method: HttpMethod.Get, path: Paths.inquiryReportLive(id) }),
  cancel: ({ id, reason }: { id: string; reason?: string }) => request<{ id: string; state: string }>({ method: HttpMethod.Post, path: Paths.inquiryCancel(id), body: { reason } }),
  pause: ({ id, reason }: { id: string; reason?: string }) => request<{ id: string; state: string }>({ method: HttpMethod.Post, path: Paths.inquiryPause(id), body: { reason } }),
  resume: ({ id }: { id: string }) => request<{ id: string; state: string }>({ method: HttpMethod.Post, path: Paths.inquiryResume(id) }),
  // HP-20: customer-safe provenance for one option (owner/admin; redacted, no chain).
  provenance: ({ inquiryId, ref }: { inquiryId: string; ref: string }) => request<ProvenanceDto>({ method: HttpMethod.Get, path: Paths.inquiryProvenance(inquiryId, ref) }),
};

/** Questionnaire by token (HP-24: authenticated + owner-scoped). */
export const questionnaireApi = {
  get: ({ token }: { token: string }) => request<QuestionnaireDto>({ method: HttpMethod.Get, path: Paths.q(token) }),
  submit: ({ token, confirmedSubject, answers }: { token: string; confirmedSubject: boolean; answers: Record<string, string> }) =>
    request<{ ok: boolean }>({ method: HttpMethod.Post, path: Paths.q(token), body: { confirmedSubject, answers } }),
};

/** Report by token (HP-24: authenticated + owner-scoped) + the freemium unlock (HP-21). */
export const reportsApi = {
  getByToken: ({ token }: { token: string }) => request<ReportDto>({ method: HttpMethod.Get, path: Paths.report(token) }),
  // FE-07 freemium unlock: charges 1 credit (HP-21), reveals the full report, emits report.updated.
  unlock: ({ reportId }: { reportId: string }) => request<UnlockResultDto>({ method: HttpMethod.Post, path: Paths.reportUnlock(reportId) }),
};

/** Customer credits (HP-19). */
export const creditsApi = {
  mine: () => request<CreditsDto>({ method: HttpMethod.Get, path: Paths.myCredits() }),
};

/** Admin / operator endpoints (admin-gated server-side; HP-11/12/14/15/19). */
export const adminApi = {
  topUp: ({ customerId, amount, note }: { customerId: string; amount: number; note?: string }) =>
    request<{ customerId: string; balance: number }>({ method: HttpMethod.Post, path: Paths.customerCredits(customerId), body: { amount, note } }),
  // HP-22: customer directory/search for the operator top-up (FE-16).
  searchCustomers: ({ q }: { q: string }) => request<CustomerDirectoryDto[]>({ method: HttpMethod.Get, path: Paths.adminCustomers(), query: { q } }),
  cost: ({ inquiryId }: { inquiryId: string }) => request<CostSummaryDto>({ method: HttpMethod.Get, path: Paths.inquiryCost(inquiryId) }),
  // FE-14 audit trail. `types` is a comma list of AuditEntryType buckets; omitted = All.
  audit: ({ inquiryId, types }: { inquiryId?: string; types?: string } = {}) =>
    request<AuditResultDto>({ method: HttpMethod.Get, path: Paths.audit(), query: { inquiryId, types } }),
  // FE-08/FE-11 (admin only): the full outreach email chain for a subtask (array, oldest-first).
  thread: ({ subtaskId }: { subtaskId: string }) => request<ThreadMessageDto[]>({ method: HttpMethod.Get, path: Paths.commsThread(subtaskId) }),
  // FE-15 workflow versions (HP-12).
  listWorkflows: () => request<WorkflowVersionDto[]>({ method: HttpMethod.Get, path: Paths.workflows() }),
  inspectWorkflow: ({ id }: { id: string }) => request<WorkflowInspectDto>({ method: HttpMethod.Get, path: Paths.workflow(id) }),
  diffWorkflow: ({ id }: { id: string }) => request<VersionDiffResultDto>({ method: HttpMethod.Get, path: Paths.workflowDiff(id) }),
  publishWorkflow: ({ id }: { id: string }) => request<PublishResultDto>({ method: HttpMethod.Post, path: Paths.workflowPublish(id) }),
};

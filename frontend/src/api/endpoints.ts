import { Paths, SearchFocus } from '@inqi/shared';
import { request, HttpMethod } from './client';
import {
  SessionDto, ReportDto, LiveReportDto, ReportSnapshotDto, CreditsDto,
  QuestionnaireDto, CostSummaryDto, WorkflowVersionDto, ReportBoardDto, ThreadMessageDto,
  AuditResultDto, WorkflowInspectDto, VersionDiffResultDto, PublishResultDto,
  CustomerDirectoryDto, ProvenanceDto, UnlockResultDto,
} from './types';

/** Auth — two-step email sign-in: request a code, then verify it (mock transport: 123456). */
export const authApi = {
  startEmail: ({ email }: { email: string }) =>
    request<{ sent: boolean }>({ method: HttpMethod.Post, path: Paths.authEmailStart(), body: { email }, auth: false }),
  verifyEmail: ({ email, code }: { email: string; code: string }) =>
    request<SessionDto>({ method: HttpMethod.Post, path: Paths.authEmailVerify(), body: { email, code }, auth: false }),
  me: () => request<{ sub: string; email: string; role: string }>({ method: HttpMethod.Get, path: Paths.authMe() }),
};

/** Reports (HP-08/10/19). Intake is authenticated + credit-gated; report-live is public. */
export const reportsApi = {
  create: ({ rawRequest, budgetMin, budgetMax, deadline, focus }: { rawRequest: string; budgetMin?: number; budgetMax?: number; deadline?: string; focus?: SearchFocus }) =>
    request<ReportDto>({ method: HttpMethod.Post, path: Paths.reports(), body: { rawRequest, budgetMin, budgetMax, deadline, focus } }),
  list: () => request<ReportDto[]>({ method: HttpMethod.Get, path: Paths.reports() }),
  get: ({ id }: { id: string }) => request<ReportDto & Record<string, unknown>>({ method: HttpMethod.Get, path: Paths.report(id) }),
  // FE-10 admin board: the nested report detail (epics → inquiries). Same endpoint, typed for the board.
  detail: ({ id }: { id: string }) => request<ReportBoardDto>({ method: HttpMethod.Get, path: Paths.report(id) }),
  reportLive: ({ id }: { id: string }) => request<LiveReportDto>({ method: HttpMethod.Get, path: Paths.reportLive(id) }),
  cancel: ({ id, reason }: { id: string; reason?: string }) => request<{ id: string; state: string }>({ method: HttpMethod.Post, path: Paths.reportCancel(id), body: { reason } }),
  pause: ({ id, reason }: { id: string; reason?: string }) => request<{ id: string; state: string }>({ method: HttpMethod.Post, path: Paths.reportPause(id), body: { reason } }),
  resume: ({ id }: { id: string }) => request<{ id: string; state: string }>({ method: HttpMethod.Post, path: Paths.reportResume(id) }),
  // HP-20: customer-safe provenance for one option (owner/admin; redacted, no chain).
  provenance: ({ reportId, ref }: { reportId: string; ref: string }) => request<ProvenanceDto>({ method: HttpMethod.Get, path: Paths.reportProvenance(reportId, ref) }),
};

/** Questionnaire by token (HP-24: authenticated + owner-scoped). */
export const questionnaireApi = {
  get: ({ token }: { token: string }) => request<QuestionnaireDto>({ method: HttpMethod.Get, path: Paths.q(token) }),
  submit: ({ token, confirmedSubject, answers }: { token: string; confirmedSubject: boolean; answers: Record<string, string> }) =>
    request<{ ok: boolean }>({ method: HttpMethod.Post, path: Paths.q(token), body: { confirmedSubject, answers } }),
};

/** Snapshot by token (HP-24: authenticated + owner-scoped) + the freemium unlock (HP-21). */
export const snapshotsApi = {
  getByToken: ({ token }: { token: string }) => request<ReportSnapshotDto>({ method: HttpMethod.Get, path: Paths.snapshot(token) }),
  // FE-07 freemium unlock: charges 1 credit (HP-21), reveals the full report, emits snapshot.updated.
  unlock: ({ snapshotId }: { snapshotId: string }) => request<UnlockResultDto>({ method: HttpMethod.Post, path: Paths.snapshotUnlock(snapshotId) }),
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
  cost: ({ reportId }: { reportId: string }) => request<CostSummaryDto>({ method: HttpMethod.Get, path: Paths.reportCost(reportId) }),
  // FE-14 audit trail. `types` is a comma list of AuditEntryType buckets; omitted = All.
  audit: ({ reportId, types }: { reportId?: string; types?: string } = {}) =>
    request<AuditResultDto>({ method: HttpMethod.Get, path: Paths.audit(), query: { reportId, types } }),
  // FE-08/FE-11 (admin only): the full outreach email chain for an inquiry (array, oldest-first).
  thread: ({ inquiryId }: { inquiryId: string }) => request<ThreadMessageDto[]>({ method: HttpMethod.Get, path: Paths.commsThread(inquiryId) }),
  // FE-15 workflow versions (HP-12).
  listWorkflows: () => request<WorkflowVersionDto[]>({ method: HttpMethod.Get, path: Paths.workflows() }),
  inspectWorkflow: ({ id }: { id: string }) => request<WorkflowInspectDto>({ method: HttpMethod.Get, path: Paths.workflow(id) }),
  diffWorkflow: ({ id }: { id: string }) => request<VersionDiffResultDto>({ method: HttpMethod.Get, path: Paths.workflowDiff(id) }),
  publishWorkflow: ({ id }: { id: string }) => request<PublishResultDto>({ method: HttpMethod.Post, path: Paths.workflowPublish(id) }),
};

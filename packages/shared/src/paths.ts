/**
 * API-03 — the endpoint registry. Typed path builders for every row in the API
 * Surface Map, so there are zero inline path strings anywhere in the app (the FE
 * api layer + the BE controllers describe the same surface). Paths are returned
 * **without** the global prefix; the HTTP client prepends {@link API_PREFIX}.
 */
export const API_PREFIX = '/api';

export const Paths = {
  // health
  health: () => '/health',

  // auth — two-step email sign-in (email → MFA code)
  authEmailStart: () => '/auth/email',
  authEmailVerify: () => '/auth/email/verify',
  authRefresh: () => '/auth/refresh',
  authMe: () => '/auth/me',

  // reports — authenticated intake + dashboards (HP-08/10/19)
  reports: () => '/reports',
  report: (id: string) => `/reports/${id}`,
  reportCost: (id: string) => `/reports/${id}/cost`,
  reportCancel: (id: string) => `/reports/${id}/cancel`,
  reportPause: (id: string) => `/reports/${id}/pause`,
  reportResume: (id: string) => `/reports/${id}/resume`,
  // live-assembled report while the pipeline runs — resolved from the report id
  reportLive: (id: string) => `/reports/${id}/live`,
  // HP-20: customer-safe provenance for one option (owner/admin; redacted)
  reportProvenance: (id: string, ref: string) => `/reports/${id}/options/${ref}/provenance`,

  // credits (HP-19) + admin directory (HP-22)
  myCredits: () => '/me/credits',
  customerCredits: (id: string) => `/admin/customers/${id}/credits`,
  adminCustomers: () => '/admin/customers',

  // credit top-up requests: customer asks (POST), operator lists + approves/rejects
  myCreditRequests: () => '/me/credits/requests',
  adminCreditRequests: () => '/admin/credit-requests',
  adminCreditRequestApprove: (id: string) => `/admin/credit-requests/${id}/approve`,
  adminCreditRequestReject: (id: string) => `/admin/credit-requests/${id}/reject`,

  // admin report search (the operator report picker) — `q`/`limit`/`cursor` are querystring params
  adminReports: () => '/admin/reports',

  // aggregate usage report (HP-15) — admin; `from`/`to` are querystring params
  adminUsage: () => '/admin/usage',

  // admin user directory (HP-25) — `q`/`status`/`limit`/`cursor` are querystring params
  adminUsers: () => '/admin/users',
  adminUserSuspend: (id: string) => `/admin/users/${id}/suspend`,
  adminUserReactivate: (id: string) => `/admin/users/${id}/reactivate`,

  // HP-21: freemium snapshot unlock (owner; charges 1 credit)
  snapshotUnlock: (id: string) => `/snapshots/${id}/unlock`,

  // audit trail (HP-14) — admin; `types`/`reportId` are querystring params
  audit: () => '/audit',

  // workflow versions (HP-12) — admin
  workflows: () => '/workflows',
  workflow: (id: string) => `/workflows/${id}`,
  workflowDiff: (id: string) => `/workflows/${id}/diff`,
  workflowPublish: (id: string) => `/workflows/${id}/publish`,

  // outreach comms (HP-04) — thread is admin; inbound is the webhook
  commsThread: (inquiryId: string) => `/comms/thread/${inquiryId}`,
  commsInbound: () => '/comms/inbound',

  // capability-token surfaces (public deep links)
  q: (token: string) => `/q/${token}`,
  snapshot: (token: string) => `/snapshots/${token}`,
} as const;

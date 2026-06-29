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

  // auth (HP-10)
  authGoogle: () => '/auth/google',
  authMe: () => '/auth/me',

  // inquiries — authenticated intake + dashboards (HP-08/10/19)
  inquiries: () => '/inquiries',
  inquiry: (id: string) => `/inquiries/${id}`,
  inquiryCost: (id: string) => `/inquiries/${id}/cost`,
  inquiryCancel: (id: string) => `/inquiries/${id}/cancel`,
  inquiryPause: (id: string) => `/inquiries/${id}/pause`,
  inquiryResume: (id: string) => `/inquiries/${id}/resume`,
  // public live report (no auth) — resolved from the inquiry id
  inquiryReportLive: (id: string) => `/inquiries/${id}/report-live`,
  // HP-20: customer-safe provenance for one option (owner/admin; redacted)
  inquiryProvenance: (id: string, ref: string) => `/inquiries/${id}/options/${ref}/provenance`,

  // credits (HP-19) + admin directory (HP-22)
  myCredits: () => '/me/credits',
  customerCredits: (id: string) => `/admin/customers/${id}/credits`,
  adminCustomers: () => '/admin/customers',

  // HP-21: freemium report unlock (owner; charges 1 credit)
  reportUnlock: (id: string) => `/reports/${id}/unlock`,

  // audit trail (HP-14) — admin; `types`/`inquiryId` are querystring params
  audit: () => '/audit',

  // workflow versions (HP-12) — admin
  workflows: () => '/workflows',
  workflow: (id: string) => `/workflows/${id}`,
  workflowDiff: (id: string) => `/workflows/${id}/diff`,
  workflowPublish: (id: string) => `/workflows/${id}/publish`,

  // outreach comms (HP-04) — thread is admin; inbound is the webhook
  commsThread: (subtaskId: string) => `/comms/thread/${subtaskId}`,
  commsInbound: () => '/comms/inbound',

  // capability-token surfaces (public deep links)
  q: (token: string) => `/q/${token}`,
  report: (token: string) => `/reports/${token}`,
} as const;

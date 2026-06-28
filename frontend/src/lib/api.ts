import { authHeader } from './auth';

const base = '/api';
const json = { 'content-type': 'application/json' };

export const api = {
  // Public (no auth): capability-token report surfaces stay login-free (viewing isn't gated).
  getQuestionnaire: (token: string) => fetch(`${base}/q/${token}`).then(r => r.json()),
  submitQuestionnaire: (token: string, body: any) => fetch(`${base}/q/${token}`, { method: 'POST', headers: json, body: JSON.stringify(body) }).then(r => r.json()),
  getReport: (token: string) => fetch(`${base}/reports/${token}`).then(r => r.json()),
  reportLive: (id: string) => fetch(`${base}/inquiries/${id}/report-live`).then(r => r.json()), // capability by id (HP-08)

  // Private (HP-10/HP-19): require a Bearer session; ownership-scoped server-side.
  // Intake is now authenticated + credit-gated; the parsed body carries an { error }
  // envelope (e.g. CREDITS_INSUFFICIENT) when the run is blocked.
  createInquiry: (body: { rawRequest: string; geo?: any; budgetMin?: number; budgetMax?: number; deadline?: string }) =>
    fetch(`${base}/inquiries`, { method: 'POST', headers: { ...json, ...authHeader() }, body: JSON.stringify(body) }).then(r => r.json()),
  getInquiry: (id: string) => fetch(`${base}/inquiries/${id}`, { headers: { ...authHeader() } }).then(r => r.json()),
  listInquiries: () => fetch(`${base}/inquiries`, { headers: { ...authHeader() } }).then(r => r.json()),
  cancelInquiry: (id: string) => fetch(`${base}/inquiries/${id}/cancel`, { method: 'POST', headers: { ...json, ...authHeader() }, body: '{}' }).then(r => r.json()),
  pauseInquiry: (id: string) => fetch(`${base}/inquiries/${id}/pause`, { method: 'POST', headers: { ...json, ...authHeader() }, body: '{}' }).then(r => r.json()),
  resumeInquiry: (id: string) => fetch(`${base}/inquiries/${id}/resume`, { method: 'POST', headers: { ...authHeader() } }).then(r => r.json()),

  // HP-12 workflow-version management (admin).
  listWorkflows: () => fetch(`${base}/workflows`, { headers: { ...authHeader() } }).then(r => r.json()),
  publishWorkflow: (id: string) => fetch(`${base}/workflows/${id}/publish`, { method: 'POST', headers: { ...authHeader() } }).then(r => r.json()),

  // HP-14 audit trail (admin).
  getAudit: (inquiryId: string, types?: string) =>
    fetch(`${base}/audit?inquiryId=${encodeURIComponent(inquiryId)}${types ? `&types=${encodeURIComponent(types)}` : ''}`, { headers: { ...authHeader() } }).then(r => r.json()),

  // HP-15 per-inquiry cost summary (admin/operator only).
  getCost: (inquiryId: string) => fetch(`${base}/inquiries/${inquiryId}/cost`, { headers: { ...authHeader() } }).then(r => r.json()),

  // HP-19 credits.
  myCredits: () => fetch(`${base}/me/credits`, { headers: { ...authHeader() } }).then(r => r.json()),
  topUpCredits: (customerId: string, amount: number, note?: string) =>
    fetch(`${base}/admin/customers/${customerId}/credits`, { method: 'POST', headers: { ...json, ...authHeader() }, body: JSON.stringify({ amount, note }) }).then(r => r.json()),
};

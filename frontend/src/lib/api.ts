import { authHeader } from './auth';

const base = '/api';
const json = { 'content-type': 'application/json' };

export const api = {
  // Public (no auth): intake + capability-token surfaces stay login-free.
  createInquiry: (body: any) => fetch(`${base}/inquiries`, { method: 'POST', headers: json, body: JSON.stringify(body) }).then(r => r.json()),
  getQuestionnaire: (token: string) => fetch(`${base}/q/${token}`).then(r => r.json()),
  submitQuestionnaire: (token: string, body: any) => fetch(`${base}/q/${token}`, { method: 'POST', headers: json, body: JSON.stringify(body) }).then(r => r.json()),
  getReport: (token: string) => fetch(`${base}/reports/${token}`).then(r => r.json()),
  reportLive: (id: string) => fetch(`${base}/inquiries/${id}/report-live`).then(r => r.json()), // capability by id (HP-08)

  // Private (HP-10): require a Bearer session; ownership-scoped server-side.
  getInquiry: (id: string) => fetch(`${base}/inquiries/${id}`, { headers: { ...authHeader() } }).then(r => r.json()),
  listInquiries: () => fetch(`${base}/inquiries`, { headers: { ...authHeader() } }).then(r => r.json()),
  cancelInquiry: (id: string) => fetch(`${base}/inquiries/${id}/cancel`, { method: 'POST', headers: { ...authHeader() } }).then(r => r.json()),
};

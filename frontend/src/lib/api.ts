const base = '/api';
export const api = {
  createInquiry: (body: any) => fetch(`${base}/inquiries`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
  getInquiry: (id: string) => fetch(`${base}/inquiries/${id}`).then(r => r.json()),
  listInquiries: () => fetch(`${base}/inquiries`).then(r => r.json()),
  getQuestionnaire: (token: string) => fetch(`${base}/q/${token}`).then(r => r.json()),
  submitQuestionnaire: (token: string, body: any) => fetch(`${base}/q/${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
  getReport: (token: string) => fetch(`${base}/reports/${token}`).then(r => r.json()),
};

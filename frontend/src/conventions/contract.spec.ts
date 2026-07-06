import { describe, it, expect } from 'vitest';
import { Paths, API_PREFIX, ErrorCode, ERROR_MESSAGES, friendlyMessage, statusToErrorCode, Room, RoomKind } from '@inqi/shared';

describe('Paths — endpoint registry (API-03)', () => {
  it('builds parameterized paths correctly', () => {
    expect(Paths.report('i1')).toBe('/reports/i1');
    expect(Paths.reportCost('i1')).toBe('/reports/i1/cost');
    expect(Paths.reportCancel('i1')).toBe('/reports/i1/cancel');
    expect(Paths.q('tok')).toBe('/q/tok');
    expect(Paths.snapshot('tok')).toBe('/snapshots/tok');
    expect(Paths.commsThread('s1')).toBe('/comms/thread/s1');
    expect(Paths.customerCredits('c1')).toBe('/admin/customers/c1/credits');
    expect(Paths.workflowDiff('v2')).toBe('/workflows/v2/diff');
    // HP-20/21/22 endpoints (gaps now closed):
    expect(Paths.reportProvenance('i1', 'Acme')).toBe('/reports/i1/options/Acme/provenance');
    expect(Paths.snapshotUnlock('rep1')).toBe('/snapshots/rep1/unlock');
    expect(Paths.adminCustomers()).toBe('/admin/customers');
  });
  it('builds static paths', () => {
    expect(Paths.reports()).toBe('/reports');
    expect(Paths.myCredits()).toBe('/me/credits');
    expect(Paths.audit()).toBe('/audit');
    expect(API_PREFIX).toBe('/api');
  });
});

describe('ErrorCode → message map (API-03)', () => {
  it('is total over every ErrorCode value', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(ERROR_MESSAGES[code]).toBeTruthy();
    }
  });
  it('maps known codes and falls back for unknown ones', () => {
    expect(friendlyMessage(ErrorCode.CreditsInsufficient)).toMatch(/credits/i);
    expect(friendlyMessage(ErrorCode.AuthForbidden)).toMatch(/operators/i);
    expect(friendlyMessage('SOMETHING_ELSE')).toBe('Something went wrong. Please try again.');
  });
  it('maps HTTP status → code', () => {
    expect(statusToErrorCode({ status: 401 })).toBe(ErrorCode.Unauthorized);
    expect(statusToErrorCode({ status: 403 })).toBe(ErrorCode.AuthForbidden);
    expect(statusToErrorCode({ status: 402 })).toBe(ErrorCode.CreditsInsufficient);
    expect(statusToErrorCode({ status: 404 })).toBe(ErrorCode.NotFound);
    expect(statusToErrorCode({ status: 500 })).toBe(ErrorCode.Internal);
  });
});

describe('Room names (API-03)', () => {
  it('builds the report + admin rooms', () => {
    expect(Room.report('i1')).toBe('report:i1');
    expect(Room.admin).toBe('admin');
    expect(RoomKind.Admin).toBe('admin');
  });
});

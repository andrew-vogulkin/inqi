import { CreditsService } from './credits.service';

/** CreditsService with a stubbed repo + a toggleable freeReportEnabled flag. */
function serviceWith({ freeReportEnabled }: { freeReportEnabled: boolean }) {
  const claimFreeReport = jest.fn(async () => true); // repo would grant if reached
  const repo = { claimFreeReport } as never;
  const config = { freeReportEnabled } as never;
  const svc = new CreditsService(repo, {} as never, {} as never, config, { send: jest.fn() } as never);
  return { svc, claimFreeReport };
}

describe('CreditsService.claimFreeReport — one-off free report toggle', () => {
  it('never touches the repo and returns false when disabled (the freemium on-ramp is off)', async () => {
    const { svc, claimFreeReport } = serviceWith({ freeReportEnabled: false });
    await expect(svc.claimFreeReport({ customerId: 'c1' })).resolves.toBe(false);
    expect(claimFreeReport).not.toHaveBeenCalled(); // no free slot is ever spent
  });

  it('delegates to the repo when explicitly enabled', async () => {
    const { svc, claimFreeReport } = serviceWith({ freeReportEnabled: true });
    await expect(svc.claimFreeReport({ customerId: 'c1' })).resolves.toBe(true);
    expect(claimFreeReport).toHaveBeenCalledWith({ customerId: 'c1', tx: undefined });
  });
});

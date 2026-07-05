import { describe, it, expect } from 'vitest';
import { OutreachOutcome, ProvenanceDepth, ProvenanceDto } from '@inqi/shared';
import { AsyncStatus, DossierOrigin, ResearchDepth } from '../conventions/enums';
import { ActionType } from './actions';
import { dossierReducer, initialDossierState } from './dossier.reducer';
import { ReportOption, ThreadMessageDto } from '../api/types';

const option: ReportOption = {
  subjectProvider: 'Makara Yoga',
  price: 450,
  currency: 'THB',
  qualityScore: 0.8,
  background: { rating: 4.7, reviewsCount: 120, sources: ['https://x.example/1'] },
} as unknown as ReportOption;

const provenance: ProvenanceDto = {
  web: [{ source: 'Official site', url: 'https://x.example/1', snippet: 'classes daily' }],
  feedback: { rating: 4.7, sentiment: 0.8, themes: ['friendly staff'], quotes: [] },
  scoring: { feedbackScore: 0.8, priceScore: 0.6, blendedScore: 0.72, rank: 1 },
  outreach: { persona: 'Ellis', route: 'email', outcome: OutreachOutcome.Replied, chain: [] },
  depth: ProvenanceDepth.WebOutreachFeedback,
  researchPending: false,
};

const loaded = (origin: DossierOrigin) =>
  dossierReducer(initialDossierState, { type: ActionType.DossierLoaded, option, rank: 1, origin });

describe('dossierReducer', () => {
  it('DossierLoaded assembles the VM and resets chain/error', () => {
    const s = loaded(DossierOrigin.Customer);
    expect(s.status).toBe(AsyncStatus.Ready);
    expect(s.dossier?.provider).toBe('Makara Yoga');
    expect(s.dossier?.rank).toBe(1);
    expect(s.chain).toBeNull();
    expect(s.error).toBeNull();
  });

  it('DossierLoadFailed records the error', () => {
    const s = dossierReducer(initialDossierState, { type: ActionType.DossierLoadFailed, message: 'gone' });
    expect(s).toMatchObject({ status: AsyncStatus.Error, error: 'gone' });
  });

  it('the email chain lands only for the ADMIN origin (customer origin ignores it)', () => {
    const messages = [{ id: 'm1', direction: 'outbound', body: 'hi' } as unknown as ThreadMessageDto];
    const admin = dossierReducer(loaded(DossierOrigin.Admin), { type: ActionType.DossierChainLoaded, messages });
    expect(admin.chain).toHaveLength(1);
    const customer = dossierReducer(loaded(DossierOrigin.Customer), { type: ActionType.DossierChainLoaded, messages });
    expect(customer.chain).toBeNull(); // defensive guard — customers never see the chain
  });

  it('DossierProvenanceLoaded overlays the authoritative provenance onto the VM', () => {
    const s = dossierReducer(loaded(DossierOrigin.Customer), { type: ActionType.DossierProvenanceLoaded, provenance });
    expect(s.dossier?.depth).toBe(ResearchDepth.WebOutreachFeedback); // server PascalCase depth translated to the FE enum
    expect(s.dossier?.qualityScore).toBe(0.8);
    expect(s.dossier?.web[0]).toMatchObject({ url: 'https://x.example/1' });
    expect(s.dossier?.researchPending).toBe(false);
  });

  it('provenance without a loaded dossier is a no-op', () => {
    const s = dossierReducer(initialDossierState, { type: ActionType.DossierProvenanceLoaded, provenance });
    expect(s).toBe(initialDossierState);
  });

  it('overlayPending: true from load until the overlay lands (customer) or the chain lands (admin)', () => {
    const customer = loaded(DossierOrigin.Customer);
    expect(customer.overlayPending).toBe(true); // sections hold a spinner, not the provisional fallback
    expect(dossierReducer(customer, { type: ActionType.DossierProvenanceLoaded, provenance }).overlayPending).toBe(false);

    const admin = loaded(DossierOrigin.Admin);
    expect(admin.overlayPending).toBe(true);
    expect(dossierReducer(admin, { type: ActionType.DossierChainLoaded, messages: [] }).overlayPending).toBe(false);
  });

  it('overlayPending clears on DossierProvenanceFailed (fall back to option-derived sections, never spin forever)', () => {
    const s = dossierReducer(loaded(DossierOrigin.Customer), { type: ActionType.DossierProvenanceFailed });
    expect(s.overlayPending).toBe(false);
    expect(s.dossier?.provider).toBe('Makara Yoga'); // VM intact
  });
});

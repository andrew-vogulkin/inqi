import { describe, it, expect } from 'vitest';
import { ResearchDepth, ResearchMethod, OutreachVariant, DossierOrigin } from './enums';
import { ProvenanceDepth } from '@inqi/shared';
import { deriveDepth, deriveMethods, outreachVariant, assembleDossier, depthFromProvenance, groupExchanges, groupByChannel } from './dossier';
import { ReportOption } from '../api/types';
import { dossierReducer, initialDossierState } from '../state/dossier.reducer';
import { ActionType } from '../state/actions';

describe('deriveDepth', () => {
  it('web only / +feedback / +outreach', () => {
    expect(deriveDepth({ hasWeb: true, hasOutreach: false, hasFeedback: false })).toBe(ResearchDepth.WebOnly);
    expect(deriveDepth({ hasWeb: true, hasOutreach: false, hasFeedback: true })).toBe(ResearchDepth.WebFeedback);
    expect(deriveDepth({ hasWeb: true, hasOutreach: true, hasFeedback: true })).toBe(ResearchDepth.WebOutreachFeedback);
  });
});

describe('deriveMethods', () => {
  it('lists only the methods that ran, in order', () => {
    expect(deriveMethods({ hasWeb: true, hasOutreach: false, hasFeedback: true })).toEqual([ResearchMethod.WebSearch, ResearchMethod.FeedbackScan]);
    expect(deriveMethods({ hasWeb: true, hasOutreach: true, hasFeedback: true })).toEqual([ResearchMethod.WebSearch, ResearchMethod.Outreach, ResearchMethod.FeedbackScan]);
  });
});

describe('depthFromProvenance', () => {
  it('translates the server PascalCase depth to the FE snake_case enum', () => {
    expect(depthFromProvenance(ProvenanceDepth.WebOnly)).toBe(ResearchDepth.WebOnly);
    expect(depthFromProvenance(ProvenanceDepth.WebFeedback)).toBe(ResearchDepth.WebFeedback);
    expect(depthFromProvenance(ProvenanceDepth.WebOutreachFeedback)).toBe(ResearchDepth.WebOutreachFeedback);
    expect(depthFromProvenance('garbage' as ProvenanceDepth)).toBe(ResearchDepth.WebOnly);
  });
});

describe('outreachVariant', () => {
  it('selects by contact/reply state', () => {
    expect(outreachVariant({ contacted: true, replied: true })).toBe(OutreachVariant.Replied);
    expect(outreachVariant({ contacted: true, replied: false })).toBe(OutreachVariant.Pending);
    expect(outreachVariant({ contacted: false, replied: false })).toBe(OutreachVariant.NotContacted);
  });
});

describe('assembleDossier', () => {
  const option = (over: Partial<ReportOption> = {}): ReportOption => ({
    subjectProvider: 'Aurora', price: 200, currency: 'EUR', score: 0.8, qualityScore: 0.9, availability: 'in stock', leadTime: '1w',
    background: { rating: 4.7, reviewsCount: 120, eligibility: 'eligible', redFlags: ['late once'], sources: ['ratings.example', 'maps.example'] },
    ...over,
  });

  it('maps a full option to the 4-step VM (web/feedback/outreach/scoring)', () => {
    const vm = assembleDossier({ option: option(), rank: 1 });
    expect(vm.web).toHaveLength(2);
    expect(vm.feedback.rating).toBe(4.7);
    expect(vm.feedback.themes).toEqual(['late once']);
    expect(vm.outreach.variant).toBe(OutreachVariant.Replied);
    expect(vm.depth).toBe(ResearchDepth.WebOutreachFeedback);
    expect(vm.scoring.blendedScore).toBe(0.8);
    expect(vm.scoring.rank).toBe(1);
  });

  it('not-contacted when no availability/leadTime, web-only depth with no feedback', () => {
    const vm = assembleDossier({ option: { subjectProvider: 'X', background: { sources: ['a'] } }, rank: 3 });
    expect(vm.outreach.variant).toBe(OutreachVariant.NotContacted);
    expect(vm.depth).toBe(ResearchDepth.WebOnly);
  });

  it('normalizes object-shaped web sources to renderable strings (no React-child objects)', () => {
    const vm = assembleDossier({ option: option({ background: { sources: [{ source: 'TrustReviews', url: 'https://x/y', snippet: '4.5★' }, 'plain-string-source'] } }), rank: 1 });
    expect(vm.web).toEqual([{ source: 'TrustReviews', url: 'https://x/y', snippet: '4.5★' }, { source: 'plain-string-source' }]);
    // every field must be a primitive (would otherwise crash the dossier on render)
    for (const w of vm.web) { expect(typeof w.source).toBe('string'); if (w.url !== undefined) expect(typeof w.url).toBe('string'); }
  });

  it('pending when contacted (leadTime) but no reply (availability)', () => {
    const vm = assembleDossier({ option: { subjectProvider: 'Y', leadTime: '2w', background: {} }, rank: 2 });
    expect(vm.outreach.variant).toBe(OutreachVariant.Pending);
  });
});

describe('dossierReducer', () => {
  const option: ReportOption = { subjectProvider: 'Aurora', price: 200, currency: 'EUR', qualityScore: 0.9, availability: 'in stock', background: { sources: ['a'], rating: 4.5 } };

  it('assembles on load and keeps the chain null for a customer', () => {
    let s = dossierReducer(initialDossierState, { type: ActionType.DossierLoaded, option, rank: 1, origin: DossierOrigin.Customer });
    expect(s.dossier?.provider).toBe('Aurora');
    // a stray chain dispatch for a customer is ignored (defensive)
    s = dossierReducer(s, { type: ActionType.DossierChainLoaded, messages: [{ id: 'm1', inquiryId: 's', direction: 'outbound', status: 'sent', body: 'hi', createdAt: 'now' }] });
    expect(s.chain).toBeNull();
  });

  it('admin origin accepts the chain', () => {
    let s = dossierReducer(initialDossierState, { type: ActionType.DossierLoaded, option, rank: 1, origin: DossierOrigin.Admin });
    s = dossierReducer(s, { type: ActionType.DossierChainLoaded, messages: [{ id: 'm1', inquiryId: 's', direction: 'outbound', status: 'sent', body: 'hi', createdAt: 'now' }] });
    expect(s.chain).toHaveLength(1);
  });
});

describe('groupExchanges — outbound opens a section, replies attach', () => {
  const m = (direction: string, body: string, channel: string | null = null) => ({ direction, subject: null, body, at: '2026-07-05T10:00:00Z', channel });

  it('two exchanges: [out, in, out, in] → two sections of two', () => {
    const groups = groupExchanges([m('outbound', 'q1'), m('inbound', 'a1'), m('outbound', 'q2'), m('inbound', 'a2')]);
    expect(groups.map((g) => g.map((x) => x.body))).toEqual([['q1', 'a1'], ['q2', 'a2']]);
  });

  it('a leading inbound starts its own section; empty chain → no sections', () => {
    expect(groupExchanges([m('inbound', 'spontaneous')]).length).toBe(1);
    expect(groupExchanges([])).toEqual([]);
  });
});

describe('groupByChannel — one outreach section per provider contact', () => {
  const m = (direction: string, body: string, channel: string | null = null) => ({ direction, subject: null, body, at: '2026-07-05T10:00:00Z', channel });

  it('splits sales vs booking preserving first-seen order', () => {
    const groups = groupByChannel([m('outbound', 's1', 'sales'), m('outbound', 'b1', 'booking'), m('inbound', 's2', 'sales')]);
    expect(groups.map((g) => g.channel)).toEqual(['sales', 'booking']);
    expect(groups[0].msgs.map((x) => x.body)).toEqual(['s1', 's2']);
  });

  it('an unlabeled chain collapses to one group', () => {
    const groups = groupByChannel([m('outbound', 'a'), m('inbound', 'b')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].channel).toBeNull();
  });
});

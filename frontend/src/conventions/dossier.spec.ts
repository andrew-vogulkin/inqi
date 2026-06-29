import { describe, it, expect } from 'vitest';
import { ResearchDepth, ResearchMethod, OutreachVariant, DossierOrigin } from './enums';
import { deriveDepth, deriveMethods, outreachVariant, assembleDossier } from './dossier';
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
    s = dossierReducer(s, { type: ActionType.DossierChainLoaded, messages: [{ id: 'm1', subtaskId: 's', direction: 'outbound', status: 'sent', body: 'hi', createdAt: 'now' }] });
    expect(s.chain).toBeNull();
  });

  it('admin origin accepts the chain', () => {
    let s = dossierReducer(initialDossierState, { type: ActionType.DossierLoaded, option, rank: 1, origin: DossierOrigin.Admin });
    s = dossierReducer(s, { type: ActionType.DossierChainLoaded, messages: [{ id: 'm1', subtaskId: 's', direction: 'outbound', status: 'sent', body: 'hi', createdAt: 'now' }] });
    expect(s.chain).toHaveLength(1);
  });
});

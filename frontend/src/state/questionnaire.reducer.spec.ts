import { describe, it, expect } from 'vitest';
import { AsyncStatus, TokenState } from '../conventions/enums';
import { ApiErrorCode } from '../api/errors';
import { QuestionnaireDto } from '../api/types';
import { ActionType } from './actions';
import {
  questionnaireReducer, initialQuestionnaireState,
  canSubmitQuestionnaire, buildSubmitBody, toggleMulti, multiSelected,
} from './questionnaire.reducer';

const future = '2999-01-01T00:00:00Z';
const past = '2000-01-01T00:00:00Z';
const NOW = 1_700_000_000_000;

const dto = (over: Partial<QuestionnaireDto> = {}): QuestionnaireDto => ({
  id: 'q1', reportId: 'i1', token: 'tok', confirmed: false, expiresAt: future,
  questions: [
    { id: 'confirm', type: 'confirm', prompt: 'Is this right?' },
    { id: 'budget', type: 'text', prompt: 'Budget?' },
    { id: 'days', type: 'multiselect', prompt: 'Days?', options: ['Mon', 'Tue', 'Wed'] },
  ],
  answers: null,
  ...over,
});

describe('multi-select helpers', () => {
  it('toggles options in a comma-joined value', () => {
    expect(toggleMulti({ value: '', option: 'Mon' })).toBe('Mon');
    expect(toggleMulti({ value: 'Mon', option: 'Tue' })).toBe('Mon,Tue');
    expect(toggleMulti({ value: 'Mon,Tue', option: 'Mon' })).toBe('Tue');
    expect(multiSelected('Mon,Tue')).toEqual(['Mon', 'Tue']);
  });
});

describe('questionnaireReducer — load + token states', () => {
  it('open token renders the form and seeds prefilled answers', () => {
    const s = questionnaireReducer(initialQuestionnaireState, { type: ActionType.QuestionnaireLoaded, data: dto({ answers: { budget: '500' } }), now: NOW });
    expect(s).toMatchObject({ status: AsyncStatus.Ready, tokenState: TokenState.Open });
    expect(s.answers.budget).toBe('500');
  });
  it('expired token → Expired', () => {
    const s = questionnaireReducer(initialQuestionnaireState, { type: ActionType.QuestionnaireLoaded, data: dto({ expiresAt: past }), now: NOW });
    expect(s.tokenState).toBe(TokenState.Expired);
  });
  it('already-confirmed → Submitted', () => {
    const s = questionnaireReducer(initialQuestionnaireState, { type: ActionType.QuestionnaireLoaded, data: dto({ confirmed: true }), now: NOW });
    expect(s.tokenState).toBe(TokenState.Submitted);
  });
  it('load failure maps to NotFound / Expired', () => {
    expect(questionnaireReducer(initialQuestionnaireState, { type: ActionType.QuestionnaireLoadFailed, code: ApiErrorCode.QuestionnaireNotFound }).tokenState).toBe(TokenState.NotFound);
    expect(questionnaireReducer(initialQuestionnaireState, { type: ActionType.QuestionnaireLoadFailed, code: ApiErrorCode.QuestionnaireExpired }).tokenState).toBe(TokenState.Expired);
  });
});

describe('questionnaireReducer — form edits + confirm gate', () => {
  const open = () => questionnaireReducer(initialQuestionnaireState, { type: ActionType.QuestionnaireLoaded, data: dto(), now: NOW });

  it('records text answers and toggles multi-select', () => {
    let s = questionnaireReducer(open(), { type: ActionType.AnswerChanged, id: 'budget', value: '800' });
    s = questionnaireReducer(s, { type: ActionType.MultiAnswerToggled, id: 'days', option: 'Mon' });
    s = questionnaireReducer(s, { type: ActionType.MultiAnswerToggled, id: 'days', option: 'Wed' });
    expect(s.answers).toMatchObject({ budget: '800', days: 'Mon,Wed' });
  });

  it('confirm-gate blocks submit until ticked', () => {
    let s = open();
    expect(canSubmitQuestionnaire(s)).toBe(false);
    s = questionnaireReducer(s, { type: ActionType.ConfirmToggled, value: true });
    expect(canSubmitQuestionnaire(s)).toBe(true);
  });

  it('buildSubmitBody drops the confirm question + empty answers', () => {
    let s = questionnaireReducer(open(), { type: ActionType.ConfirmToggled, value: true });
    s = questionnaireReducer(s, { type: ActionType.AnswerChanged, id: 'budget', value: '800' });
    const body = buildSubmitBody(s);
    expect(body).toEqual({ confirmedSubject: true, answers: { budget: '800' } });
  });

  it('submit lifecycle: started → succeeded → Submitted; failed-expired → Expired', () => {
    let s = questionnaireReducer(open(), { type: ActionType.SubmitStarted });
    expect(s.submitting).toBe(true);
    expect(canSubmitQuestionnaire(s)).toBe(false);
    const ok = questionnaireReducer(s, { type: ActionType.SubmitSucceeded });
    expect(ok).toMatchObject({ submitting: false, tokenState: TokenState.Submitted });
    const expired = questionnaireReducer(s, { type: ActionType.SubmitFailed, message: 'gone', expired: true });
    expect(expired.tokenState).toBe(TokenState.Expired);
  });
});

import { AsyncStatus, TokenState, FieldType, fieldTypeFromWire } from '../conventions/enums';
import { ApiErrorCode } from '../api/errors';
import { QuestionnaireDto } from '../api/types';
import { Action, ActionType } from './actions';

export interface QuestionnaireState {
  status: AsyncStatus;
  tokenState: TokenState;
  data: QuestionnaireDto | null;
  answers: Record<string, string>; // per-question values (multi-select = comma-joined)
  confirmed: boolean;
  submitting: boolean;
  error: string | null;
}

export const initialQuestionnaireState: QuestionnaireState = {
  status: AsyncStatus.Idle,
  tokenState: TokenState.Loading,
  data: null,
  answers: {},
  confirmed: false,
  submitting: false,
  error: null,
};

// ---- pure helpers (unit-tested) -------------------------------------------

/** Multi-select value (comma-joined) → array. */
export function multiSelected(value: string | undefined): string[] {
  return (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** Toggle an option within a comma-joined multi-select value. */
export function toggleMulti({ value, option }: { value: string | undefined; option: string }): string {
  const set = new Set(multiSelected(value));
  if (set.has(option)) set.delete(option); else set.add(option);
  return [...set].join(',');
}

/** The confirm-gate: submit only once the box is ticked (and not mid-submit). */
export function canSubmitQuestionnaire(state: QuestionnaireState): boolean {
  return state.tokenState === TokenState.Open && state.confirmed && !state.submitting;
}

/** Build the POST body — confirm flag + answers for the non-confirm questions. */
export function buildSubmitBody(state: QuestionnaireState): { confirmedSubject: boolean; answers: Record<string, string> } {
  const confirmIds = new Set((state.data?.questions ?? []).filter((q) => fieldTypeFromWire(q.type) === FieldType.Confirm).map((q) => q.id));
  const answers: Record<string, string> = {};
  for (const [k, v] of Object.entries(state.answers)) if (!confirmIds.has(k) && v !== '') answers[k] = v;
  return { confirmedSubject: state.confirmed, answers };
}

function tokenStateFor({ data, now }: { data: QuestionnaireDto; now: number }): TokenState {
  if (data.confirmed) return TokenState.Submitted;
  if (new Date(data.expiresAt).getTime() < now) return TokenState.Expired;
  return TokenState.Open;
}

// ---- reducer ---------------------------------------------------------------

/** Questionnaire form slice (FE-05). All form logic lives here; the component dispatches. */
export function questionnaireReducer(state: QuestionnaireState, action: Action): QuestionnaireState {
  switch (action.type) {
    case ActionType.QuestionnaireLoaded:
      return {
        ...state,
        status: AsyncStatus.Ready,
        data: action.data,
        tokenState: tokenStateFor({ data: action.data, now: action.now }),
        answers: { ...(action.data.answers ?? {}) },
        confirmed: action.data.confirmed,
        error: null,
      };
    case ActionType.QuestionnaireLoadFailed:
      return {
        ...state,
        status: AsyncStatus.Error,
        tokenState: action.code === ApiErrorCode.QuestionnaireExpired ? TokenState.Expired : TokenState.NotFound,
      };
    case ActionType.AnswerChanged:
      return { ...state, answers: { ...state.answers, [action.id]: action.value } };
    case ActionType.MultiAnswerToggled:
      return { ...state, answers: { ...state.answers, [action.id]: toggleMulti({ value: state.answers[action.id], option: action.option }) } };
    case ActionType.ConfirmToggled:
      return { ...state, confirmed: action.value };
    case ActionType.SubmitStarted:
      return { ...state, submitting: true, error: null };
    case ActionType.SubmitSucceeded:
      return { ...state, submitting: false, tokenState: TokenState.Submitted };
    case ActionType.SubmitFailed:
      return { ...state, submitting: false, error: action.message, tokenState: action.expired ? TokenState.Expired : state.tokenState };
    default:
      return state;
  }
}

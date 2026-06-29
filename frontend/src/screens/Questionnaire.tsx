import { useEffect, useState } from 'react';
import { AsyncStatus, TokenState, FieldType, fieldTypeFromWire, QuestionnaireField } from '../conventions/enums';
import { Route, navigate, hrefFor } from '../conventions/routes';
import { color, space, fontSize, fontWeight } from '../theme/tokens';
import { questionnaireApi, inquiriesApi, ApiError, ApiErrorCode } from '../api';
import { QuestionnaireQuestion } from '../api/types';
import { Button, Card, Input, Textarea, Chip, Pill, EmptyState, ErrorState, Skeleton } from '../ui';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';
import { canSubmitQuestionnaire, buildSubmitBody, multiSelected } from '../state/questionnaire.reducer';

/** FE-05 — login-free /q/:token: pre-research card + data-driven confirm form. */
export function Questionnaire({ token }: { token: string }) {
  const dispatch = useAppDispatch();
  const q = useSelector((s) => s.questionnaire);
  const [request, setRequest] = useState<string | null>(null);

  // Load the questionnaire via the api layer; reducer derives the token state.
  useEffect(() => {
    questionnaireApi.get({ token })
      .then((data) => {
        dispatch({ type: ActionType.QuestionnaireLoaded, data, now: Date.now() });
        // Pre-research enrichment: the request text (public live read).
        inquiriesApi.reportLive({ id: data.inquiryId }).then((live) => setRequest(live.rawRequest)).catch(() => undefined);
      })
      .catch((e) => dispatch({ type: ActionType.QuestionnaireLoadFailed, code: e instanceof ApiError ? e.code : ApiErrorCode.QuestionnaireNotFound }));
  }, [token, dispatch]);

  async function submit() {
    const body = buildSubmitBody(q);
    dispatch({ type: ActionType.SubmitStarted });
    try {
      await questionnaireApi.submit({ token, confirmedSubject: body.confirmedSubject, answers: body.answers });
      dispatch({ type: ActionType.SubmitSucceeded });
      if (q.data) navigate({ route: Route.Inquiry, params: { id: q.data.inquiryId } });
    } catch (e) {
      const expired = e instanceof ApiError && e.code === ApiErrorCode.QuestionnaireExpired;
      dispatch({ type: ActionType.SubmitFailed, message: e instanceof ApiError ? e.message : 'Could not submit. Please try again.', expired });
    }
  }

  if (q.status === AsyncStatus.Idle || q.tokenState === TokenState.Loading) {
    return <Card><div style={{ display: 'grid', gap: space[2] }}><Skeleton width="40%" /><Skeleton /><Skeleton width="70%" /></div></Card>;
  }
  if (q.tokenState === TokenState.NotFound || q.tokenState === TokenState.Expired) {
    return (
      <ErrorState
        title={q.tokenState === TokenState.Expired ? 'This link has expired' : "This link isn't valid"}
        message="Sign in to see your inquiries, or start a new one."
        action={<a href={hrefFor({ route: Route.SignIn })}><Button>Go to sign in</Button></a>}
      />
    );
  }
  if (q.tokenState === TokenState.Submitted) {
    return (
      <Card>
        <h2 style={{ fontSize: fontSize.h2, marginBottom: space[2] }}>You're all set 🎉</h2>
        <p style={{ color: color.muted, marginBottom: space[4] }}>Thanks — your request is confirmed. inqi is researching and reaching out now.</p>
        {q.data && <a href={hrefFor({ route: Route.Inquiry, params: { id: q.data.inquiryId } })}><Button>Open live report</Button></a>}
      </Card>
    );
  }

  // Open: enrichment card + data-driven form.
  const questions = q.data?.questions ?? [];
  const confirmQuestion = questions.find((x) => fieldTypeFromWire(x.type) === FieldType.Confirm);
  const fields = questions.filter((x) => fieldTypeFromWire(x.type) !== FieldType.Confirm);

  return (
    <div style={{ display: 'grid', gap: space[4] }}>
      <Card sunken>
        <div style={{ fontSize: fontSize.sm, color: color.muted, marginBottom: space[1] }}>Here's what we understood</div>
        {request === null ? <Skeleton width="80%" /> : <div style={{ fontSize: fontSize.md, fontWeight: fontWeight.medium }}>{request}</div>}
        <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap', marginTop: space[3] }}>
          {fields.map((f) => <Pill key={f.id}>{f.prompt}</Pill>)}
        </div>
        <div style={{ fontSize: fontSize.xs, color: color.subtle, marginTop: space[3] }}>No credit charged yet — confirming starts the research.</div>
      </Card>

      <Card>
        <h2 style={{ fontSize: fontSize.h3, marginBottom: space[3] }}>A few details to get it right</h2>
        <div style={{ display: 'grid', gap: space[4] }}>
          {fields.map((f) => <Field key={f.id} field={f} value={q.answers[f.id] ?? ''} />)}
          <FieldShell label="Anything else?">
            <Textarea
              value={q.answers[QuestionnaireField.Notes] ?? ''}
              onChange={(v) => dispatch({ type: ActionType.AnswerChanged, id: QuestionnaireField.Notes, value: v })}
              placeholder="Optional — anything that would help us find the right options"
            />
          </FieldShell>
        </div>

        <div style={{ borderTop: `1px solid ${color.line}`, marginTop: space[4], paddingTop: space[4] }}>
          <label style={{ display: 'flex', gap: space[2], alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={q.confirmed} onChange={(e) => dispatch({ type: ActionType.ConfirmToggled, value: e.target.checked })} data-testid="confirm-gate" />
            <span style={{ fontSize: fontSize.base }}>{confirmQuestion?.prompt ?? 'Yes, this is what I’m looking for.'}</span>
          </label>
          {q.error && <p style={{ color: color.danger, fontSize: fontSize.sm }}>{q.error}</p>}
          <div style={{ marginTop: space[3] }}>
            <Button onClick={submit} disabled={!canSubmitQuestionnaire(q)}>
              {q.submitting ? 'Starting…' : 'Confirm & start research'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function FieldShell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: color.inkSoft, marginBottom: space[1] }}>{label}</div>
      {children}
    </div>
  );
}

/** Data-driven field: the field-type enum picks the control. */
function Field({ field, value }: { field: QuestionnaireQuestion; value: string }) {
  const dispatch = useAppDispatch();
  const type = fieldTypeFromWire(field.type);
  const options = field.options ?? [];

  if (type === FieldType.Select) {
    return (
      <FieldShell label={field.prompt}>
        <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>
          {options.map((o) => <Chip key={o} label={o} selected={value === o} onClick={() => dispatch({ type: ActionType.AnswerChanged, id: field.id, value: o })} />)}
        </div>
      </FieldShell>
    );
  }
  if (type === FieldType.MultiSelect) {
    const chosen = multiSelected(value);
    return (
      <FieldShell label={field.prompt}>
        <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>
          {options.map((o) => <Chip key={o} label={o} selected={chosen.includes(o)} onClick={() => dispatch({ type: ActionType.MultiAnswerToggled, id: field.id, option: o })} />)}
        </div>
      </FieldShell>
    );
  }
  return (
    <FieldShell label={field.prompt}>
      <Input value={value} onChange={(v) => dispatch({ type: ActionType.AnswerChanged, id: field.id, value: v })} placeholder="Your answer" />
    </FieldShell>
  );
}

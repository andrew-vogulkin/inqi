import { useEffect } from 'react';
import { AsyncStatus, ButtonVariant } from '../conventions/enums';
import { Route, navigate, hrefFor } from '../conventions/routes';
import { stageForInquiryState, stageIndex, isFailedState, isLiveStage, statusBadge, routeForStage } from '../conventions/stages';
import { color, space, fontSize, fontWeight } from '../theme/tokens';
import { inquiriesApi, creditsApi } from '../api';
import { InquiryDto } from '../api/types';
import { Button, Card, StatusBadge, StatusDot, StagePipeline, MonoRef, EmptyState, Skeleton } from '../ui';
import { toneForInquiryState } from '../ui/tone';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';
import { useRealtimeInquiries } from '../realtime/socket';

/** FE-03 — the authenticated home: own inquiries (6-stage pipeline) + credit balance. */
export function Dashboard() {
  const dispatch = useAppDispatch();
  const inquiries = useSelector((s) => s.inquiries);
  const credits = useSelector((s) => s.credits);
  const order = inquiries.order;

  // Load list + balance via the api layer; reducers own the state.
  useEffect(() => {
    inquiriesApi.list().then((rows) => dispatch({ type: ActionType.InquiriesLoaded, inquiries: rows })).catch(() => undefined);
    creditsApi.mine().then((c) => dispatch({ type: ActionType.CreditsLoaded, balance: c.balance, history: c.history })).catch(() => undefined);
  }, [dispatch]);

  // Live: stream every owned inquiry room → inquiry.transitioned updates rows.
  useRealtimeInquiries({ inquiryIds: order });

  return (
    <div>
      <header style={{ display: 'flex', alignItems: 'center', gap: space[2], marginBottom: space[4] }}>
        <h1 style={{ fontSize: fontSize.h2, flex: 1 }}>Your inquiries</h1>
        <a href={hrefFor({ route: Route.Credits })}>
          <Button variant={ButtonVariant.Secondary}>
            {credits.status === AsyncStatus.Ready ? `${credits.balance} credits` : <Skeleton width={56} />}
          </Button>
        </a>
        <a href={hrefFor({ route: Route.NewInquiry })}><Button>New inquiry</Button></a>
      </header>

      {inquiries.status === AsyncStatus.Idle && <Skeletons />}
      {inquiries.status === AsyncStatus.Ready && order.length === 0 && (
        <EmptyState
          title="No inquiries yet"
          hint="Start your first research run — the first report is free."
          action={<a href={hrefFor({ route: Route.NewInquiry })}><Button>New inquiry</Button></a>}
        />
      )}

      <div style={{ display: 'grid', gap: space[3] }}>
        {order.map((id) => <InquiryRow key={id} inquiry={inquiries.byId[id]} />)}
      </div>
    </div>
  );
}

function InquiryRow({ inquiry }: { inquiry: InquiryDto }) {
  const stage = stageForInquiryState(inquiry.state);
  const failed = isFailedState(inquiry.state);
  const badge = statusBadge(inquiry.state);
  const go = () => { const m = routeForStage({ stage, inquiryId: inquiry.id }); navigate({ route: m.route, params: m.params }); };

  return (
    <Card style={{ cursor: 'pointer' }}>
      <div role="button" data-testid="inquiry-row" onClick={go} style={{ display: 'grid', gap: space[3] }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
          {isLiveStage(stage) && !failed && <StatusDot tone={toneForInquiryState(inquiry.state)} pulse />}
          <span style={{ fontSize: fontSize.md, fontWeight: fontWeight.medium, flex: 1 }}>{inquiry.rawRequest.slice(0, 80)}</span>
          <span data-testid="inquiry-status"><StatusBadge label={badge.label} tone={badge.tone} /></span>
        </div>
        <StagePipeline currentIndex={stageIndex(stage)} failed={failed} />
        <div style={{ fontSize: fontSize.xs, color: color.muted }}>
          <MonoRef muted>#{inquiry.id.slice(0, 8)}</MonoRef> · started {new Date(inquiry.createdAt).toLocaleDateString()}
        </div>
      </div>
    </Card>
  );
}

function Skeletons() {
  return (
    <div style={{ display: 'grid', gap: space[3] }}>
      {[0, 1, 2].map((i) => (
        <Card key={i}><div style={{ display: 'grid', gap: space[2] }}><Skeleton width="50%" /><Skeleton /><Skeleton width="30%" /></div></Card>
      ))}
    </div>
  );
}

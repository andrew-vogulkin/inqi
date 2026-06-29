import { useEffect, useState } from 'react';
import { AsyncStatus, ButtonVariant, ToastKind } from '../conventions/enums';
import {
  RunAction, RUN_ACTION_LABEL, DEFAULT_REPORT_COST_CREDITS, SettlementPreview,
  runActionEnabled, runStateTone, countInFlightJobs,
} from '../conventions/run-controls';
import { color, space, fontSize, fontWeight } from '../theme/tokens';
import { inquiriesApi, adminApi } from '../api';
import { Card, Button, StatusBadge, MonoRef, ConfirmDialog } from '../ui';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';
import { AdminBoardState } from '../state/adminBoard.reducer';

/**
 * FE-12 — operator run controls (pause / resume / cancel & refund). Enablement +
 * apply logic live in the reducer/state machine; this is a pure view. Each action
 * is confirm-gated with a settlement preview from `/cost`; cancel refunds the
 * reserved credit, reflected live + as a toast. Opening or aborting a confirm
 * makes **no** network call.
 */
export function RunControlsPanel({ board }: { board: AdminBoardState }) {
  const dispatch = useAppDispatch();
  const run = useSelector((s) => s.runControls);
  const [confirm, setConfirm] = useState<RunAction | null>(null);
  const [busy, setBusy] = useState(false);
  const inquiryId = board.inquiryId;

  // Seed the state machine from the board's current state (once per inquiry).
  useEffect(() => {
    if (inquiryId) dispatch({ type: ActionType.RunControlsLoaded, inquiryId, inquiryState: board.inquiryState });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inquiryId]);

  // Settlement preview: cost-so-far from /cost; the credit refunded is the reservation.
  useEffect(() => {
    if (!inquiryId) return;
    dispatch({ type: ActionType.RunPreviewLoading });
    adminApi.cost({ inquiryId })
      .then((cost) => dispatch({ type: ActionType.RunPreviewLoaded, preview: { costSoFarUsd: cost.grandTotalUsd, currency: cost.currency, creditOnCancel: DEFAULT_REPORT_COST_CREDITS } }))
      .catch(() => undefined);
  }, [inquiryId, dispatch]);

  // Reflect a cancel refund live (credits.refunded event → success toast).
  useEffect(() => {
    if (run.refundedCredits != null && inquiryId) {
      dispatch({ type: ActionType.ToastPushed, toast: { id: `refund-${inquiryId}-${run.refundedCredits}`, kind: ToastKind.Success, message: `Refunded ${run.refundedCredits} credit${run.refundedCredits === 1 ? '' : 's'} on cancel.` } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.refundedCredits]);

  if (!inquiryId) return null;

  const inFlightJobs = countInFlightJobs({ statuses: Object.values(board.subtasksById).map((s) => s.status) });

  async function apply(action: RunAction) {
    if (!inquiryId) return;
    setBusy(true);
    try {
      const resp = action === RunAction.Pause ? await inquiriesApi.pause({ id: inquiryId })
        : action === RunAction.Resume ? await inquiriesApi.resume({ id: inquiryId })
          : await inquiriesApi.cancel({ id: inquiryId });
      dispatch({ type: ActionType.RunControlsLoaded, inquiryId, inquiryState: resp.state });
    } catch {
      dispatch({ type: ActionType.ToastPushed, toast: { id: `run-err-${action}-${inquiryId}`, kind: ToastKind.Danger, message: `Couldn't ${action} the run — try again.` } });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const actionBtn = (action: RunAction, variant: ButtonVariant) => (
    <Button
      variant={variant}
      disabled={busy || !runActionEnabled({ runState: run.runState, action })}
      onClick={() => setConfirm(action)}
      testId={`run-${action}`}
    >
      {RUN_ACTION_LABEL[action]}
    </Button>
  );

  return (
    <Card testId="run-controls">
      <div style={{ display: 'flex', alignItems: 'center', gap: space[2], marginBottom: space[3] }}>
        <h3 style={{ fontSize: fontSize.h3, flex: 1 }}>Run controls</h3>
        <span data-testid="run-state"><StatusBadge label={run.runState} tone={runStateTone(run.runState)} /></span>
      </div>
      <div style={{ display: 'flex', gap: space[2] }}>
        {actionBtn(RunAction.Pause, ButtonVariant.Secondary)}
        {actionBtn(RunAction.Resume, ButtonVariant.Primary)}
        {actionBtn(RunAction.Cancel, ButtonVariant.Danger)}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? RUN_ACTION_LABEL[confirm] : ''}
        message={confirmMessage(confirm)}
        confirmLabel={confirm ? RUN_ACTION_LABEL[confirm] : 'Confirm'}
        danger={confirm === RunAction.Cancel}
        confirmTestId="run-confirm-yes"
        cancelTestId="run-confirm-no"
        onConfirm={() => confirm && apply(confirm)}
        onCancel={() => setConfirm(null)}
      >
        {confirm === RunAction.Cancel && (
          <SettlementView preview={run.preview} previewStatus={run.previewStatus} inFlightJobs={inFlightJobs} />
        )}
      </ConfirmDialog>
    </Card>
  );
}

function confirmMessage(action: RunAction | null): string {
  switch (action) {
    case RunAction.Pause: return 'Pause holds the run (ON_HOLD) — no new outreach waves release. No credits are settled.';
    case RunAction.Resume: return 'Resume continues the run from where it left off.';
    case RunAction.Cancel: return 'Cancel ends the run now and refunds the reserved credit. In-flight outreach is abandoned.';
    default: return '';
  }
}

/** Settlement preview shown in the cancel confirm (in-flight jobs, refund, cost-so-far). */
function SettlementView({ preview, previewStatus, inFlightJobs }: { preview: SettlementPreview | null; previewStatus: AsyncStatus; inFlightJobs: number }) {
  return (
    <div data-testid="settlement-preview" style={{ display: 'grid', gap: space[1], padding: space[3], background: color.surfaceSunken, borderRadius: 8, fontSize: fontSize.sm }}>
      <PreviewRow label="In-flight jobs" testid="preview-inflight" value={String(inFlightJobs)} />
      <PreviewRow label="Credit refunded" testid="preview-credit" value={`+${preview?.creditOnCancel ?? DEFAULT_REPORT_COST_CREDITS}`} tone={color.brand} />
      <PreviewRow label="Cost so far" testid="preview-cost" value={previewStatus === AsyncStatus.Ready && preview ? `${preview.currency} ${preview.costSoFarUsd.toFixed(4)}` : '…'} />
    </div>
  );
}

function PreviewRow({ label, value, testid, tone }: { label: string; value: string; testid: string; tone?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: space[3] }}>
      <span style={{ color: color.muted }}>{label}</span>
      <MonoRef><span data-testid={testid} style={{ color: tone ?? color.ink, fontWeight: fontWeight.medium }}>{value}</span></MonoRef>
    </div>
  );
}

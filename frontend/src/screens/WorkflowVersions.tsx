import { useEffect, useState } from 'react';
import { WorkflowStatus } from '@inqi/shared';
import { AsyncStatus, ButtonVariant, StatusTone, ToastKind } from '../conventions/enums';
import {
  WorkflowPanel, DiffKind, DIFF_KIND_TONE, buildTree, diffViewModel, versionStatusTone,
} from '../conventions/workflow';
import { color, space, fontSize, fontWeight, radius } from '../theme/tokens';
import { adminApi } from '../api';
import { GraphStateDto, GraphTransitionDto } from '../api/types';
import { Card, Button, StatusBadge, MonoRef, Pill, EmptyState, Skeleton, ConfirmDialog } from '../ui';
import { toneColors } from '../ui/tone';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';
import { useRealtime } from '../realtime/socket';

/** FE-15 — workflow versions: type→version tree, state-machine diagram ↔ diff, publish. */
export function WorkflowVersions() {
  const dispatch = useAppDispatch();
  const wf = useSelector((s) => s.workflow);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [busy, setBusy] = useState(false);

  useRealtime({ kind: 'admin' }); // workflow.published → live active/archived swap

  const refreshList = () => adminApi.listWorkflows().then((versions) => dispatch({ type: ActionType.WorkflowsLoaded, versions })).catch(() => undefined);

  useEffect(() => { refreshList(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Inspect the selected version (for the diagram).
  useEffect(() => {
    if (!wf.selectedId) return;
    adminApi.inspectWorkflow({ id: wf.selectedId }).then((inspect) => dispatch({ type: ActionType.WorkflowInspectLoaded, inspect })).catch(() => undefined);
  }, [wf.selectedId, dispatch]);

  // Lazily load the diff when the diff panel is open for the selected version.
  useEffect(() => {
    if (wf.panel !== WorkflowPanel.Diff || !wf.selectedId) return;
    if (wf.diff && wf.diff.to.id === wf.selectedId) return;
    adminApi.diffWorkflow({ id: wf.selectedId }).then((diff) => dispatch({ type: ActionType.WorkflowDiffLoaded, diff })).catch(() => undefined);
  }, [wf.panel, wf.selectedId, wf.diff, dispatch]);

  if (wf.status !== AsyncStatus.Ready) return <Card><Skeleton width="50%" /></Card>;

  const tree = buildTree({ versions: wf.versions });
  const selected = wf.versions.find((v) => v.id === wf.selectedId) ?? null;

  async function publish() {
    if (!selected) return;
    setBusy(true);
    try {
      await adminApi.publishWorkflow({ id: selected.id });
      await refreshList(); // backend doesn't emit workflow.published yet — refresh from the list
      dispatch({ type: ActionType.ToastPushed, toast: { id: `wf-pub-${selected.id}`, kind: ToastKind.Success, message: `Published v${selected.version}.` } });
    } catch {
      dispatch({ type: ActionType.ToastPushed, toast: { id: `wf-pub-err-${selected.id}`, kind: ToastKind.Danger, message: 'Could not publish — the graph may be invalid.' } });
    } finally {
      setBusy(false);
      setConfirmPublish(false);
    }
  }

  return (
    <section style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: space[5] }} data-testid="workflow-versions">
      <Tree tree={tree} selectedId={wf.selectedId} onSelect={(id) => dispatch({ type: ActionType.WorkflowVersionSelected, id })} />

      <div style={{ display: 'grid', gap: space[3], alignContent: 'start' }}>
        {!selected && <EmptyState title="Select a version" hint="Pick a workflow version to inspect its state machine." />}
        {selected && (
          <>
            <header style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
              <h1 style={{ fontSize: fontSize.h3, flex: 1 }}>{selected.key} <MonoRef muted>v{selected.version}</MonoRef></h1>
              <StatusBadge label={selected.status} tone={versionStatusTone(selected.status)} />
              {selected.status !== WorkflowStatus.Active && (
                <Button variant={ButtonVariant.Primary} disabled={busy} onClick={() => setConfirmPublish(true)} testId="wf-publish">Publish v{selected.version}</Button>
              )}
            </header>

            <div style={{ display: 'flex', gap: space[2] }}>
              <Button variant={wf.panel === WorkflowPanel.Diagram ? ButtonVariant.Secondary : ButtonVariant.Ghost} onClick={() => dispatch({ type: ActionType.WorkflowPanelToggled, panel: WorkflowPanel.Diagram })} testId="wf-tab-diagram">Diagram</Button>
              <Button variant={wf.panel === WorkflowPanel.Diff ? ButtonVariant.Secondary : ButtonVariant.Ghost} onClick={() => dispatch({ type: ActionType.WorkflowPanelToggled, panel: WorkflowPanel.Diff })} testId="wf-tab-diff">View diff v→v</Button>
            </div>

            {wf.panel === WorkflowPanel.Diagram ? <Diagram /> : <Diff />}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmPublish}
        title={selected ? `Publish v${selected.version}?` : 'Publish'}
        message="This makes it the active version for new reports. In-flight reports stay pinned to their current version."
        confirmLabel="Publish"
        confirmTestId="wf-publish-yes"
        cancelTestId="wf-publish-no"
        onConfirm={publish}
        onCancel={() => setConfirmPublish(false)}
      />
    </section>
  );
}

function Tree({ tree, selectedId, onSelect }: { tree: ReturnType<typeof buildTree>; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <aside style={{ display: 'grid', gap: space[3], alignContent: 'start' }}>
      {tree.map((group) => (
        <Card key={group.key}>
          <div style={{ fontWeight: fontWeight.semibold, marginBottom: space[2] }}>{group.key}</div>
          <div style={{ display: 'grid', gap: space[1] }}>
            {group.versions.map((v) => (
              <button key={v.id} data-testid={`wf-version-${v.id}`} onClick={() => onSelect(v.id)}
                style={{ display: 'flex', alignItems: 'center', gap: space[2], textAlign: 'left', padding: `${space[1]}px ${space[2]}px`, border: `1px solid ${v.id === selectedId ? color.brand : color.line}`, background: v.id === selectedId ? color.brandTint : color.surface, borderRadius: radius.md, cursor: 'pointer' }}>
                <span style={{ flex: 1, fontSize: fontSize.sm }}>v{v.version}</span>
                <StatusBadge label={v.status} tone={versionStatusTone(v.status)} />
                <Pill>{v.pinnedReports} pinned</Pill>
              </button>
            ))}
          </div>
        </Card>
      ))}
    </aside>
  );
}

function Diagram() {
  const inspect = useSelector((s) => s.workflow.inspect);
  if (!inspect) return <Card><Skeleton width="40%" /></Card>;
  return (
    <Card testId="wf-diagram">
      <Legend />
      <h4 style={{ fontSize: fontSize.sm, color: color.muted, margin: `${space[3]}px 0 ${space[1]}px` }}>States</h4>
      <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>
        {inspect.states.map((s: GraphStateDto) => (
          <span key={s.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${s.isTerminal ? color.lineStrong : color.line}`, borderStyle: s.isTerminal ? 'double' : 'solid', background: s.isInitial ? color.brandTint : color.surfaceSunken, borderRadius: radius.pill, padding: `2px ${space[2]}px`, fontSize: fontSize.xs }}>
            {s.isInitial && <span style={{ width: 6, height: 6, borderRadius: 3, background: color.brand }} />}{s.name}
          </span>
        ))}
      </div>
      <h4 style={{ fontSize: fontSize.sm, color: color.muted, margin: `${space[3]}px 0 ${space[1]}px` }}>Transitions</h4>
      <div style={{ display: 'grid', gap: 2, fontSize: fontSize.sm }}>
        {inspect.transitions.map((t: GraphTransitionDto, i: number) => (
          <div key={i}><MonoRef>{t.fromState}</MonoRef> <span style={{ color: color.muted }}>—{t.event}→</span> <MonoRef>{t.toState}</MonoRef></div>
        ))}
      </div>
    </Card>
  );
}

function Legend() {
  return (
    <div style={{ display: 'flex', gap: space[3], fontSize: fontSize.xs, color: color.muted }}>
      <span><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: color.brand, marginRight: 4 }} />initial</span>
      <span style={{ borderBottom: `3px double ${color.lineStrong}` }}>terminal</span>
    </div>
  );
}

function Diff() {
  const diff = useSelector((s) => s.workflow.diff);
  if (!diff) return <Card><Skeleton width="40%" /></Card>;
  const vm = diffViewModel({ diff: diff.diff });
  const base = diff.from ? `v${diff.from.version}` : '∅';
  return (
    <Card testId="wf-diff">
      <div style={{ fontSize: fontSize.sm, color: color.muted, marginBottom: space[2] }}>
        Diff <MonoRef>{base}</MonoRef> → <MonoRef>v{diff.to.version}</MonoRef> (vs the active version)
      </div>
      {vm.isEmpty && <EmptyState title="No differences" hint="This version matches the active version." />}

      <DiffSection kind={DiffKind.Added} testid="wf-diff-added" items={[...vm.states.added.map((s) => `state ${s}`), ...vm.transitions.added]} />
      <DiffSection kind={DiffKind.Removed} testid="wf-diff-removed" items={[...vm.states.removed.map((s) => `state ${s}`), ...vm.transitions.removed]} />
      <DiffSection kind={DiffKind.Changed} testid="wf-diff-changed" items={vm.transitions.changed.map((c) => `${c.fromState} —${c.event}→ ${c.before} ⇒ ${c.after}`)} />
    </Card>
  );
}

function DiffSection({ kind, items, testid }: { kind: DiffKind; items: string[]; testid: string }) {
  if (!items.length) return null;
  const tone = DIFF_KIND_TONE[kind] as StatusTone;
  const c = toneColors[tone];
  return (
    <div data-testid={testid} style={{ marginTop: space[2] }}>
      <div style={{ fontSize: fontSize.xs, textTransform: 'uppercase', letterSpacing: 0.4, color: c.fg, fontWeight: fontWeight.semibold }}>{kind}</div>
      <div style={{ display: 'grid', gap: 2, marginTop: 2 }}>
        {items.map((it, i) => (
          <div key={i} style={{ fontSize: fontSize.sm, fontFamily: 'var(--font-mono)', color: c.fg, background: c.bg, border: `1px solid ${c.border}`, borderRadius: radius.sm, padding: `1px ${space[2]}px` }}>{it}</div>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useId, useState, type WheelEvent } from 'react';
import { WorkflowStatus } from '@inqi/shared';
import { AsyncStatus, ButtonVariant, StatusTone, ToastKind } from '../conventions/enums';
import {
  WorkflowPanel, DiffKind, DIFF_KIND_TONE, buildTree, diffViewModel, versionStatusTone,
} from '../conventions/workflow';
import { layoutWorkflow } from '../conventions/workflow-diagram';
import { toMermaidSource } from '../conventions/workflow-mermaid';
import { color, space, fontSize, fontWeight, radius, font } from '../theme/tokens';
import { adminApi } from '../api';
import { GraphStateDto, GraphTransitionDto, WorkflowInspectDto } from '../api/types';
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

      {/* minWidth 0: a grid child's min-width defaults to auto — the wide diagram would
          stretch the column past the viewport instead of scrolling inside its card. */}
      <div style={{ display: 'grid', gap: space[3], alignContent: 'start', minWidth: 0 }}>
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
    // minWidth 0: the card is a grid item — without it, the wide drawing sizes the
    // card to max-content and the scroll never engages.
    <Card testId="wf-diagram" style={{ minWidth: 0 }}>
      <Legend />
      <MermaidStateMachine states={inspect.states} transitions={inspect.transitions} tunables={inspect.tunables ?? []} />
      <details style={{ marginTop: space[3] }}>
        <summary style={{ fontSize: fontSize.sm, color: color.muted, cursor: 'pointer' }}>Transition list ({inspect.transitions.length})</summary>
        <div style={{ display: 'grid', gap: 2, fontSize: fontSize.sm, marginTop: space[1] }}>
          {inspect.transitions.map((t: GraphTransitionDto, i: number) => (
            <div key={i}><MonoRef>{t.fromState}</MonoRef> <span style={{ color: color.muted }}>—{t.event}→</span> <MonoRef>{t.toState}</MonoRef></div>
          ))}
        </div>
      </details>
    </Card>
  );
}

/** The collapsed same-event fan-ins (CANCEL from everywhere), noted below the drawing instead of drawn. */
function CollapsedNote({ collapsed }: { collapsed: { event: string; toState: string; fromCount: number }[] }) {
  if (!collapsed.length) return null;
  return (
    <div data-testid="wf-collapsed-note" style={{ display: 'flex', flexWrap: 'wrap', gap: space[2], marginTop: space[2] }}>
      {collapsed.map((c) => (
        <span key={`${c.event}-${c.toState}`} style={{ fontSize: fontSize.xs, color: color.muted, background: color.surfaceSunken, border: `1px dashed ${color.lineStrong}`, borderRadius: radius.pill, padding: `2px ${space[2]}px` }}>
          —{c.event}→ <span style={{ fontFamily: font.mono }}>{c.toState}</span> from {c.fromCount} states (not drawn)
        </span>
      ))}
    </div>
  );
}

/**
 * The state machine rendered by mermaid (stateDiagram-v2, dagre layout — proper
 * edge routing + spacing). Mermaid is loaded lazily so the customer bundle never
 * pays for it; while loading — and if the import/render ever fails — the
 * hand-rolled {@link StateMachineSvg} renders instead, so the tab always shows a
 * diagram. The drawing scrolls horizontally inside the card.
 */
function MermaidStateMachine({ states, transitions, tunables }: { states: GraphStateDto[]; transitions: GraphTransitionDto[]; tunables?: WorkflowInspectDto['tunables'] }) {
  const renderId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const { source, collapsed } = toMermaidSource({ states, transitions, tunables });
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        // useMaxWidth:false keeps the drawing at natural size — the wrapper scrolls
        // horizontally instead of mermaid shrinking the diagram to fit the card.
        mermaid.initialize({ startOnLoad: false, theme: 'neutral', fontFamily: font.mono, themeVariables: { fontSize: '13px' }, state: { useMaxWidth: false } });
        const rendered = await mermaid.render(`wf-mmd-${renderId}`, source);
        if (alive) setSvg(rendered.svg);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [source, renderId]);

  if (failed || !svg) return <StateMachineSvg states={states} transitions={transitions} />;
  return (
    <div>
      <div
        data-testid="wf-mermaid"
        className="inqi-hscroll"
        onWheel={wheelToHorizontal}
        style={{ marginTop: space[2], paddingBottom: space[1] }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <CollapsedNote collapsed={collapsed} />
    </div>
  );
}

/**
 * Wide diagrams scroll horizontally, but a mouse wheel only emits vertical deltas —
 * translate them so the drawing pans under the wheel (trackpads pass through native).
 */
function wheelToHorizontal(e: WheelEvent<HTMLDivElement>): void {
  const el = e.currentTarget;
  if (el.scrollWidth <= el.clientWidth) return;
  if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return; // native horizontal gesture — let it be
  el.scrollLeft += e.deltaY;
}

/** Point at parameter t on a cubic bezier — where the event label sits. */
function cubicAt(t: number, p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number]): [number, number] {
  const u = 1 - t;
  const c = (a: number, b: number, cc: number, dd: number) => u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * cc + t * t * t * dd;
  return [c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])];
}

/**
 * The actual state-machine drawing: layered left-to-right graph (layout is pure +
 * unit-tested in conventions/workflow-diagram). Forward transitions are solid
 * curves; back transitions (ON_HOLD → OUTREACH) route dashed underneath; the
 * CANCEL-from-everywhere fan-in is collapsed into the note below the drawing.
 * Hovering a state highlights its transitions.
 */
function StateMachineSvg({ states, transitions }: { states: GraphStateDto[]; transitions: GraphTransitionDto[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const d = layoutWorkflow({ states, transitions });
  const byName = new Map(d.nodes.map((n) => [n.name, n]));
  const backLaneY = d.height - 14;

  return (
    <div className="inqi-hscroll" onWheel={wheelToHorizontal} style={{ marginTop: space[2] }}>
      <svg width={d.width} height={d.height} viewBox={`0 0 ${d.width} ${d.height}`} role="img" aria-label="workflow state machine" style={{ display: 'block', minWidth: d.width }}>
        <defs>
          <marker id="wf-arrow" viewBox="0 0 8 8" refX={7} refY={4} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path d="M0,0.6 L7.4,4 L0,7.4 z" fill={color.muted} />
          </marker>
          <marker id="wf-arrow-hot" viewBox="0 0 8 8" refX={7} refY={4} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path d="M0,0.6 L7.4,4 L0,7.4 z" fill={color.brand} />
          </marker>
        </defs>

        {d.edges.map((e, i) => {
          const from = byName.get(e.from); const to = byName.get(e.to);
          if (!from || !to) return null;
          const hot = hover === e.from || hover === e.to;
          const dim = hover != null && !hot;
          let path: string; let mid: [number, number];
          if (e.back) {
            // Underneath lane: down from the source's bottom, across, up into the target's bottom.
            const p0: [number, number] = [from.x + from.w / 2, from.y + from.h];
            const p3: [number, number] = [to.x + to.w / 2, to.y + to.h];
            const p1: [number, number] = [p0[0], backLaneY]; const p2: [number, number] = [p3[0], backLaneY];
            path = `M ${p0[0]} ${p0[1]} C ${p1[0]} ${p1[1]}, ${p2[0]} ${p2[1]}, ${p3[0]} ${p3[1]}`;
            mid = cubicAt(0.5, p0, p1, p2, p3);
          } else {
            const p0: [number, number] = [from.x + from.w, from.y + from.h / 2];
            const p3: [number, number] = [to.x, to.y + to.h / 2];
            const bend = Math.max(24, (p3[0] - p0[0]) * 0.45);
            const p1: [number, number] = [p0[0] + bend, p0[1]]; const p2: [number, number] = [p3[0] - bend, p3[1]];
            path = `M ${p0[0]} ${p0[1]} C ${p1[0]} ${p1[1]}, ${p2[0]} ${p2[1]}, ${p3[0]} ${p3[1]}`;
            // Long-span edges (stage → far-away FAILED) label near their source — midpoints
            // of several such edges would otherwise pile up over the middle of the drawing.
            mid = cubicAt(to.layer - from.layer > 1 ? 0.12 : 0.5, p0, p1, p2, p3);
          }
          return (
            <g key={i} opacity={dim ? 0.22 : 1}>
              <path d={path} fill="none" stroke={hot ? color.brand : color.lineStrong} strokeWidth={hot ? 1.8 : 1.2} strokeDasharray={e.back ? '4 3' : undefined} markerEnd={`url(#${hot ? 'wf-arrow-hot' : 'wf-arrow'})`} />
              <text x={mid[0]} y={mid[1] - 4} textAnchor="middle" fontSize={9} fontFamily={font.mono} fill={hot ? color.brandStrong : color.muted} stroke={color.surface} strokeWidth={3} paintOrder="stroke">{e.event}</text>
            </g>
          );
        })}

        {d.nodes.map((n) => {
          const hot = hover === n.name;
          const dim = hover != null && !hot && !d.edges.some((e) => (e.from === hover && e.to === n.name) || (e.to === hover && e.from === n.name));
          return (
            <g key={n.name} opacity={dim ? 0.35 : 1} onMouseEnter={() => setHover(n.name)} onMouseLeave={() => setHover(null)} style={{ cursor: 'default' }} data-testid={`wf-node-${n.name}`}>
              <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={13}
                fill={n.isInitial ? color.brandTint : n.isTerminal ? color.surfaceSunken : color.surface}
                stroke={hot ? color.brand : n.isTerminal ? color.lineStrong : color.line} strokeWidth={hot ? 1.6 : 1} />
              {n.isTerminal && <rect x={n.x + 2.5} y={n.y + 2.5} width={n.w - 5} height={n.h - 5} rx={10.5} fill="none" stroke={color.lineStrong} strokeWidth={0.75} />}
              {n.isInitial && <circle cx={n.x + 12} cy={n.y + n.h / 2} r={3} fill={color.brand} />}
              <text x={n.x + n.w / 2 + (n.isInitial ? 4 : 0)} y={n.y + n.h / 2 + 3.5} textAnchor="middle" fontSize={10.5} fontFamily={font.mono} fill={color.ink}>{n.name}</text>
            </g>
          );
        })}
      </svg>

      {d.collapsed.length > 0 && (
        <div data-testid="wf-collapsed-note" style={{ display: 'flex', flexWrap: 'wrap', gap: space[2], marginTop: space[2] }}>
          {d.collapsed.map((c) => (
            <span key={`${c.event}-${c.toState}`} style={{ fontSize: fontSize.xs, color: color.muted, background: color.surfaceSunken, border: `1px dashed ${color.lineStrong}`, borderRadius: radius.pill, padding: `2px ${space[2]}px` }}>
              —{c.event}→ <span style={{ fontFamily: font.mono }}>{c.toState}</span> from {c.fromCount} states (not drawn)
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div style={{ display: 'flex', gap: space[3], fontSize: fontSize.xs, color: color.muted }}>
      <span><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: color.brand, marginRight: 4 }} />initial</span>
      <span style={{ borderBottom: `3px double ${color.lineStrong}` }}>terminal</span>
      <span><span style={{ display: 'inline-block', width: 18, borderTop: `1.5px dashed ${color.lineStrong}`, verticalAlign: 'middle', marginRight: 4 }} />returns to an earlier state</span>
      <span>hover a state to trace its transitions</span>
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

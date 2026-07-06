import { useState } from 'react';
import { color, radius, fontSize, space, fontWeight, tokens } from '../theme/tokens';
import { ButtonVariant, StatusTone, ToastKind } from '../conventions/enums';
import {
  Button, Input, Textarea, Card, Badge, StatusBadge, Chip, FilterBar, Pill, StatusDot,
  StagePipeline, Skeleton, MonoRef, EmptyState, ErrorState, ConfirmDialog,
} from '../ui';
import { useAppDispatch } from '../state/store';
import { ActionType } from '../state/actions';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: space[8] }}>
      <h2 style={{ fontSize: fontSize.h2, marginBottom: space[3] }}>{title}</h2>
      {children}
    </section>
  );
}

/** /styleguide — renders the design tokens + every base component (FE-01 §1). */
export function StyleGuide() {
  const dispatch = useAppDispatch();
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('all');
  const [confirm, setConfirm] = useState(false);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: space[6] }} data-testid="styleguide">
      <h1 style={{ fontSize: fontSize.h1, marginBottom: space[2] }}>inqi styleguide</h1>
      <p style={{ color: color.muted, marginBottom: space[8] }}>Design tokens + base components. Warm paper · confident green · Geist.</p>

      <Section title="Colour tokens">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px,1fr))', gap: space[2] }}>
          {Object.entries(tokens.color).map(([name, hex]) => (
            <div key={name} style={{ border: `1px solid ${color.line}`, borderRadius: radius.md, overflow: 'hidden' }}>
              <div style={{ height: 40, background: hex }} />
              <div style={{ padding: space[2], fontSize: fontSize.xs }}>
                <div style={{ fontWeight: fontWeight.semibold }}>{name}</div>
                <MonoRef muted>{hex}</MonoRef>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type scale">
        {Object.entries(tokens.fontSize).map(([k, v]) => (
          <div key={k} style={{ fontSize: v, marginBottom: space[1] }}>{k} · {v}px — The quick brown fox</div>
        ))}
      </Section>

      <Section title="Buttons">
        <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>
          {Object.values(ButtonVariant).map((v) => <Button key={v} variant={v}>{v}</Button>)}
          <Button disabled>disabled</Button>
        </div>
      </Section>

      <Section title="Inputs">
        <div style={{ display: 'grid', gap: space[2], maxWidth: 420 }}>
          <Input value={text} onChange={setText} placeholder="Input — your email" />
          <Textarea value={text} onChange={setText} placeholder="Textarea — describe what you're after" />
        </div>
      </Section>

      <Section title="Badges & status">
        <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap', alignItems: 'center' }}>
          {Object.values(StatusTone).map((t) => <StatusBadge key={t} tone={t} label={t} />)}
          <Pill>pill</Pill>
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><StatusDot tone={StatusTone.Brand} pulse /> live</span>
          <MonoRef>#inq_9f3a21</MonoRef>
        </div>
      </Section>

      <Section title="Chips / filters">
        <FilterBar
          value={filter}
          onChange={setFilter}
          options={[{ value: 'all', label: 'All' }, { value: 'open', label: 'Open' }, { value: 'done', label: 'Done' }]}
        />
        <div style={{ marginTop: space[2] }}><Chip label="standalone chip" selected onClick={() => undefined} /></div>
      </Section>

      <Section title="Stage pipeline">
        <Card><StagePipeline currentIndex={3} /></Card>
        <div style={{ height: space[2] }} />
        <Card><StagePipeline currentIndex={4} failed /></Card>
      </Section>

      <Section title="Cards & skeletons">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space[3] }}>
          <Card><b>Card</b><div style={{ color: color.muted }}>Surface with hairline border + soft shadow.</div></Card>
          <Card sunken><div style={{ display: 'grid', gap: space[2] }}><Skeleton width="60%" /><Skeleton /><Skeleton width="40%" /></div></Card>
        </div>
      </Section>

      <Section title="Overlays & feedback">
        <div style={{ display: 'flex', gap: space[2] }}>
          <Button variant={ButtonVariant.Secondary} onClick={() => setConfirm(true)}>Open confirm dialog</Button>
          <Button variant={ButtonVariant.Secondary} onClick={() => dispatch({ type: ActionType.ToastPushed, toast: { id: `demo-${Date.now()}`, kind: ToastKind.Success, message: 'Saved — toast demo.' } })}>Push toast</Button>
        </div>
        <ConfirmDialog open={confirm} title="Cancel this report?" message="This stops the run and refunds the credit." confirmLabel="Cancel run" danger onConfirm={() => setConfirm(false)} onCancel={() => setConfirm(false)} />
      </Section>

      <Section title="Empty / error states">
        <Card><EmptyState title="No reports yet" hint="Start your first research run." action={<Button>New report</Button>} /></Card>
        <div style={{ height: space[2] }} />
        <Card><ErrorState title="Couldn't load" message="Check your connection and retry." action={<Button variant={ButtonVariant.Secondary}>Retry</Button>} /></Card>
      </Section>
    </div>
  );
}

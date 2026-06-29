import { describe, it, expect } from 'vitest';
import { WorkflowStatus } from '@inqi/shared';
import { buildTree, diffViewModel, applyPublished, versionStatusTone } from './workflow';
import { StatusTone } from './enums';
import { WorkflowVersionDto, VersionDiffDto } from '../api/types';

const v = (over: Partial<WorkflowVersionDto>): WorkflowVersionDto => ({ id: 'x', key: 'standard_inquiry', version: 1, status: WorkflowStatus.Draft, pinnedInquiries: 0, ...over });

describe('buildTree', () => {
  it('groups by key (keys sorted) and versions newest-first', () => {
    const tree = buildTree({ versions: [v({ id: 'b1', key: 'b', version: 1 }), v({ id: 'a2', key: 'a', version: 2 }), v({ id: 'a1', key: 'a', version: 1 })] });
    expect(tree.map((g) => g.key)).toEqual(['a', 'b']);
    expect(tree[0].versions.map((x) => x.version)).toEqual([2, 1]);
  });
});

describe('diffViewModel', () => {
  it('pairs a retargeted transition into "changed"; passes through pure add/remove', () => {
    const diff: VersionDiffDto = {
      states: { added: ['NEW'], removed: ['OLD'] },
      transitions: { added: ['X --go--> B', 'P --q--> Q'], removed: ['X --go--> A'] },
    };
    const vm = diffViewModel({ diff });
    expect(vm.states.added).toEqual(['NEW']);
    expect(vm.states.removed).toEqual(['OLD']);
    expect(vm.transitions.changed).toEqual([{ fromState: 'X', event: 'go', before: 'A', after: 'B' }]);
    expect(vm.transitions.added).toEqual(['P --q--> Q']); // the paired add is consumed
    expect(vm.transitions.removed).toEqual([]);
    expect(vm.isEmpty).toBe(false);
  });
  it('flags an empty diff', () => {
    const vm = diffViewModel({ diff: { states: { added: [], removed: [] }, transitions: { added: [], removed: [] } } });
    expect(vm.isEmpty).toBe(true);
  });
});

describe('applyPublished — active/archived swap', () => {
  it('promotes the published version and archives the prior active of the same key', () => {
    const versions = [v({ id: 'd', version: 2, status: WorkflowStatus.Draft }), v({ id: 'a', version: 1, status: WorkflowStatus.Active })];
    const out = applyPublished({ versions, publishedId: 'd' });
    expect(out.find((x) => x.id === 'd')!.status).toBe(WorkflowStatus.Active);
    expect(out.find((x) => x.id === 'a')!.status).toBe(WorkflowStatus.Archived);
  });
  it('is a no-op when the version is already active', () => {
    const versions = [v({ id: 'a', version: 1, status: WorkflowStatus.Active })];
    expect(applyPublished({ versions, publishedId: 'a' })).toBe(versions);
  });
});

describe('versionStatusTone', () => {
  it('colors active=brand, draft=info, archived=muted', () => {
    expect(versionStatusTone(WorkflowStatus.Active)).toBe(StatusTone.Brand);
    expect(versionStatusTone(WorkflowStatus.Draft)).toBe(StatusTone.Info);
    expect(versionStatusTone(WorkflowStatus.Archived)).toBe(StatusTone.Muted);
  });
});

import { describe, it, expect } from 'vitest';
import { EventType, WorkflowStatus, InqiEvent } from '@inqi/shared';
import { AsyncStatus } from '../conventions/enums';
import { WorkflowPanel } from '../conventions/workflow';
import { ActionType } from './actions';
import { workflowReducer, initialWorkflowState } from './workflow.reducer';
import { WorkflowVersionDto } from '../api/types';

const v = (over: Partial<WorkflowVersionDto>): WorkflowVersionDto => ({ id: 'x', key: 'k', version: 1, status: WorkflowStatus.Draft, pinnedInquiries: 0, ...over });
const versions = [v({ id: 'd', version: 2, status: WorkflowStatus.Draft }), v({ id: 'a', version: 1, status: WorkflowStatus.Active })];
const evt = (over: Partial<InqiEvent>): InqiEvent => ({ id: '1', type: EventType.WorkflowPublished, inquiryId: '', at: 't', data: {}, ...over });

describe('workflowReducer', () => {
  it('loaded defaults selection to the active version', () => {
    const s = workflowReducer(initialWorkflowState, { type: ActionType.WorkflowsLoaded, versions });
    expect(s.status).toBe(AsyncStatus.Ready);
    expect(s.selectedId).toBe('a');
  });

  it('selecting a version resets the panel + inspect/diff', () => {
    let s = workflowReducer(initialWorkflowState, { type: ActionType.WorkflowsLoaded, versions });
    s = workflowReducer(s, { type: ActionType.WorkflowPanelToggled, panel: WorkflowPanel.Diff });
    s = workflowReducer(s, { type: ActionType.WorkflowVersionSelected, id: 'd' });
    expect(s.selectedId).toBe('d');
    expect(s.panel).toBe(WorkflowPanel.Diagram);
    expect(s.diff).toBeNull();
  });

  it('a workflow.published event swaps active/archived (idempotent; ignores other types)', () => {
    let s = workflowReducer(initialWorkflowState, { type: ActionType.WorkflowsLoaded, versions });
    s = workflowReducer(s, { type: ActionType.EventReceived, event: evt({ id: '5', data: { id: 'd' } }) });
    expect(s.versions.find((x) => x.id === 'd')!.status).toBe(WorkflowStatus.Active);
    expect(s.versions.find((x) => x.id === 'a')!.status).toBe(WorkflowStatus.Archived);

    const before = s;
    const dup = workflowReducer(s, { type: ActionType.EventReceived, event: evt({ id: '5', data: { id: 'd' } }) });
    expect(dup).toBe(before); // idempotent by event id
    const other = workflowReducer(s, { type: ActionType.EventReceived, event: evt({ id: '6', type: EventType.InquiryTransitioned, data: { to: 'X' } }) });
    expect(other).toBe(before); // non-publish event ignored
  });
});

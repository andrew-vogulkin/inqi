import { ApiProperty } from '@nestjs/swagger';
import { WorkflowStatus } from '@inqi/shared';

export class WorkflowVersionDto {
  @ApiProperty({ example: 'clz1wf0001' }) id!: string;
  @ApiProperty({ example: 'inquiry' }) key!: string;
  @ApiProperty({ example: 2 }) version!: number;
  @ApiProperty({ enum: Object.values(WorkflowStatus), example: WorkflowStatus.Active }) status!: string;
  @ApiProperty({ description: 'inquiries pinned to this version', example: 14 }) pinnedInquiries!: number;
  @ApiProperty({ example: '2026-06-29T12:00:00.000Z' }) createdAt!: Date;
}

export class WorkflowTransitionDto {
  @ApiProperty({ example: 'PRE_RESEARCH' }) fromState!: string;
  @ApiProperty({ example: 'QUESTIONNAIRE_SENT' }) toState!: string;
  @ApiProperty({ example: 'PRE_RESEARCH_PASSED' }) event!: string;
  @ApiProperty({ required: false, nullable: true, example: 'send:questionnaire' }) action?: string | null;
}

export class WorkflowInspectDto {
  @ApiProperty({ example: 'clz1wf0001' }) id!: string;
  @ApiProperty({ example: 2 }) version!: number;
  @ApiProperty({ enum: Object.values(WorkflowStatus), example: WorkflowStatus.Draft }) status!: string;
  @ApiProperty({ type: Object, isArray: true, example: [{ name: 'PRE_RESEARCH', isInitial: true, isTerminal: false }] }) states!: unknown[];
  @ApiProperty({ type: [WorkflowTransitionDto] }) transitions!: WorkflowTransitionDto[];
  @ApiProperty({ type: Object, description: '{ valid, errors[] }', example: { valid: true, errors: [] } }) validation!: unknown;
}

/** Result of activating a workflow version (POST /workflows/:id/publish). */
export class WorkflowPublishResultDto {
  @ApiProperty({ example: 'clz1wf0001' }) id!: string;
  @ApiProperty({ example: 2 }) version!: number;
  @ApiProperty({ enum: Object.values(WorkflowStatus), example: WorkflowStatus.Active }) status!: string;
  @ApiProperty({ description: 'true when the version was already active (idempotent no-op)', example: false }) alreadyActive!: boolean;
}

/** Added/removed sets for one diff dimension (states or transitions). */
export class WorkflowDiffSetDto {
  @ApiProperty({ type: [String], example: ['ON_HOLD'] }) added!: string[];
  @ApiProperty({ type: [String], example: [] }) removed!: string[];
}

class WorkflowVersionRefDto {
  @ApiProperty({ example: 'clz1wf0001' }) id!: string;
  @ApiProperty({ example: 1 }) version!: number;
}

/** Added/removed states + transitions between two versions. */
export class WorkflowGraphDiffDto {
  @ApiProperty({ type: WorkflowDiffSetDto }) states!: WorkflowDiffSetDto;
  @ApiProperty({ type: WorkflowDiffSetDto }) transitions!: WorkflowDiffSetDto;
}

/** Diff of a version against the current active version of its key (GET /workflows/:id/diff). */
export class WorkflowDiffDto {
  @ApiProperty({ type: WorkflowVersionRefDto, nullable: true, description: 'the active version compared against (null if none)' })
  from!: WorkflowVersionRefDto | null;
  @ApiProperty({ type: WorkflowVersionRefDto }) to!: WorkflowVersionRefDto;
  @ApiProperty({ type: WorkflowGraphDiffDto }) diff!: WorkflowGraphDiffDto;
}

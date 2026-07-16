/**
 * Wire DTOs (API-03). The canonical shapes now live in `@inqi/shared` (the single
 * FE/BE contract); this module re-exports them so existing `../api/types` imports
 * keep resolving. Add FE-only view types here if ever needed — contract types go in
 * `packages/shared/src/dto.ts`.
 */
export type {
  SessionDto,
  ReportDto,
  ReportSearchResultDto,
  UserRowDto,
  UserSearchResultDto,
  UsageReportDto,
  UsageReportRowDto,
  ReportOption,
  LiveReportDto,
  ReportSnapshotDto,
  CreditEntry,
  CreditsDto,
  CreditRequestDto,
  QuestionnaireQuestion,
  QuestionnaireDto,
  CostSummaryDto,
  ThreadMessageDto,
  SourceDto,
  BoardInquiryDto,
  BoardEpicDto,
  ReportBoardDto,
  AuditEntryDto,
  AuditResultDto,
  WorkflowVersionDto,
  GraphStateDto,
  GraphTransitionDto,
  WorkflowInspectDto,
  VersionDiffDto,
  VersionDiffResultDto,
  PublishResultDto,
  CustomerDirectoryDto,
  ProvenanceDto,
  UnlockResultDto,
} from '@inqi/shared';

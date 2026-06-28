import { ApiProperty } from '@nestjs/swagger';

export class WorkflowVersionDto {
  @ApiProperty() id!: string;
  @ApiProperty() key!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ description: 'draft | active | archived' }) status!: string;
  @ApiProperty({ description: 'inquiries pinned to this version' }) pinnedInquiries!: number;
  @ApiProperty() createdAt!: Date;
}

export class WorkflowTransitionDto {
  @ApiProperty() fromState!: string;
  @ApiProperty() toState!: string;
  @ApiProperty() event!: string;
  @ApiProperty({ required: false, nullable: true }) action?: string | null;
}

export class WorkflowInspectDto {
  @ApiProperty() id!: string;
  @ApiProperty() version!: number;
  @ApiProperty() status!: string;
  @ApiProperty({ type: Object }) states!: unknown[];
  @ApiProperty({ type: Object }) transitions!: unknown[];
  @ApiProperty({ type: Object, description: '{ valid, errors[] }' }) validation!: unknown;
}

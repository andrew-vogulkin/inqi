import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { InquiriesService } from './inquiries.service';

@Controller('inquiries')
export class InquiriesController {
  constructor(private svc: InquiriesService) {}
  @Post() create(@Body() dto: any) { return this.svc.create(dto); }
  @Get() list() { return this.svc.list(); }
  @Get(':id') get(@Param('id') id: string) { return this.svc.get(id); }
}

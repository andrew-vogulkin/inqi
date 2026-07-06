import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { HealthStatus } from '@inqi/shared';
import { HealthDto } from './health.dto';

@ApiTags('observability')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ type: HealthDto })
  check(): HealthDto {
    return { status: HealthStatus.Ok, at: new Date().toISOString() };
  }
}

import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { HealthDto } from './health.dto';

@ApiTags('observability')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ type: HealthDto })
  check(): HealthDto {
    return { status: 'ok', at: new Date().toISOString() };
  }
}

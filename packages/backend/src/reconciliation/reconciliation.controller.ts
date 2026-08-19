import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiParam,
} from '@nestjs/swagger';
import { AdminGuard } from '../auth/guards/admin.guard';
import { ReconciliationService } from './reconciliation.service';
import { StartReconciliationDto } from './dto/start-reconciliation.dto';
import { QueryReconciliationRunsDto } from './dto/query-reconciliation-runs.dto';
import { QueryDiscrepanciesDto } from './dto/query-discrepancies.dto';
import { Audited } from '../audit/decorators/audited.decorator';
import { AuditActionType } from '../audit/audit-log.entity';

@ApiTags('admin-reconciliation')
@ApiBearerAuth('JWT-auth')
@UseGuards(AdminGuard)
@Controller('admin/reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Post('run')
  @ApiOperation({
    summary:
      'Start an on-chain portfolio reconciliation run (dry-run or repair mode)',
  })
  @ApiOkResponse({ description: 'Reconciliation run started successfully' })
  @Audited(AuditActionType.ADMIN_ACTION, () => 'reconciliation:run')
  startRun(@Body() dto: StartReconciliationDto) {
    return this.reconciliationService.startRun(dto);
  }

  @Get('runs')
  @ApiOperation({
    summary: 'List reconciliation runs with pagination and filters',
  })
  @ApiOkResponse({ description: 'Paginated list of reconciliation runs' })
  listRuns(@Query() query: QueryReconciliationRunsDto) {
    return this.reconciliationService.getRuns(query);
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'Get details of a specific reconciliation run' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ description: 'Reconciliation run details' })
  getRunById(@Param('id', ParseUUIDPipe) id: string) {
    return this.reconciliationService.getRunById(id);
  }

  @Get('discrepancies')
  @ApiOperation({
    summary:
      'List detected discrepancies across runs with pagination and filters',
  })
  @ApiOkResponse({ description: 'Paginated list of discrepancies' })
  listDiscrepancies(@Query() query: QueryDiscrepanciesDto) {
    return this.reconciliationService.getDiscrepancies(query);
  }
}

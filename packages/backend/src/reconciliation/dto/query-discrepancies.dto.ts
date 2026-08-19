import { IsOptional, IsInt, Min, Max, IsUUID, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  DiscrepancyType,
  DiscrepancyStatus,
} from '../entities/reconciliation-discrepancy.entity';

export class QueryDiscrepanciesDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Filter by specific reconciliation run ID',
  })
  @IsOptional()
  @IsUUID()
  runId?: string;

  @ApiPropertyOptional({ enum: DiscrepancyType })
  @IsOptional()
  @IsEnum(DiscrepancyType)
  type?: DiscrepancyType;

  @ApiPropertyOptional({ enum: DiscrepancyStatus })
  @IsOptional()
  @IsEnum(DiscrepancyStatus)
  status?: DiscrepancyStatus;
}

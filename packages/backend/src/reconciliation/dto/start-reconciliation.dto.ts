import {
  IsString,
  IsArray,
  IsOptional,
  IsInt,
  Min,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StartReconciliationDto {
  @ApiPropertyOptional({
    description: 'Target network (e.g. mainnet, testnet, futurenet)',
    example: 'testnet',
  })
  @IsOptional()
  @IsString()
  network?: string = 'testnet';

  @ApiPropertyOptional({
    description:
      'Target contract IDs to reconcile. If omitted, uses deployment defaults.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  contractIds?: string[];

  @ApiProperty({
    description: 'Start ledger sequence (inclusive)',
    example: 1000,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fromLedger: number;

  @ApiProperty({
    description: 'End ledger sequence (inclusive)',
    example: 2000,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  toLedger: number;

  @ApiPropertyOptional({
    description:
      'If true, produces discrepancy reports without DB mutations. Default is true.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isDryRun?: boolean = true;
}

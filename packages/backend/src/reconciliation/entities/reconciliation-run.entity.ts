import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum ReconciliationRunStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Entity('reconciliation_runs')
export class ReconciliationRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32, default: 'testnet' })
  @Index()
  network: string;

  @Column({ type: 'jsonb' })
  contractIds: string[];

  @Column({ type: 'bigint' })
  fromLedger: number;

  @Column({ type: 'bigint' })
  toLedger: number;

  @Column({ type: 'boolean', default: true })
  @Index()
  isDryRun: boolean;

  @Column({
    type: 'enum',
    enum: ReconciliationRunStatus,
    default: ReconciliationRunStatus.PENDING,
  })
  @Index()
  status: ReconciliationRunStatus;

  @Column({ type: 'int', default: 0 })
  scannedEventsCount: number;

  @Column({ type: 'int', default: 0 })
  discrepancyCount: number;

  @Column({ type: 'int', default: 0 })
  repairedCount: number;

  @Column({ type: 'int', default: 0 })
  quarantinedCount: number;

  @Column({ type: 'jsonb', nullable: true })
  discrepancyBreakdown: Record<string, number> | null;

  @Column({ type: 'int', nullable: true })
  durationMs: number | null;

  @Column({ type: 'text', nullable: true })
  failureReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ReconciliationRun } from './reconciliation-run.entity';

export enum DiscrepancyType {
  MISSING_OFFCHAIN = 'MISSING_OFFCHAIN',
  DUPLICATE_OFFCHAIN = 'DUPLICATE_OFFCHAIN',
  VALUE_MISMATCH = 'VALUE_MISMATCH',
  UNKNOWN_CONTRACT = 'UNKNOWN_CONTRACT',
  UNRECOVERABLE = 'UNRECOVERABLE',
}

export enum DiscrepancyStatus {
  DETECTED = 'DETECTED',
  REPAIRED = 'REPAIRED',
  QUARANTINED = 'QUARANTINED',
  IGNORED = 'IGNORED',
}

@Entity('reconciliation_discrepancies')
export class ReconciliationDiscrepancy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  runId: string;

  @ManyToOne(() => ReconciliationRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'runId' })
  run: ReconciliationRun;

  @Column({ type: 'varchar', length: 64 })
  @Index()
  contractId: string;

  @Column({ type: 'bigint' })
  @Index()
  ledger: number;

  @Column({ type: 'varchar', length: 64 })
  txHash: string;

  @Column({ type: 'int', default: 0 })
  eventIndex: number;

  @Column({ type: 'varchar', length: 160 })
  @Index()
  stableIdentity: string;

  @Column({ type: 'varchar', length: 64 })
  eventType: string;

  @Column({
    type: 'enum',
    enum: DiscrepancyType,
  })
  @Index()
  discrepancyType: DiscrepancyType;

  @Column({
    type: 'enum',
    enum: DiscrepancyStatus,
    default: DiscrepancyStatus.DETECTED,
  })
  @Index()
  status: DiscrepancyStatus;

  @Column({ type: 'jsonb' })
  details: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  repairNotes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

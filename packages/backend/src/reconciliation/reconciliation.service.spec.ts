import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { getQueueToken } from '@nestjs/bullmq';
import { DataSource, Repository } from 'typeorm';
import { SorobanRpc } from '@stellar/stellar-sdk';
import {
  ReconciliationService,
  ParsedOnChainEvent,
} from './reconciliation.service';
import {
  ReconciliationRun,
  ReconciliationRunStatus,
} from './entities/reconciliation-run.entity';
import {
  ReconciliationDiscrepancy,
  DiscrepancyType,
  DiscrepancyStatus,
} from './entities/reconciliation-discrepancy.entity';
import { Call, CallStatus } from '../calls/entities/call.entity';
import { Stake } from '../stakes/entities/stake.entity';
import {
  PayoutClaim,
  PayoutClaimStatus,
} from '../payouts/entities/payout-claim.entity';
import { EventLog } from '../indexer/event-log.entity';
import { QUEUE_RECONCILIATION } from '../common/queues/queues.constants';
import { BadRequestException, ConflictException } from '@nestjs/common';

describe('ReconciliationService', () => {
  let service: ReconciliationService;
  let runRepo: jest.Mocked<Repository<ReconciliationRun>>;
  let discrepancyRepo: jest.Mocked<Repository<ReconciliationDiscrepancy>>;
  let callRepo: jest.Mocked<Repository<Call>>;
  let stakeRepo: jest.Mocked<Repository<Stake>>;
  let payoutClaimRepo: jest.Mocked<Repository<PayoutClaim>>;
  let eventLogRepo: jest.Mocked<Repository<EventLog>>;
  let cacheManager: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let queue: { add: jest.Mock };
  let dataSource: any;

  const mockContractId =
    'CA12345678901234567890123456789012345678901234567890123456789012';

  beforeEach(async () => {
    runRepo = {
      create: jest.fn((dto) => ({ id: 'run-uuid-1', ...dto })),
      save: jest.fn((entity) =>
        Promise.resolve({ id: entity.id || 'run-uuid-1', ...entity }),
      ),
      findOne: jest.fn(),
      findAndCount: jest.fn(),
    } as any;

    discrepancyRepo = {
      create: jest.fn((dto) => ({ id: 'disc-uuid-1', ...dto })),
      save: jest.fn((entity) =>
        Promise.resolve({ id: entity.id || 'disc-uuid-1', ...entity }),
      ),
      findAndCount: jest.fn(),
    } as any;

    callRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn((entity) => Promise.resolve(entity)),
    } as any;

    stakeRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn((entity) => Promise.resolve(entity)),
    } as any;

    payoutClaimRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn((entity) => Promise.resolve(entity)),
    } as any;

    eventLogRepo = {
      find: jest.fn().mockResolvedValue([]),
    } as any;

    cacheManager = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    dataSource = {
      transaction: jest.fn(async (cb: any) => {
        const mockManager = {
          create: (cls: any, data: any) => ({ ...data }),
          save: async (data: any) => data,
        };
        return cb(mockManager);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReconciliationService,
        { provide: getRepositoryToken(ReconciliationRun), useValue: runRepo },
        {
          provide: getRepositoryToken(ReconciliationDiscrepancy),
          useValue: discrepancyRepo,
        },
        { provide: getRepositoryToken(Call), useValue: callRepo },
        { provide: getRepositoryToken(Stake), useValue: stakeRepo },
        { provide: getRepositoryToken(PayoutClaim), useValue: payoutClaimRepo },
        { provide: getRepositoryToken(EventLog), useValue: eventLogRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: CACHE_MANAGER, useValue: cacheManager },
        { provide: getQueueToken(QUEUE_RECONCILIATION), useValue: queue },
        {
          provide: SorobanRpc.Server,
          useValue: {
            getEvents: jest.fn().mockResolvedValue({ events: [] }),
          },
        },
      ],
    }).compile();

    service = module.get<ReconciliationService>(ReconciliationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('startRun', () => {
    it('should throw BadRequestException if fromLedger > toLedger', async () => {
      await expect(
        service.startRun({ fromLedger: 200, toLedger: 100 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException if lock is active', async () => {
      cacheManager.get.mockResolvedValue('locked');
      await expect(
        service.startRun({
          fromLedger: 100,
          toLedger: 200,
          network: 'testnet',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should create a run and acquire lock successfully', async () => {
      const result = await service.startRun({
        fromLedger: 100,
        toLedger: 200,
        network: 'testnet',
        isDryRun: true,
      });

      expect(result.id).toBe('run-uuid-1');
      expect(result.status).toBe(ReconciliationRunStatus.PENDING);
      expect(cacheManager.set).toHaveBeenCalledWith(
        'reconciliation_lock:testnet',
        'locked',
        900000,
      );
      expect(queue.add).toHaveBeenCalledWith('reconcile', {
        runId: 'run-uuid-1',
      });
    });
  });

  describe('executeRun - Dry Run Mode & Discrepancy Classification', () => {
    it('should classify MISSING_OFFCHAIN for call_created event when call absent', async () => {
      const mockRun: ReconciliationRun = {
        id: 'run-1',
        network: 'testnet',
        contractIds: [mockContractId],
        fromLedger: 100,
        toLedger: 200,
        isDryRun: true,
        status: ReconciliationRunStatus.PENDING,
        scannedEventsCount: 0,
        discrepancyCount: 0,
        repairedCount: 0,
        quarantinedCount: 0,
        discrepancyBreakdown: null,
        durationMs: null,
        failureReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      runRepo.findOne.mockResolvedValue(mockRun);

      // Mock indexed EventLog for call_created
      eventLogRepo.find.mockResolvedValue([
        {
          id: 1,
          eventId: 'tx1-0',
          pagingToken: '105-tx1',
          contractId: mockContractId,
          eventType: EventLog.name
            ? ('call_created' as any)
            : ('call_created' as any),
          ledger: 105,
          txHash: 'txhash123',
          txOrder: 0,
          eventData: { callId: 'call-101', title: 'Will BTC hit 100k?' },
          timestamp: new Date(),
          createdAt: new Date(),
        },
      ]);

      callRepo.find.mockResolvedValue([]); // Absent in Postgres

      const completedRun = await service.executeRun('run-1');

      expect(completedRun.status).toBe(ReconciliationRunStatus.COMPLETED);
      expect(completedRun.scannedEventsCount).toBe(1);
      expect(completedRun.discrepancyCount).toBe(1);
      expect(completedRun.repairedCount).toBe(0); // Dry-run mode: 0 repairs
      expect(
        completedRun.discrepancyBreakdown?.[DiscrepancyType.MISSING_OFFCHAIN],
      ).toBe(1);

      expect(discrepancyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          discrepancyType: DiscrepancyType.MISSING_OFFCHAIN,
          status: DiscrepancyStatus.DETECTED,
        }),
      );

      // Verify lock released
      expect(cacheManager.del).toHaveBeenCalledWith(
        'reconciliation_lock:testnet',
      );
    });

    it('should classify DUPLICATE_OFFCHAIN when multiple calls found with same ID', async () => {
      const mockRun: ReconciliationRun = {
        id: 'run-2',
        network: 'testnet',
        contractIds: [mockContractId],
        fromLedger: 100,
        toLedger: 200,
        isDryRun: true,
        status: ReconciliationRunStatus.PENDING,
        scannedEventsCount: 0,
        discrepancyCount: 0,
        repairedCount: 0,
        quarantinedCount: 0,
        discrepancyBreakdown: null,
        durationMs: null,
        failureReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      runRepo.findOne.mockResolvedValue(mockRun);

      eventLogRepo.find.mockResolvedValue([
        {
          id: 1,
          eventId: 'tx1-0',
          pagingToken: '105-tx1',
          contractId: mockContractId,
          eventType: 'call_created' as any,
          ledger: 105,
          txHash: 'txhash123',
          txOrder: 0,
          eventData: { callId: 'call-dup' },
          timestamp: new Date(),
          createdAt: new Date(),
        },
      ]);

      // Return 2 calls with same ID
      callRepo.find.mockResolvedValue([
        { id: 'call-dup', title: 'Call 1' } as any,
        { id: 'call-dup', title: 'Call 2' } as any,
      ]);

      const completedRun = await service.executeRun('run-2');

      expect(completedRun.discrepancyCount).toBe(1);
      expect(
        completedRun.discrepancyBreakdown?.[DiscrepancyType.DUPLICATE_OFFCHAIN],
      ).toBe(1);
    });

    it('should classify VALUE_MISMATCH when Call resolution status differs from on-chain event', async () => {
      const mockRun: ReconciliationRun = {
        id: 'run-3',
        network: 'testnet',
        contractIds: [mockContractId],
        fromLedger: 100,
        toLedger: 200,
        isDryRun: true,
        status: ReconciliationRunStatus.PENDING,
        scannedEventsCount: 0,
        discrepancyCount: 0,
        repairedCount: 0,
        quarantinedCount: 0,
        discrepancyBreakdown: null,
        durationMs: null,
        failureReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      runRepo.findOne.mockResolvedValue(mockRun);

      eventLogRepo.find.mockResolvedValue([
        {
          id: 1,
          eventId: 'tx1-0',
          pagingToken: '105-tx1',
          contractId: mockContractId,
          eventType: 'call_resolved' as any,
          ledger: 105,
          txHash: 'txhash123',
          txOrder: 0,
          eventData: { callId: 'call-resolved-1', outcome: 'YES' },
          timestamp: new Date(),
          createdAt: new Date(),
        },
      ]);

      // Call is still OPEN in Postgres
      callRepo.findOne.mockResolvedValue({
        id: 'call-resolved-1',
        status: CallStatus.OPEN,
      } as any);

      const completedRun = await service.executeRun('run-3');

      expect(completedRun.discrepancyCount).toBe(1);
      expect(
        completedRun.discrepancyBreakdown?.[DiscrepancyType.VALUE_MISMATCH],
      ).toBe(1);
      expect(completedRun.repairedCount).toBe(0);
    });
  });

  describe('executeRun - Repair Mode & Idempotency', () => {
    it('should repair MISSING_OFFCHAIN for PayoutClaim in Repair Mode without submitting Soroban tx', async () => {
      const mockRun: ReconciliationRun = {
        id: 'run-repair-1',
        network: 'testnet',
        contractIds: [mockContractId],
        fromLedger: 100,
        toLedger: 200,
        isDryRun: false, // REPAIR MODE
        status: ReconciliationRunStatus.PENDING,
        scannedEventsCount: 0,
        discrepancyCount: 0,
        repairedCount: 0,
        quarantinedCount: 0,
        discrepancyBreakdown: null,
        durationMs: null,
        failureReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      runRepo.findOne.mockResolvedValue(mockRun);

      eventLogRepo.find.mockResolvedValue([
        {
          id: 1,
          eventId: 'tx1-0',
          pagingToken: '105-tx1',
          contractId: mockContractId,
          eventType: 'PayoutClaimed' as any,
          ledger: 105,
          txHash: 'txhash-claim-99',
          txOrder: 0,
          eventData: {
            callId: 'call-1',
            stakerAddress: 'GUSER123',
            amount: '500',
          },
          timestamp: new Date(),
          createdAt: new Date(),
        },
      ]);

      payoutClaimRepo.findOne.mockResolvedValue(null); // Missing in Postgres

      const completedRun = await service.executeRun('run-repair-1');

      expect(completedRun.status).toBe(ReconciliationRunStatus.COMPLETED);
      expect(completedRun.discrepancyCount).toBe(1);
      expect(completedRun.repairedCount).toBe(1);
      expect(completedRun.quarantinedCount).toBe(0);

      expect(discrepancyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          discrepancyType: DiscrepancyType.MISSING_OFFCHAIN,
          status: DiscrepancyStatus.REPAIRED,
        }),
      );
    });

    it('should be idempotent on rerun - no duplicate repairs or duplicate discrepancies', async () => {
      const mockRun: ReconciliationRun = {
        id: 'run-rerun-2',
        network: 'testnet',
        contractIds: [mockContractId],
        fromLedger: 100,
        toLedger: 200,
        isDryRun: false,
        status: ReconciliationRunStatus.PENDING,
        scannedEventsCount: 0,
        discrepancyCount: 0,
        repairedCount: 0,
        quarantinedCount: 0,
        discrepancyBreakdown: null,
        durationMs: null,
        failureReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      runRepo.findOne.mockResolvedValue(mockRun);

      eventLogRepo.find.mockResolvedValue([
        {
          id: 1,
          eventId: 'tx1-0',
          pagingToken: '105-tx1',
          contractId: mockContractId,
          eventType: 'PayoutClaimed' as any,
          ledger: 105,
          txHash: 'txhash-claim-99',
          txOrder: 0,
          eventData: {
            callId: 'call-1',
            stakerAddress: 'GUSER123',
            amount: '500',
          },
          timestamp: new Date(),
          createdAt: new Date(),
        },
      ]);

      // Record is now CLAIMED in Postgres (repaired in previous run)
      payoutClaimRepo.findOne.mockResolvedValue({
        id: 'claim-1',
        callId: 'call-1',
        stakerAddress: 'GUSER123',
        amount: '500',
        status: PayoutClaimStatus.CLAIMED,
      } as any);

      const completedRun = await service.executeRun('run-rerun-2');

      expect(completedRun.scannedEventsCount).toBe(1);
      expect(completedRun.discrepancyCount).toBe(0);
      expect(completedRun.repairedCount).toBe(0);
    });
  });

  describe('Admin Queries', () => {
    it('should return paginated runs', async () => {
      runRepo.findAndCount.mockResolvedValue([[{ id: 'run-1' } as any], 1]);
      const result = await service.getRuns({ page: 1, limit: 10 });
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('should return paginated discrepancies', async () => {
      discrepancyRepo.findAndCount.mockResolvedValue([
        [{ id: 'disc-1' } as any],
        1,
      ]);
      const result = await service.getDiscrepancies({ page: 1, limit: 10 });
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });
});

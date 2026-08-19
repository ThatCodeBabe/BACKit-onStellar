import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_RECONCILIATION } from '../common/queues/queues.constants';
import { ReconciliationService } from './reconciliation.service';

export interface ReconciliationJobData {
  runId: string;
}

@Processor(QUEUE_RECONCILIATION)
export class ReconciliationProcessor extends WorkerHost {
  private readonly logger = new Logger(ReconciliationProcessor.name);

  constructor(private readonly reconciliationService: ReconciliationService) {
    super();
  }

  async process(job: Job<ReconciliationJobData>): Promise<void> {
    const { runId } = job.data;
    this.logger.log(`Processing reconciliation job for runId=${runId}`);
    try {
      await this.reconciliationService.executeRun(runId);
      this.logger.log(`Reconciliation job completed for runId=${runId}`);
    } catch (err: any) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      this.logger.error(
        `Reconciliation job failed for runId=${runId}: ${err.message}`,
      );
      throw err;
    }
  }
}

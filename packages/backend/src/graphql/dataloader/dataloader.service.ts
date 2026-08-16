import { Injectable, Scope } from '@nestjs/common';
import DataLoader from 'dataloader';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Users } from '../../user/entities/users.entity';
import { Stake } from '../../stakes/entities/stake.entity';

/**
 * DataLoaderService — REQUEST-scoped so each GraphQL request gets its own
 * loaders, preventing cross-request cache pollution.
 *
 * Provides:
 *  - `userLoader`  — batch-loads Users by walletAddress
 *  - `stakeLoader` — batch-loads Stake[] by callId
 */
@Injectable({ scope: Scope.REQUEST })
export class DataLoaderService {
  /** Batch-loads users by wallet address. Returns `null` for unknown addresses. */
  readonly userLoader: DataLoader<string, Users | null>;

  /** Batch-loads all stakes for a set of call IDs. */
  readonly stakeLoader: DataLoader<string, Stake[]>;

  constructor(
    @InjectRepository(Users)
    private readonly usersRepo: Repository<Users>,
    @InjectRepository(Stake)
    private readonly stakesRepo: Repository<Stake>,
  ) {
    this.userLoader = new DataLoader<string, Users | null>(
      async (addresses: readonly string[]) => {
        const users = await this.usersRepo.find({
          where: { walletAddress: In([...addresses]) },
        });

        // Build a map for O(1) lookup keyed by walletAddress
        const map = new Map<string, Users>(
          users.map((u) => [u.walletAddress, u]),
        );

        return addresses.map((addr) => map.get(addr) ?? null);
      },
      {
        // Cache within a single request; cleared when the scope is destroyed
        cache: true,
      },
    );

    this.stakeLoader = new DataLoader<string, Stake[]>(
      async (callIds: readonly string[]) => {
        const stakes = await this.stakesRepo.find({
          where: { callId: In([...callIds]) },
          order: { createdAt: 'DESC' },
        });

        // Group by callId
        const map = new Map<string, Stake[]>();
        for (const stake of stakes) {
          const group = map.get(stake.callId) ?? [];
          group.push(stake);
          map.set(stake.callId, group);
        }

        return callIds.map((id) => map.get(id) ?? []);
      },
      {
        cache: true,
      },
    );
  }
}

import { Resolver, Query, Args, Int, ObjectType, Field, Float } from '@nestjs/graphql';
import { LeaderboardService } from '../../leaderboard/leaderboard.service';
import { LeaderboardType } from '../types/leaderboard.type';
import { PaginationInput } from '../types/pagination.type';
import { LeaderboardPeriod } from '../enums/leaderboard-period.enum';
import {
  LeaderboardSort,
  LeaderboardTimeframe,
} from '../../leaderboard/leaderboard.dto';

/** Paginated leaderboard response */
@ObjectType('LeaderboardPage')
class LeaderboardPage {
  @Field(() => [LeaderboardType])
  data: LeaderboardType[];

  @Field(() => Int)
  total: number;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  limit: number;

  @Field(() => Int)
  pages: number;

  @Field()
  period: string;
}

/** Map from GraphQL enum to service DTO enum */
function mapPeriod(period: LeaderboardPeriod): LeaderboardTimeframe {
  switch (period) {
    case LeaderboardPeriod.WEEKLY:
    case LeaderboardPeriod.MONTHLY:
      return LeaderboardTimeframe.MONTH;
    case LeaderboardPeriod.ALL_TIME:
    default:
      return LeaderboardTimeframe.ALL;
  }
}

@Resolver()
export class LeaderboardResolver {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  /**
   * `Query.leaderboard(period, pagination)` — returns ranked leaderboard
   * entries for the requested time period.
   *
   * - `WEEKLY`   → past 7 days  (maps to service `month` period)
   * - `MONTHLY`  → past 30 days (maps to service `month` period)
   * - `ALL_TIME` → all-time     (maps to service `all` period)
   */
  @Query(() => LeaderboardPage, {
    name: 'leaderboard',
    description: 'Ranked list of top predictors for a given time period',
    complexity: ({ childComplexity, args }) =>
      (args.pagination?.limit ?? 20) * childComplexity,
  })
  async getLeaderboard(
    @Args('period', {
      type: () => LeaderboardPeriod,
      defaultValue: LeaderboardPeriod.ALL_TIME,
    })
    period: LeaderboardPeriod,
    @Args('pagination', { nullable: true }) pagination?: PaginationInput,
  ): Promise<LeaderboardPage> {
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 20;

    const result = await this.leaderboardService.getLeaderboard({
      sort: LeaderboardSort.PROFIT,
      timeframe: mapPeriod(period),
      page,
      limit,
    });

    return {
      data: result.data as unknown as LeaderboardType[],
      total: result.total,
      page: result.page,
      limit: result.limit,
      pages: result.pages,
      period,
    };
  }
}

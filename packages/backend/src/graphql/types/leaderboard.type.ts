import { ObjectType, Field, ID, Int, Float } from '@nestjs/graphql';

/**
 * GraphQL representation of `LeaderboardSnapshot`.
 * Mirrors `src/leaderboard/leaderboard.entity.ts`.
 */
@ObjectType('LeaderboardEntry')
export class LeaderboardType {
  @Field(() => ID)
  id: string;

  @Field()
  userId: string;

  @Field()
  username: string;

  @Field({ nullable: true })
  avatarUrl?: string;

  @Field(() => Int)
  totalCalls: number;

  @Field(() => Int)
  wonCalls: number;

  @Field(() => Int)
  lostCalls: number;

  @Field(() => Float, { description: 'Win rate as a percentage (0-100)' })
  winRate: number;

  @Field(() => Float, { description: 'Net USDC profit' })
  totalProfit: number;

  @Field(() => Int)
  rank: number;

  @Field({ description: 'Period identifier: all | month' })
  period: string;

  @Field()
  snapshotDate: Date;

  @Field()
  createdAt: Date;
}

/**
 * Paginated leaderboard response.
 */
@ObjectType('LeaderboardResponse')
export class LeaderboardResponseType {
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
  generatedAt: Date;
}

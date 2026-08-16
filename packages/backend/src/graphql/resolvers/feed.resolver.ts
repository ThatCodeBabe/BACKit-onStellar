import { Resolver, Query, Args, Context } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { CallsService } from '../../calls/calls.service';
import { CallType } from '../types/call.type';
import { PaginationInput } from '../types/pagination.type';
import { FeedType } from '../enums/feed-type.enum';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

/** GraphQL context carrying the authenticated user (if any). */
interface GqlContext {
  req: { user?: { address: string } };
}

@Resolver()
export class FeedResolver {
  constructor(private readonly callsService: CallsService) {}

  /**
   * `Query.feed(type, pagination)` — returns a list of prediction calls for
   * the requested feed type.
   *
   * - `FOR_YOU`   → algorithmic / general trending feed (public)
   * - `FOLLOWING` → calls from users the authenticated user follows (auth required)
   * - `TRENDING`  → trending calls ordered by engagement score (public)
   */
  @UseGuards(OptionalJwtAuthGuard)
  @Query(() => [CallType], {
    name: 'feed',
    description:
      'Social feed of prediction calls — FOR_YOU, FOLLOWING, or TRENDING',
    complexity: ({ childComplexity, args }) =>
      (args.pagination?.limit ?? 20) * childComplexity,
  })
  async getFeed(
    @Args('type', { type: () => FeedType, defaultValue: FeedType.FOR_YOU })
    type: FeedType,
    @Args('pagination', { nullable: true }) pagination?: PaginationInput,
    @Context() ctx?: GqlContext,
  ): Promise<CallType[]> {
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 20;

    switch (type) {
      case FeedType.FOLLOWING: {
        const address = ctx?.req?.user?.address;
        if (!address) {
          // Unauthenticated users get an empty following feed
          return [];
        }
        const result = await this.callsService.getFollowingFeed(address, {
          page,
          limit,
        });
        return result.data as unknown as CallType[];
      }

      case FeedType.TRENDING:
      case FeedType.FOR_YOU:
      default: {
        const result = await this.callsService.getFeed({ page, limit });
        return result.data as unknown as CallType[];
      }
    }
  }
}

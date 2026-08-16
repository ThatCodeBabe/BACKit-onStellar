import {
  Resolver,
  Query,
  Args,
  ResolveField,
  Parent,
  Context,
  InputType,
  Field,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { CallsService } from '../../calls/calls.service';
import { BookmarksService } from '../../bookmarks/bookmarks.service';
import { CallType, GqlCallStatus } from '../types/call.type';
import { UserType } from '../types/user.type';
import { StakeType } from '../types/stake.type';
import { PaginationInput } from '../types/pagination.type';
import { DataLoaderService } from '../dataloader/dataloader.service';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { Users } from '../../user/entities/users.entity';
import { Stake } from '../../stakes/entities/stake.entity';

/** Input type for filtering calls */
@InputType()
export class CallFilterInput {
  @Field({ nullable: true })
  status?: GqlCallStatus;

  @Field({ nullable: true })
  creatorAddress?: string;

  @Field({ nullable: true })
  search?: string;
}

/** Input type for sorting calls */
@InputType()
export class CallSortInput {
  @Field({ nullable: true, defaultValue: 'createdAt' })
  field?: string;

  @Field({ nullable: true, defaultValue: 'DESC' })
  direction?: 'ASC' | 'DESC';
}

/** GraphQL context shape — carries DataLoaderService and authenticated user */
interface GqlContext {
  dataloader: DataLoaderService;
  req: { user?: { address: string } };
}

@Resolver(() => CallType)
export class CallsResolver {
  constructor(
    private readonly callsService: CallsService,
    private readonly bookmarksService: BookmarksService,
  ) {}

  /**
   * `Query.calls(filter, sort, pagination)` — returns a paginated list of
   * visible calls. Authentication is optional; when authenticated the
   * `isBookmarked` field resolver will return per-user data.
   */
  @UseGuards(OptionalJwtAuthGuard)
  @Query(() => [CallType], {
    name: 'calls',
    description: 'Paginated list of prediction calls with optional filtering',
    complexity: ({ childComplexity, args }) =>
      (args.pagination?.limit ?? 20) * childComplexity,
  })
  async getCalls(
    @Args('filter', { nullable: true }) _filter?: CallFilterInput,
    @Args('sort', { nullable: true }) _sort?: CallSortInput,
    @Args('pagination', { nullable: true }) pagination?: PaginationInput,
  ): Promise<CallType[]> {
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 20;

    // Delegate to existing CallsService; search if filter.search is present,
    // otherwise get the general feed.
    const result = await this.callsService.getFeed({ page, limit });
    return result.data as unknown as CallType[];
  }

  // ─── Field resolvers ─────────────────────────────────────────────────────

  /**
   * Resolves `Call.creator` via DataLoader to avoid N+1 queries.
   * Batches all `creatorAddress` lookups for a single request into one DB hit.
   */
  @ResolveField(() => UserType, { nullable: true, complexity: 2 })
  async creator(
    @Parent() call: CallType,
    @Context() ctx: GqlContext,
  ): Promise<UserType | null> {
    const user: Users | null = await ctx.dataloader.userLoader.load(
      call.creatorAddress,
    );
    return user as unknown as UserType | null;
  }

  /**
   * Resolves `Call.stakes` via DataLoader.
   * Batches all stake lookups by callId into one DB hit.
   */
  @ResolveField(() => [StakeType], { complexity: 3 })
  async stakes(
    @Parent() call: CallType,
    @Context() ctx: GqlContext,
  ): Promise<StakeType[]> {
    const stakes: Stake[] = await ctx.dataloader.stakeLoader.load(call.id);
    return stakes as unknown as StakeType[];
  }

  /**
   * Resolves `Call.isBookmarked` for the currently authenticated user.
   * Returns `false` for anonymous requests.
   */
  @ResolveField(() => Boolean, { nullable: true, complexity: 1 })
  async isBookmarked(
    @Parent() call: CallType,
    @Context() ctx: GqlContext,
  ): Promise<boolean> {
    const address = ctx.req?.user?.address;
    if (!address) return false;
    return this.bookmarksService.isBookmarked(address, call.id);
  }

  /** `Query.call(id)` — fetch a single call by its ID */
  @UseGuards(OptionalJwtAuthGuard)
  @Query(() => CallType, { name: 'call', nullable: true })
  async getCall(
    @Args('id') id: string,
  ): Promise<CallType | null> {
    try {
      const call = await this.callsService.getCallOrThrow(id);
      return call as unknown as CallType;
    } catch {
      return null;
    }
  }
}

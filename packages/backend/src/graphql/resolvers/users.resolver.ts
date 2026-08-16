import {
  Resolver,
  Query,
  Args,
  ResolveField,
  Parent,
  Int,
  ObjectType,
  Field,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { UsersService } from '../../user/users.service';
import { UserType } from '../types/user.type';
import { PaginationInput } from '../types/pagination.type';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

/** Paginated list of follower/following users */
@ObjectType('UserPage')
class UserPage {
  @Field(() => [UserType])
  data: UserType[];

  @Field(() => Int)
  total: number;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  limit: number;
}

@Resolver(() => UserType)
export class UsersResolver {
  constructor(private readonly usersService: UsersService) {}

  /**
   * `Query.user(address)` — returns the public profile for a wallet address.
   * Authentication is optional; when authenticated the caller can request
   * sensitive fields.
   */
  @UseGuards(OptionalJwtAuthGuard)
  @Query(() => UserType, {
    name: 'user',
    nullable: true,
    description: "Fetch a user's public profile by wallet address",
  })
  async getUser(@Args('address') address: string): Promise<UserType | null> {
    try {
      const user = await this.usersService.getUserByAddress(address);
      return user as unknown as UserType;
    } catch {
      return null;
    }
  }

  /**
   * `Query.me` — returns the authenticated caller's own profile.
   */
  @UseGuards(JwtAuthGuard)
  @Query(() => UserType, {
    name: 'me',
    nullable: true,
    description: "Returns the authenticated caller's own profile",
  })
  async getMe(@CurrentUser() address: string): Promise<UserType | null> {
    if (!address) return null;
    try {
      const user = await this.usersService.getUserByAddress(address);
      return user as unknown as UserType;
    } catch {
      return null;
    }
  }

  // ─── Field resolvers ─────────────────────────────────────────────────────

  /**
   * `User.followers(pagination)` — paginated list of users following this user.
   */
  @ResolveField(() => UserPage, {
    name: 'followers',
    nullable: true,
    description: 'Paginated list of users who follow this user',
    complexity: ({ childComplexity, args }) =>
      (args.pagination?.limit ?? 20) * childComplexity,
  })
  async followers(
    @Parent() user: UserType,
    @Args('pagination', { nullable: true }) pagination?: PaginationInput,
  ): Promise<UserPage> {
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 20;
    const result = await this.usersService.getFollowers(
      user.walletAddress,
      page,
      limit,
    );
    // result.data contains Follow entities; map to minimal UserType objects
    const data = result.data.map((f) => ({
      id: '',
      walletAddress: (f as unknown as { followerAddress: string })
        .followerAddress,
      currentWinStreak: 0,
      bestWinStreak: 0,
      banned: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as unknown as UserType[];

    return { data, total: result.total, page: result.page, limit: result.limit };
  }

  /**
   * `User.following(pagination)` — paginated list of users this user follows.
   */
  @ResolveField(() => UserPage, {
    name: 'following',
    nullable: true,
    description: 'Paginated list of users this user follows',
    complexity: ({ childComplexity, args }) =>
      (args.pagination?.limit ?? 20) * childComplexity,
  })
  async following(
    @Parent() user: UserType,
    @Args('pagination', { nullable: true }) pagination?: PaginationInput,
  ): Promise<UserPage> {
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 20;
    const result = await this.usersService.getFollowing(
      user.walletAddress,
      page,
      limit,
    );
    const data = result.data.map((f) => ({
      id: '',
      walletAddress: (f as unknown as { followingAddress: string })
        .followingAddress,
      currentWinStreak: 0,
      bestWinStreak: 0,
      banned: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as unknown as UserType[];

    return { data, total: result.total, page: result.page, limit: result.limit };
  }
}

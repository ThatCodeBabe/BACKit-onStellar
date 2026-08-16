import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

/**
 * GraphQL representation of the `Users` entity.
 * Mirrors `src/user/entities/users.entity.ts` for code-first schema generation.
 */
@ObjectType('User')
export class UserType {
  @Field(() => ID)
  id: string;

  @Field()
  walletAddress: string;

  @Field({ nullable: true })
  email?: string;

  @Field({ nullable: true })
  referralCode?: string;

  @Field({ nullable: true })
  displayName?: string;

  @Field({ nullable: true })
  bio?: string;

  /** IPFS CID of avatar image. Resolve to a full URL client-side. */
  @Field({ nullable: true })
  avatarCid?: string;

  @Field(() => Int)
  currentWinStreak: number;

  @Field(() => Int)
  bestWinStreak: number;

  @Field()
  banned: boolean;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;

  // ─── virtual / resolved fields ────────────────────────────────────────────
  // `followers` and `following` are resolved by the UsersResolver field resolvers.
  // They are declared here for the schema but their data comes from the DB at
  // resolve time, so they are typed as optional arrays on the ObjectType.

  @Field({ nullable: true })
  followerCount?: number;

  @Field({ nullable: true })
  followingCount?: number;
}

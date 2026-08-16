import {
  ObjectType,
  Field,
  ID,
  Int,
  Float,
  registerEnumType,
} from '@nestjs/graphql';
import { UserType } from './user.type';
import { StakeType } from './stake.type';

/** Mirror of `CallStatus` from `src/calls/entities/call.entity.ts` */
export enum GqlCallStatus {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  PAUSED = 'PAUSED',
  SETTLING = 'SETTLING',
  RESOLVED_YES = 'RESOLVED_YES',
  RESOLVED_NO = 'RESOLVED_NO',
}

registerEnumType(GqlCallStatus, {
  name: 'CallStatus',
  description: 'Lifecycle status of a prediction call/market',
});

/**
 * GraphQL representation of the `Call` entity.
 * Mirrors `src/calls/entities/call.entity.ts` for code-first schema generation.
 *
 * Field resolvers for `creator`, `stakes`, and `isBookmarked` are implemented
 * in `CallsResolver`.
 */
@ObjectType('Call')
export class CallType {
  @Field(() => ID)
  id: string;

  @Field()
  title: string;

  @Field({ nullable: true })
  description?: string;

  @Field()
  creatorAddress: string;

  @Field(() => GqlCallStatus)
  status: GqlCallStatus;

  @Field()
  isHidden: boolean;

  @Field(() => Int)
  reportCount: number;

  @Field({ nullable: true })
  endsAt?: Date;

  @Field({ nullable: true })
  resolvedAt?: Date;

  @Field({ nullable: true })
  finalPrice?: string;

  @Field()
  totalYesStake: string;

  @Field()
  totalNoStake: string;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;

  // ─── resolved / virtual fields ────────────────────────────────────────────
  // These are populated by field resolvers in CallsResolver.

  @Field(() => UserType, {
    nullable: true,
    description: 'The user who created this call, resolved via DataLoader',
    complexity: 2,
  })
  creator?: UserType;

  @Field(() => [StakeType], {
    nullable: true,
    description: 'All stakes placed on this call',
    complexity: 3,
  })
  stakes?: StakeType[];

  @Field({
    nullable: true,
    description:
      'Whether the currently authenticated user has bookmarked this call',
    complexity: 1,
  })
  isBookmarked?: boolean;
}

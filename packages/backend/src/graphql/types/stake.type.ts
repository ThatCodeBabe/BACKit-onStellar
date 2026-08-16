import { ObjectType, Field, ID, Float } from '@nestjs/graphql';

/**
 * GraphQL representation of the `Stake` entity.
 * Mirrors `src/stakes/entities/stake.entity.ts`.
 */
@ObjectType('Stake')
export class StakeType {
  @Field(() => ID)
  id: string;

  @Field()
  userAddress: string;

  @Field()
  callId: string;

  @Field(() => Float)
  amount: number;

  @Field()
  createdAt: Date;
}

import { ObjectType, Field, ID, Float, registerEnumType } from '@nestjs/graphql';

/** Mirror of `AlertDirection` from `src/alerts/alerts.entity.ts` */
export enum GqlAlertDirection {
  ABOVE = 'ABOVE',
  BELOW = 'BELOW',
}

registerEnumType(GqlAlertDirection, {
  name: 'AlertDirection',
  description: 'Whether the alert fires when price goes above or below target',
});

/**
 * GraphQL representation of the `PriceAlert` entity.
 * Mirrors `src/alerts/alerts.entity.ts`.
 */
@ObjectType('PriceAlert')
export class PriceAlertType {
  @Field(() => ID)
  id: string;

  @Field()
  userAddress: string;

  @Field()
  callId: string;

  @Field()
  tokenPair: string;

  @Field(() => Float)
  targetPrice: number;

  @Field(() => GqlAlertDirection)
  direction: GqlAlertDirection;

  @Field()
  triggered: boolean;

  @Field()
  createdAt: Date;
}

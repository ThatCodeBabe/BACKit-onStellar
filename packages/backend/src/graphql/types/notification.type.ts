import { ObjectType, Field, ID, registerEnumType } from '@nestjs/graphql';

/** Mirror of `NotificationType` enum from the notifications module */
export enum GqlNotificationType {
  BACKED_CALL = 'BACKED_CALL',
  CALL_ENDED = 'CALL_ENDED',
  PAYOUT_READY = 'PAYOUT_READY',
  NEW_FOLLOWER = 'NEW_FOLLOWER',
  CALL_RESOLVED = 'CALL_RESOLVED',
  STAKE_UPDATE = 'STAKE_UPDATE',
  CALL_CLOSING = 'CALL_CLOSING',
  PRICE_ALERT_TRIGGERED = 'PRICE_ALERT_TRIGGERED',
}

registerEnumType(GqlNotificationType, {
  name: 'NotificationType',
  description: 'Category of in-app notification',
});

/** Mirror of `DispatchType` enum */
export enum GqlDispatchType {
  EMAIL = 'email',
  WEBHOOK = 'webhook',
  NONE = 'none',
}

registerEnumType(GqlDispatchType, {
  name: 'DispatchType',
  description: 'External dispatch channel for a notification',
});

/**
 * GraphQL representation of `NotificationEntity`.
 * Mirrors `src/notifications/notification.entity.ts`.
 */
@ObjectType('Notification')
export class NotificationType {
  @Field(() => ID)
  id: number;

  @Field()
  userId: string;

  @Field(() => GqlNotificationType)
  type: GqlNotificationType;

  @Field({ nullable: true })
  referenceId?: string;

  @Field()
  message: string;

  @Field()
  readStatus: boolean;

  @Field()
  isDispatched: boolean;

  @Field()
  inApp: boolean;

  @Field(() => GqlDispatchType)
  dispatchType: GqlDispatchType;

  @Field({ nullable: true })
  dispatchError?: string;

  @Field()
  createdAt: Date;
}

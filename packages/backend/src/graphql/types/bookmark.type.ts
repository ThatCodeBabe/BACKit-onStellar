import { ObjectType, Field, ID } from '@nestjs/graphql';
import { CallType } from './call.type';

/**
 * GraphQL representation of the `Bookmark` entity.
 * Mirrors `src/bookmarks/bookmarks.entity.ts`.
 */
@ObjectType('Bookmark')
export class BookmarkType {
  @Field(() => ID)
  id: string;

  @Field()
  userAddress: string;

  @Field()
  callId: string;

  @Field(() => CallType, {
    nullable: true,
    description: 'The bookmarked call, resolved on demand',
    complexity: 2,
  })
  call?: CallType;

  @Field()
  createdAt: Date;
}

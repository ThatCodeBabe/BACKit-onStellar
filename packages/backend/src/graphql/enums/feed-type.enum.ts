import { registerEnumType } from '@nestjs/graphql';

export enum FeedType {
  FOR_YOU = 'FOR_YOU',
  FOLLOWING = 'FOLLOWING',
  TRENDING = 'TRENDING',
}

registerEnumType(FeedType, {
  name: 'FeedType',
  description: 'Type of social feed to query',
  valuesMap: {
    FOR_YOU: { description: 'Algorithmic feed of recommended calls' },
    FOLLOWING: { description: 'Calls from users you follow' },
    TRENDING: { description: 'Trending calls by engagement' },
  },
});

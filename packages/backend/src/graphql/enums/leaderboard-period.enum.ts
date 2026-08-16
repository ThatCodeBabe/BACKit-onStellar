import { registerEnumType } from '@nestjs/graphql';

export enum LeaderboardPeriod {
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  ALL_TIME = 'ALL_TIME',
}

registerEnumType(LeaderboardPeriod, {
  name: 'LeaderboardPeriod',
  description: 'Time period for leaderboard ranking',
  valuesMap: {
    WEEKLY: { description: 'Rankings for the past 7 days' },
    MONTHLY: { description: 'Rankings for the past 30 days' },
    ALL_TIME: { description: 'All-time rankings' },
  },
});

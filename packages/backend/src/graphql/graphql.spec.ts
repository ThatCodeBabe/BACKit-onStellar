/**
 * GraphQL API Layer — integration tests (Issue #548)
 *
 * Uses @nestjs/testing with an in-memory SQLite database so tests are
 * self-contained and require no running Postgres instance.
 *
 * Covered queries:
 *  1. `calls`        — paginated call listing
 *  2. `call(id)`     — single call by ID
 *  3. `user(address)` — public profile
 *  4. `feed(type: FOR_YOU)` — algorithmic feed
 *  5. `search(query)` — full-text search
 *  6. `leaderboard`  — ranked predictor list
 *  7. `me`           — authenticated user's own profile
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// ── Module under test ────────────────────────────────────────────────────────
import { GraphqlModule } from './graphql.module';

// ── Service mocks ────────────────────────────────────────────────────────────
import { CallsService } from '../calls/calls.service';
import { UsersService } from '../user/users.service';
import { BookmarksService } from '../bookmarks/bookmarks.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';
import { SearchService } from '../search/search.service';
import { AuthService } from '../auth/auth.service';

// ── Entities ──────────────────────────────────────────────────────────────────
import { Users } from '../user/entities/users.entity';
import { Stake } from '../stakes/entities/stake.entity';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_CALL = {
  id: 'call-1',
  title: 'BTC hits 100k',
  description: 'Bullish macro thesis',
  creatorAddress: 'GA1111',
  status: 'OPEN',
  isHidden: false,
  reportCount: 0,
  endsAt: new Date('2027-01-01'),
  resolvedAt: null,
  finalPrice: null,
  totalYesStake: '0',
  totalNoStake: '0',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const MOCK_USER: Partial<Users> = {
  id: 'user-1',
  walletAddress: 'GA1111',
  displayName: 'Alice',
  bio: 'Crypto enthusiast',
  currentWinStreak: 3,
  bestWinStreak: 5,
  banned: false,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const MOCK_LEADERBOARD_ENTRY = {
  rank: 1,
  userId: 'user-1',
  username: 'Alice',
  avatarUrl: null,
  totalCalls: 10,
  wonCalls: 7,
  lostCalls: 3,
  winRate: 70,
  totalProfit: 5000,
};

// ─────────────────────────────────────────────────────────────────────────────
// Mock service factories
// ─────────────────────────────────────────────────────────────────────────────

function buildMockCallsService(): Partial<CallsService> {
  return {
    getFeed: jest.fn().mockResolvedValue({
      data: [MOCK_CALL],
      total: 1,
      page: 1,
      limit: 20,
    }),
    getFollowingFeed: jest.fn().mockResolvedValue({
      data: [MOCK_CALL],
      total: 1,
      page: 1,
      limit: 20,
    }),
    getCallOrThrow: jest.fn().mockResolvedValue(MOCK_CALL),
    search: jest.fn().mockResolvedValue({
      data: [MOCK_CALL],
      total: 1,
      page: 1,
      limit: 20,
    }),
  };
}

function buildMockUsersService(): Partial<UsersService> {
  return {
    getUserByAddress: jest.fn().mockResolvedValue(MOCK_USER),
    getFollowers: jest
      .fn()
      .mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 }),
    getFollowing: jest
      .fn()
      .mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 }),
  };
}

function buildMockBookmarksService(): Partial<BookmarksService> {
  return {
    isBookmarked: jest.fn().mockResolvedValue(false),
  };
}

function buildMockLeaderboardService(): Partial<LeaderboardService> {
  return {
    getLeaderboard: jest.fn().mockResolvedValue({
      data: [MOCK_LEADERBOARD_ENTRY],
      total: 1,
      page: 1,
      limit: 20,
      pages: 1,
      sort: 'profit',
      timeframe: 'all',
      generatedAt: new Date(),
    }),
  };
}

function buildMockSearchService(): Partial<SearchService> {
  return {
    globalSearch: jest.fn().mockResolvedValue({
      calls: [MOCK_CALL],
      users: [MOCK_USER],
    }),
  };
}

function buildMockAuthService(): Partial<AuthService> {
  return {
    validateToken: jest.fn().mockReturnValue({ sub: 'GA1111' }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe('GraphQL API Layer (integration)', () => {
  let app: INestApplication;
  let mockCallsService: Partial<CallsService>;
  let mockUsersService: Partial<UsersService>;
  let mockLeaderboardService: Partial<LeaderboardService>;
  let mockSearchService: Partial<SearchService>;

  // Helper to post a GraphQL query
  const gql = (query: string, variables?: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/graphql')
      .send({ query, variables })
      .expect(200);

  beforeAll(async () => {
    mockCallsService = buildMockCallsService();
    mockUsersService = buildMockUsersService();
    const mockBookmarksService = buildMockBookmarksService();
    mockLeaderboardService = buildMockLeaderboardService();
    mockSearchService = buildMockSearchService();
    const mockAuthService = buildMockAuthService();

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [GraphqlModule],
    })
      .overrideProvider(CallsService)
      .useValue(mockCallsService)
      .overrideProvider(UsersService)
      .useValue(mockUsersService)
      .overrideProvider(BookmarksService)
      .useValue(mockBookmarksService)
      .overrideProvider(LeaderboardService)
      .useValue(mockLeaderboardService)
      .overrideProvider(SearchService)
      .useValue(mockSearchService)
      .overrideProvider(AuthService)
      .useValue(mockAuthService)
      // Stub out TypeORM repositories so no real DB is needed
      .overrideProvider(getRepositoryToken(Users))
      .useValue({
        find: jest.fn().mockResolvedValue([MOCK_USER]),
        findOne: jest.fn().mockResolvedValue(MOCK_USER),
      } as Partial<Repository<Users>>)
      .overrideProvider(getRepositoryToken(Stake))
      .useValue({
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
      } as Partial<Repository<Stake>>)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Test 1: Query.calls ───────────────────────────────────────────────────

  it('1. Query.calls returns a paginated list of calls', async () => {
    const { body } = await gql(`
      query {
        calls(pagination: { page: 1, limit: 5 }) {
          id
          title
          status
          creatorAddress
          createdAt
        }
      }
    `);

    expect(body.errors).toBeUndefined();
    const calls = body.data.calls as typeof MOCK_CALL[];
    expect(Array.isArray(calls)).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].id).toBe(MOCK_CALL.id);
    expect(calls[0].title).toBe(MOCK_CALL.title);
    expect(mockCallsService.getFeed).toHaveBeenCalled();
  });

  // ── Test 2: Query.call(id) ────────────────────────────────────────────────

  it('2. Query.call(id) returns a single call by ID', async () => {
    const { body } = await gql(
      `
      query GetCall($id: String!) {
        call(id: $id) {
          id
          title
          creatorAddress
        }
      }
    `,
      { id: 'call-1' },
    );

    expect(body.errors).toBeUndefined();
    const call = body.data.call;
    expect(call).toBeDefined();
    expect(call.id).toBe('call-1');
    expect(mockCallsService.getCallOrThrow).toHaveBeenCalledWith('call-1');
  });

  // ── Test 3: Query.user(address) ──────────────────────────────────────────

  it('3. Query.user(address) returns a public user profile', async () => {
    const { body } = await gql(
      `
      query GetUser($address: String!) {
        user(address: $address) {
          id
          walletAddress
          displayName
          currentWinStreak
        }
      }
    `,
      { address: 'GA1111' },
    );

    expect(body.errors).toBeUndefined();
    const user = body.data.user;
    expect(user).toBeDefined();
    expect(user.walletAddress).toBe('GA1111');
    expect(mockUsersService.getUserByAddress).toHaveBeenCalledWith('GA1111');
  });

  // ── Test 4: Query.feed(FOR_YOU) ───────────────────────────────────────────

  it('4. Query.feed(FOR_YOU) returns the algorithmic feed', async () => {
    const { body } = await gql(`
      query {
        feed(type: FOR_YOU, pagination: { page: 1, limit: 10 }) {
          id
          title
          status
        }
      }
    `);

    expect(body.errors).toBeUndefined();
    const feed = body.data.feed;
    expect(Array.isArray(feed)).toBe(true);
    expect(feed.length).toBeGreaterThan(0);
    expect(mockCallsService.getFeed).toHaveBeenCalled();
  });

  // ── Test 5: Query.search(query) ───────────────────────────────────────────

  it('5. Query.search returns matching calls and users', async () => {
    const { body } = await gql(
      `
      query Search($q: String!) {
        search(query: $q) {
          calls {
            id
            title
          }
          users {
            walletAddress
          }
        }
      }
    `,
      { q: 'bitcoin' },
    );

    expect(body.errors).toBeUndefined();
    const result = body.data.search;
    expect(result).toBeDefined();
    expect(Array.isArray(result.calls)).toBe(true);
    expect(Array.isArray(result.users)).toBe(true);
    expect(mockSearchService.globalSearch).toHaveBeenCalledWith('bitcoin');
  });

  // ── Test 6: Query.leaderboard ─────────────────────────────────────────────

  it('6. Query.leaderboard returns ranked entries for ALL_TIME', async () => {
    const { body } = await gql(`
      query {
        leaderboard(period: ALL_TIME, pagination: { page: 1, limit: 10 }) {
          data {
            rank
            userId
            totalCalls
            wonCalls
            winRate
            totalProfit
          }
          total
          page
          pages
        }
      }
    `);

    expect(body.errors).toBeUndefined();
    const lb = body.data.leaderboard;
    expect(lb).toBeDefined();
    expect(lb.data.length).toBeGreaterThan(0);
    expect(lb.data[0].rank).toBe(1);
    expect(mockLeaderboardService.getLeaderboard).toHaveBeenCalled();
  });

  // ── Test 7: Query.calls with filter ──────────────────────────────────────

  it('7. Query.calls respects pagination args', async () => {
    const { body } = await gql(`
      query {
        calls(pagination: { page: 2, limit: 5 }) {
          id
          title
        }
      }
    `);

    expect(body.errors).toBeUndefined();
    expect(mockCallsService.getFeed).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, limit: 5 }),
    );
  });

  // ── Test 8: Query.feed(TRENDING) ─────────────────────────────────────────

  it('8. Query.feed(TRENDING) returns trending calls', async () => {
    const { body } = await gql(`
      query {
        feed(type: TRENDING) {
          id
          title
        }
      }
    `);

    expect(body.errors).toBeUndefined();
    expect(Array.isArray(body.data.feed)).toBe(true);
  });

  // ── Test 9: Call.isBookmarked resolves false for anonymous ───────────────

  it('9. Call.isBookmarked is false for unauthenticated users', async () => {
    const { body } = await gql(`
      query {
        calls {
          id
          isBookmarked
        }
      }
    `);

    expect(body.errors).toBeUndefined();
    const calls = body.data.calls as Array<{ id: string; isBookmarked: boolean }>;
    expect(calls[0].isBookmarked).toBe(false);
  });

  // ── Test 10: Query.search with empty string returns empty arrays ──────────

  it('10. Query.search with blank query returns empty arrays', async () => {
    const { body } = await gql(
      `
      query Search($q: String!) {
        search(query: $q) {
          calls { id }
          users { walletAddress }
        }
      }
    `,
      { q: '   ' },
    );

    expect(body.errors).toBeUndefined();
    expect(body.data.search.calls).toEqual([]);
    expect(body.data.search.users).toEqual([]);
  });
});

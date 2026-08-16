import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';

// ── Resolvers ────────────────────────────────────────────────────────────────
import { CallsResolver } from './resolvers/calls.resolver';
import { UsersResolver } from './resolvers/users.resolver';
import { FeedResolver } from './resolvers/feed.resolver';
import { LeaderboardResolver } from './resolvers/leaderboard.resolver';
import { SearchResolver } from './resolvers/search.resolver';

// ── DataLoader ───────────────────────────────────────────────────────────────
import { DataLoaderService } from './dataloader/dataloader.service';

// ── Existing feature modules that export their services ──────────────────────
import { CallsModule } from '../calls/calls.module';
import { UsersModule } from '../user/users.module';
import { BookmarksModule } from '../bookmarks/bookmarks.module';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';
import { AuthModule } from '../auth/auth.module';

// ── Services not exported by their modules (declared directly here) ──────────
import { SearchService } from '../search/search.service';

// ── Entities needed by DataLoaderService ─────────────────────────────────────
import { Users } from '../user/entities/users.entity';
import { Stake } from '../stakes/entities/stake.entity';

@Module({
  imports: [
    // ── Apollo / GraphQL driver ─────────────────────────────────────────────
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,

      // Code-first: auto-generate schema.gql from decorators
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      sortSchema: true,

      // Apollo Sandbox available in non-production; introspection follows suit
      playground: false,
      introspection: process.env.NODE_ENV !== 'production',

      // Expose the raw Express request on the GQL context so guards/decorators
      // can read the Authorization header and attach req.user.
      context: ({ req }: { req: unknown }) => ({ req }),

      buildSchemaOptions: {
        numberScalarMode: 'integer',
      },
    }),

    // ── Feature modules that export their services ───────────────────────────
    CallsModule,
    UsersModule,
    BookmarksModule,
    LeaderboardModule,
    // AuthModule is @Global(), so AuthService is available everywhere already.
    // Listing it explicitly here is safe and makes the dependency clear.
    AuthModule,

    // ── Repositories used by REQUEST-scoped DataLoaderService ────────────────
    TypeOrmModule.forFeature([Users, Stake]),
  ],

  providers: [
    // ── Resolvers ─────────────────────────────────────────────────────────────
    CallsResolver,
    UsersResolver,
    FeedResolver,
    LeaderboardResolver,
    SearchResolver,

    // ── SearchService: declared here because SearchModule doesn't export it ──
    // DataSource is provided globally by TypeOrmModule.forRoot in AppModule.
    SearchService,

    // ── REQUEST-scoped DataLoader factory ─────────────────────────────────────
    DataLoaderService,
  ],

  exports: [DataLoaderService],
})
export class GraphqlModule {}

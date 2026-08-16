import { Resolver, Query, Args, ObjectType, Field } from '@nestjs/graphql';
import { SearchService } from '../../search/search.service';
import { CallType } from '../types/call.type';
import { UserType } from '../types/user.type';

/** Unified search result containing matching calls and users. */
@ObjectType('SearchResult')
export class SearchResultType {
  @Field(() => [CallType], {
    description: 'Calls whose title / content matches the search query',
  })
  calls: CallType[];

  @Field(() => [UserType], {
    description: 'Users whose wallet address matches the search query',
  })
  users: UserType[];
}

@Resolver()
export class SearchResolver {
  constructor(private readonly searchService: SearchService) {}

  /**
   * `Query.search(query)` — performs a full-text search across calls and a
   * prefix match on user wallet addresses.
   *
   * Returns up to 10 calls and 10 users.  Both fields are always present;
   * empty arrays are returned when there are no matches.
   */
  @Query(() => SearchResultType, {
    name: 'search',
    description: 'Full-text search across calls and users',
    complexity: 10,
  })
  async search(
    @Args('query', { description: 'Search query string (min 1 char)' })
    query: string,
  ): Promise<SearchResultType> {
    const trimmed = query.trim();
    if (!trimmed) {
      return { calls: [], users: [] };
    }

    const result = await this.searchService.globalSearch(trimmed);

    return {
      calls: result.calls as unknown as CallType[],
      users: result.users as unknown as UserType[],
    };
  }
}

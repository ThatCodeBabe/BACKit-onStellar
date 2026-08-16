import {
  fieldExtensionsEstimator,
  simpleEstimator,
  getComplexity,
} from 'graphql-query-complexity';
import { GraphQLSchema, DocumentNode } from 'graphql';
import { Logger } from '@nestjs/common';

/** Maximum query complexity units allowed per request. */
export const MAX_COMPLEXITY = 200;

/** Default cost per field if no explicit `complexity` option is set. */
export const DEFAULT_FIELD_COST = 1;

/**
 * Calculates the complexity of an incoming GraphQL query and throws when it
 * exceeds `MAX_COMPLEXITY`.
 *
 * Plugged into `ApolloDriver` via the `plugins` array in `GraphqlModule`.
 */
export function buildComplexityPlugin(schema: GraphQLSchema) {
  const logger = new Logger('GraphQL:Complexity');

  return {
    requestDidStart: () => ({
      didResolveOperation({
        request,
        document,
      }: {
        request: { variables?: Record<string, unknown> };
        document: DocumentNode;
      }) {
        const complexity = getComplexity({
          schema,
          operationName: undefined,
          query: document,
          variables: request.variables,
          estimators: [
            // Honour explicit `complexity` options on field definitions first
            fieldExtensionsEstimator(),
            // Fall back to 1 per field
            simpleEstimator({ defaultComplexity: DEFAULT_FIELD_COST }),
          ],
        });

        logger.debug(`Query complexity: ${complexity}`);

        if (complexity > MAX_COMPLEXITY) {
          throw new Error(
            `Query complexity of ${complexity} exceeds the maximum allowed complexity of ${MAX_COMPLEXITY}. ` +
              'Please simplify your query by requesting fewer fields or splitting it into multiple requests.',
          );
        }
      },
    }),
  };
}

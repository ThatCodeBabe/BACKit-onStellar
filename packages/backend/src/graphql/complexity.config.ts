import {
  fieldExtensionsEstimator,
  simpleEstimator,
  getComplexity,
} from 'graphql-query-complexity';
import { GraphQLSchema, DocumentNode } from 'graphql';
import { Logger } from '@nestjs/common';
import { ApolloServerPlugin, GraphQLRequestListener } from '@apollo/server';

/** Maximum query complexity units allowed per request. */
export const MAX_COMPLEXITY = 200;

/** Default cost per field when no explicit `complexity` option is set. */
export const DEFAULT_FIELD_COST = 1;

/**
 * Returns an Apollo Server 4 plugin that rejects requests whose complexity
 * exceeds MAX_COMPLEXITY.
 *
 * Pass the compiled GraphQLSchema (available after schema generation) so the
 * complexity estimator can introspect field definitions.
 *
 * Usage in GraphQLModule.forRoot():
 *   plugins: [buildComplexityPlugin(schema)]
 *
 * Because the schema isn't available at module definition time in NestJS
 * code-first mode, this plugin is wired up via the `plugins` array inside a
 * factory function that receives the schema once it is ready.
 */
export function buildComplexityPlugin(
  schema: GraphQLSchema,
): ApolloServerPlugin {
  const logger = new Logger('GraphQL:Complexity');

  return {
    async requestDidStart(): Promise<GraphQLRequestListener<object>> {
      return {
        async didResolveOperation({ request, document }) {
          const complexity = getComplexity({
            schema,
            operationName: request.operationName ?? undefined,
            query: document as DocumentNode,
            variables: request.variables as Record<string, unknown> | undefined,
            estimators: [
              // Honour explicit `complexity` options set on resolver fields
              fieldExtensionsEstimator(),
              // Fall back to DEFAULT_FIELD_COST per field
              simpleEstimator({ defaultComplexity: DEFAULT_FIELD_COST }),
            ],
          });

          logger.debug(`Query complexity: ${complexity}`);

          if (complexity > MAX_COMPLEXITY) {
            throw new Error(
              `Query complexity ${complexity} exceeds the allowed maximum of ` +
                `${MAX_COMPLEXITY}. Simplify your query or split it into ` +
                `multiple requests.`,
            );
          }
        },
      };
    },
  };
}

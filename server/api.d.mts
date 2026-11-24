import type { IncomingMessage, ServerResponse } from "node:http";

export interface ApiMiddlewareOptions {
  forceLocal?: boolean;
  requireAuthForCloudMaps?: boolean;
  llmFetch?: typeof fetch;
}

export function createApiMiddleware(
  dataDir?: string,
  options?: ApiMiddlewareOptions
): (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>;

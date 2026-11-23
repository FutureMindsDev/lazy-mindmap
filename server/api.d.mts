import type { IncomingMessage, ServerResponse } from "node:http";

export function createApiMiddleware(
  dataDir?: string
): (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>;

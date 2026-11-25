import type { IncomingMessage, ServerResponse } from 'node:http'

export function createOfmMiddleware(): (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void
) => Promise<void>

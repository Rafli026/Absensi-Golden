// ApiError + fallback error handler.

/** Error carrying an HTTP status and a client-safe message. */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Body JSON tidak valid' });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Body JSON tidak valid' });
  }
  // eslint-disable-next-line no-console
  console.error('[error]', err);
  return res.status(500).json({ error: 'Internal Server Error' });
}

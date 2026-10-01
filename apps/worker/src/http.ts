/**
 * Release an unread response body so the connection is freed (Workers keeps it
 * open otherwise). Fire-and-forget: a cancel failure must never change the
 * caller's behaviour.
 */
export function discardBody(res: Response): void {
  try {
    res.body?.cancel().catch(() => undefined);
  } catch {
    // Ignored on purpose; see above.
  }
}

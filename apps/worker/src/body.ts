import { AppError } from "./errors";

export const MAX_BODY_BYTES = 65_536;

/** Reads at most MAX_BODY_BYTES from the stream, aborting as soon as it is exceeded. */
async function readCapped(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new AppError("bad_request", "Body too large");
    }
    parts.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    all.set(p, offset);
    offset += p.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** Reads a JSON request body, rejecting empty, oversized or malformed input. */
export async function readJsonBody(c: {
  req: {
    raw: { body: ReadableStream<Uint8Array> | null };
    header(name: string): string | undefined;
  };
}): Promise<Record<string, unknown>> {
  const declared = Number(c.req.header("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new AppError("bad_request", "Body too large");
  }
  const stream = c.req.raw.body;
  const text = stream === null ? "" : await readCapped(stream);
  if (text.length === 0) throw new AppError("bad_request", "Missing body");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AppError("bad_request", "Body is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AppError("bad_request", "Body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

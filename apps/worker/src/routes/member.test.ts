import { normalizeGardenMember } from "@garden-hq/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import member from "../../../../packages/core/fixtures/member-greenhouse.real.sample.json";
import {
  PROFILES_ROUTE,
  START_ISO,
  happyRoutes,
  json,
  makeHarness,
} from "../../test/helpers";

afterEach(() => vi.restoreAllMocks());

const PROFILE = "33333333-3333-3333-3333-333333333333";
const UUID = "11111111-1111-1111-1111-111111111111";
const UUID_PLAIN = UUID.replace(/-/g, "");

function routes(profiles: unknown) {
  return happyRoutes({
    [PROFILES_ROUTE]: () => json({ success: true, profiles }),
  });
}

function harness(
  profiles: unknown = [
    { profile_id: PROFILE, members: { [UUID_PLAIN]: member } },
  ],
) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  return makeHarness(routes(profiles));
}

async function code(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe("GET /api/member", () => {
  it("returns the normalized member subset with fetchedAt", async () => {
    const { get } = harness();

    const res = await get(`/api/member?profile=${PROFILE}&uuid=${UUID}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      member: normalizeGardenMember(member),
      fetchedAt: START_ISO,
    });
  });

  it("accepts a plain (undashed) uuid", async () => {
    const { get } = harness();
    const res = await get(`/api/member?profile=${PROFILE}&uuid=${UUID_PLAIN}`);
    expect(res.status).toBe(200);
  });

  it("rejects a malformed profile or uuid with bad_request", async () => {
    const { get } = harness();
    const badProfile = await get(`/api/member?profile=nope&uuid=${UUID}`);
    expect(badProfile.status).toBe(400);
    expect(await code(badProfile)).toBe("bad_request");
    const badUuid = await get(`/api/member?profile=${PROFILE}`);
    expect(badUuid.status).toBe(400);
  });

  it("returns no_garden when the profile or member is absent", async () => {
    const other = "44444444-4444-4444-4444-444444444444";
    const noProfile = await harness([
      { profile_id: other, members: { [UUID_PLAIN]: member } },
    ]).get(`/api/member?profile=${PROFILE}&uuid=${UUID}`);
    expect(noProfile.status).toBe(404);
    expect(await code(noProfile)).toBe("no_garden");

    const noMember = await harness([
      { profile_id: PROFILE, members: { [other.replace(/-/g, "")]: member } },
    ]).get(`/api/member?profile=${PROFILE}&uuid=${UUID}`);
    expect(await code(noMember)).toBe("no_garden");
  });

  it("serves the second request from the KV cache", async () => {
    const { get, net } = harness();
    await get(`/api/member?profile=${PROFILE}&uuid=${UUID}`);
    await get(`/api/member?profile=${PROFILE}&uuid=${UUID}`);
    expect(net.calls.filter((c) => c === PROFILES_ROUTE)).toHaveLength(1);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapPgError, UniqueViolationError } from "./postgres.js";

describe("mapPgError", () => {
  it("wraps pg error code 23505 as UniqueViolationError", () => {
    const pgErr: any = new Error(
      'duplicate key value violates unique constraint "idx_users_email"',
    );
    pgErr.code = "23505";
    pgErr.detail = "Key (email)=(dup@test.com) already exists.";
    pgErr.constraint = "idx_users_email";

    const mapped = mapPgError(pgErr);

    assert.ok(mapped instanceof UniqueViolationError);
    assert.equal(mapped.detail, "Key (email)=(dup@test.com) already exists.");
    assert.equal(mapped.constraint, "idx_users_email");
  });

  it("returns other errors unchanged", () => {
    const err = new Error("some other error");
    const mapped = mapPgError(err);
    assert.equal(mapped, err);
  });

  it("returns null/undefined unchanged", () => {
    assert.equal(mapPgError(null as any), null);
    assert.equal(mapPgError(undefined as any), undefined);
  });
});

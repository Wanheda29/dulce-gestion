import test from "node:test";
import assert from "node:assert/strict";
import { isCloudConfigured } from "../cloud.js";

test("activa la conexión con el proyecto Supabase configurado", () => {
  assert.equal(isCloudConfigured(), true);
});

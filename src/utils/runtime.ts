// Guard against the one runtime mismatch that cannot be caught with try/catch.
//
// better-sqlite3 ships prebuilt Node-API addons compiled with NAPI_VERSION=10
// (the prebuild exports node_api_module_get_api_version_v1 returning 10). When
// a Node build that only implements Node-API 9 or lower dlopen()s such an
// addon, Node's v8impl::NewEnv() rejects the requested version and returns
// nullptr, but napi_module_register_by_symbol() dereferences that nullptr
// anyway. The result is a SIGSEGV during require() of the .node file — the
// process dies with exit code 139 before any JavaScript error handler runs, so
// wrapping `new Database(...)` in try/catch cannot help.
//
// Node-API 10 landed in Node v23.6.0 and was backported to v22.14.0.
export const REQUIRED_NAPI_VERSION = 10;

export const MIN_NODE_VERSION = '22.14.0';

/**
 * Returns a human-readable explanation when the current runtime is too old to
 * load the bundled native addon, or null when the runtime is fine.
 *
 * Parameters are injectable so the check can be unit tested without spawning
 * a differently-versioned Node.
 */
export function nativeRuntimeError(
  napiVersion: string | undefined = process.versions.napi,
  nodeVersion: string = process.version,
): string | null {
  // An absent or non-numeric napi version means we are on some runtime whose
  // capabilities we cannot reason about (or a very old Node without Node-API
  // reporting). Do not block: let the addon load and fail on its own terms.
  if (napiVersion === undefined) return null;
  const napi = Number(napiVersion);
  if (!Number.isFinite(napi)) return null;
  if (napi >= REQUIRED_NAPI_VERSION) return null;

  return (
    `Node ${nodeVersion} implements Node-API v${napiVersion}, but the bundled ` +
    `better-sqlite3 addon requires Node-API v${REQUIRED_NAPI_VERSION}. ` +
    `Loading it would crash the process with a segmentation fault. ` +
    `Upgrade to Node >= ${MIN_NODE_VERSION}.`
  );
}

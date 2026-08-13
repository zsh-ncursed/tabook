// No-op replacement for react-devtools-core, inlined by esbuild via the
// `alias` option in scripts/package-release.mjs. ink eagerly imports its
// devtools module and calls connectToDevTools() at module load; devtools are
// only useful when debugging the renderer, so in the production bundle the
// connection is a harmless no-op instead of shipping the ~10MB package.
export default {
  connectToDevTools() {},
};

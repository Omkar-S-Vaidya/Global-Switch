// Shared description store.
//
// Descriptions are kept out of the list response because inlining them would
// take a full "All countries" payload from ~735 KB to roughly 12 MB. /api/jobs
// fills this while reading boards and /api/jobs/detail serves one at a time, so
// expanding a role costs a local lookup rather than an outbound request.
//
// It hangs off globalThis on purpose. Next compiles each route handler into its
// own server bundle, and a plain module-level `new Map()` gets duplicated per
// bundle — /api/jobs filled one copy while /api/jobs/detail read an empty one
// (measured: 0 of 5 lookups found). globalThis is the one instance every bundle
// genuinely shares, and is the same pattern used for DB client singletons.

const MAX_ENTRIES = 8000;
const KEY = Symbol.for("jobhunt.descriptions");

const store = (globalThis[KEY] ??= new Map());

export function rememberDescription(url, desc) {
  if (!url || !desc) return;
  // Crude but sufficient: a single reset beats unbounded growth in a process
  // that may run for days, and the next board read repopulates it.
  if (store.size > MAX_ENTRIES) store.clear();
  store.set(url, desc);
}

export function getDescription(url) {
  return store.get(url) || null;
}

export function descriptionCount() {
  return store.size;
}

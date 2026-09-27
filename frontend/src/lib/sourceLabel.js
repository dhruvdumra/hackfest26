/* One sentence per data source, for the provenance line under a panel.
 *
 * The panels used to print the API's own field, `source=simulated`, which is
 * accurate and unreadable from the back of a room. The words are the same
 * three states the badges carry: every figure is still labelled, in English. */
const SOURCE_LABELS = {
  live: 'Live data',
  simulated: 'Simulated data',
  local: 'Computed locally',
}

export function describeSource(source) {
  return SOURCE_LABELS[source] ?? 'Source pending'
}

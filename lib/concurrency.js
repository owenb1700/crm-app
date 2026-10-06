// Doing the same job over a list a few at a time instead of one at a time.
//
// The nightly backup is the reason this exists: it fetched every record's
// subcollections in a strict queue, each one waiting on the last, which
// made its running time grow in a straight line with the number of
// records. Nothing about the work needs to be in order -- it is a few
// hundred independent reads -- so the only thing the queue bought was
// time.
//
// A few at a time rather than all at once, because "all at once" over a
// thousand records would open a thousand simultaneous connections and
// trade one failure for another.

// Answers come back in the order they went in, whatever order they
// finish in, so a caller can still rely on the list lining up.
export async function mapWithLimit(items, limit, fn) {
  const list = items || [];
  const out = new Array(list.length);
  let next = 0;

  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= list.length) return;
      out[i] = await fn(list[i], i);
    }
  };

  const width = Math.max(1, Math.min(limit, list.length));
  const running = [];
  for (let w = 0; w < width; w++) running.push(worker());
  // Every worker is awaited together, so one of them failing can't leave
  // the others' rejections unhandled.
  await Promise.all(running);
  return out;
}

// The whole-page wait, in one place. Every page used to render the bare
// word "Loading..." in the top-left corner, which reads as unfinished --
// this is the same wait with a centred spinner instead, and no text, so a
// slow Firestore read looks deliberate rather than broken.
//
// Deliberately not a skeleton: these pages have very different shapes, and
// a skeleton that doesn't match what arrives is worse than no skeleton.
export default function PageLoading() {
  return (
    <div className="dashboard-page page-loading" role="status" aria-label="Loading">
      <span className="page-loading-spinner" />
    </div>
  );
}

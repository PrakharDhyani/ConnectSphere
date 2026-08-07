import { Component, Suspense, useEffect, useRef } from "react";
import { getPlugin } from "@shared/activities/index.js";
import { getClientModule, hasClientModule } from "./registry.jsx";

/**
 * Mounts one activity plugin and contains its failures.
 *
 * THREE THINGS THIS EXISTS TO GUARANTEE
 *
 * 1. A crashing plugin cannot take the room with it. Each activity gets its own
 *    error boundary, so a bad render shows a card in that tab while chat, the
 *    call and every other tab keep working. Non-negotiable the moment plugins
 *    can come from anywhere but this repo.
 *
 * 2. A missing plugin degrades instead of white-screening. A room can name a
 *    plugin this build does not ship (older deploy, uninstalled, eventually a
 *    marketplace). It renders "unavailable", which is also the only way the
 *    management UI can still see it in order to remove it.
 *
 * 3. Switching tabs does not destroy state. The activity stays MOUNTED and is
 *    hidden with CSS, because unmounting a live Ludo game to glance at chat
 *    would lose the board — GamesHub already works around this with
 *    sessionStorage. See the hidden/shown caveat below.
 */

class ActivityErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Named so the console says which plugin, not just "something in React".
    console.error(`[activity:${this.props.activityId}] crashed:`, error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const { name, icon } = this.props;
    return (
      <div className="max-w-md mx-auto mt-10 bg-gray-900 border border-red-900/50 rounded-2xl p-6 text-center">
        <div className="text-3xl mb-2">{icon || "⚠️"}</div>
        <h3 className="font-bold mb-1">{name || "This activity"} stopped working</h3>
        <p className="text-sm text-gray-400 mb-4">
          The rest of the room is unaffected — chat and the call are still running.
        </p>
        <button
          onClick={() => this.setState({ error: null })}
          className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-sm font-medium"
        >
          Try again
        </button>
      </div>
    );
  }
}

function ActivityFallback() {
  return (
    <div className="flex items-center justify-center h-[60vh]">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function Unavailable({ activityId }) {
  return (
    <div className="max-w-md mx-auto mt-10 bg-gray-900 border border-gray-800 rounded-2xl p-6 text-center">
      <div className="text-3xl mb-2">🧩</div>
      <h3 className="font-bold mb-1">Activity unavailable</h3>
      <p className="text-sm text-gray-400">
        This room uses <span className="font-mono text-gray-300">{activityId}</span>, which
        isn&apos;t available on this server.
      </p>
    </div>
  );
}

/**
 * Tells a mounted-but-hidden activity that it is hidden.
 *
 * THE display:none TRAP — we have already been bitten by this once, with the
 * GIF thumbnails: canvases and lazily-loaded images inside a hidden subtree do
 * not size or load correctly, and a 3D game happily keeps rendering at full
 * frame rate into a canvas nobody can see. That is a battery drain no user
 * would ever attribute to switching tabs.
 *
 * So the host dispatches DOM events the panel can listen for, rather than
 * requiring every panel to be rewritten to accept a prop. Panels that do not
 * listen are unaffected; canvas panels can opt in as they migrate.
 */
function useVisibilitySignal(ref, active, activityId) {
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current === active) return;
    wasActive.current = active;
    const el = ref.current;
    if (!el) return;
    el.dispatchEvent(
      new CustomEvent(active ? "activity:shown" : "activity:hidden", {
        bubbles: false,
        detail: { activityId },
      })
    );
  }, [active, activityId, ref]);
}

/**
 * @param {string}  activityId  manifest id
 * @param {boolean} active      is this the foreground activity?
 * @param {boolean} mounted     keep it in the tree while hidden (default true)
 */
export default function ActivityHost({ activityId, roomId, active, mounted = true, className = "" }) {
  const ref = useRef(null);
  useVisibilitySignal(ref, active, activityId);

  const manifest = getPlugin(activityId);
  // Never mounted yet and not active: render nothing at all, so opening a room
  // does not download every plugin's chunk.
  if (!active && !mounted) return null;

  if (!manifest || !hasClientModule(activityId)) {
    return active ? <Unavailable activityId={activityId} /> : null;
  }

  const Component_ = getClientModule(activityId);

  return (
    <div
      ref={ref}
      // `hidden` (display:none) rather than unmounting — see the class comment.
      // aria-hidden keeps a backgrounded activity out of the a11y tree too.
      className={active ? className : "hidden"}
      aria-hidden={!active}
      data-activity={activityId}
    >
      <ActivityErrorBoundary activityId={activityId} name={manifest.name} icon={manifest.icon}>
        <Suspense fallback={<ActivityFallback />}>
          <Component_ roomId={roomId} />
        </Suspense>
      </ActivityErrorBoundary>
    </div>
  );
}

export { ActivityErrorBoundary, Unavailable };

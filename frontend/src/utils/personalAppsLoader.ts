type PersonalAppsFetcher<Response> = (limit: number) => Promise<Response>;
type PersonalAppsConsumer<Response> = (response: Response) => void;

interface LoaderState {
  inFlight?: Promise<void>;
  lastSucceededAt?: number;
  lastFailedAt?: number;
}

const SUCCESS_CACHE_DURATION = 5 * 60 * 1000;
const FAILURE_COOLDOWN = 30 * 1000;

/**
 * Creates a request loader that de-duplicates concurrent calls by limit.
 * Explicit calls always refresh; mount-time calls may reuse a recent success
 * or briefly cool down after a failure.
 */
export function createPersonalAppsLoader<Response>(
  fetchApps: PersonalAppsFetcher<Response>,
  consumeResponse: PersonalAppsConsumer<Response>
) {
  const states = new Map<number, LoaderState>();

  return (limit: number, onlyIfNeeded = false): Promise<void> => {
    const state = states.get(limit) || {};
    const now = Date.now();

    if (state.inFlight) {
      return state.inFlight;
    }

    if (onlyIfNeeded) {
      const hasFreshResult = state.lastSucceededAt
        && now - state.lastSucceededAt < SUCCESS_CACHE_DURATION;
      const isCoolingDown = state.lastFailedAt
        && now - state.lastFailedAt < FAILURE_COOLDOWN;

      if (hasFreshResult || isCoolingDown) {
        return Promise.resolve();
      }
    }

    const request = fetchApps(limit)
      .then((response) => {
        consumeResponse(response);
        state.lastSucceededAt = Date.now();
        state.lastFailedAt = undefined;
      })
      .catch((error) => {
        state.lastFailedAt = Date.now();
        throw error;
      })
      .finally(() => {
        state.inFlight = undefined;
      });

    state.inFlight = request;
    states.set(limit, state);
    return request;
  };
}

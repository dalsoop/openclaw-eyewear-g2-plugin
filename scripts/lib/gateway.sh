# Gateway wait helpers for the shell entry points. Source after setting OPENCLAW.
#   gateway_wait_ok [SEC]       poll `gateway status` until "Connectivity check: ok" (default 60 s)
#   gateway_wait_stopped [SEC]  poll until the gateway is neither running nor reachable (default 30 s)
# GATEWAY_WAIT_POLL_SEC (default 2) sets the poll interval. Both return 1 on timeout.

gateway_status_text() {
  "$OPENCLAW" gateway status 2>&1 || true
}

gateway_wait_ok() {
  limit=${1:-60}
  poll=${GATEWAY_WAIT_POLL_SEC:-2}
  waited=0
  while :; do
    if gateway_status_text | grep -q "Connectivity check: ok"; then
      return 0
    fi
    if [ "$waited" -ge "$limit" ]; then
      echo "gateway did not report 'Connectivity check: ok' within ${limit}s" >&2
      return 1
    fi
    sleep "$poll"
    waited=$((waited + poll))
  done
}

gateway_wait_stopped() {
  limit=${1:-30}
  poll=${GATEWAY_WAIT_POLL_SEC:-2}
  waited=0
  while :; do
    # Require a positive "not running" signal; an empty or failed status read
    # must not count as stopped.
    st=$(gateway_status_text || true)
    if printf '%s\n' "$st" | grep -qE "\(not loaded\)|^Runtime: (stopped|not running)" \
       && ! printf '%s\n' "$st" | grep -q "Connectivity check: ok"; then
      return 0
    fi
    if [ "$waited" -ge "$limit" ]; then
      echo "gateway still running ${limit}s after stop; nothing was written" >&2
      return 1
    fi
    sleep "$poll"
    waited=$((waited + poll))
  done
}

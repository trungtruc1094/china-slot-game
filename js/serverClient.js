(function (globalScope) {
    "use strict";

    var defaultRetryWindowMessage = "Backend spin failed. Retry is available.";

    function getQueryMode(locationSearch) {
        if (!locationSearch || typeof URLSearchParams === "undefined") return null;
        return new URLSearchParams(locationSearch).get("mode");
    }

    function resolveMode(options) {
        if (options && options.mode) return options.mode;
        var queryMode = getQueryMode(globalScope.location && globalScope.location.search);
        return queryMode || globalScope.CHINA_SLOT_MODE || "demo";
    }

    function resolveApiBaseUrl(options) {
        if (options && options.apiBaseUrl) return options.apiBaseUrl.replace(/\/$/, "");
        if (globalScope.CHINA_SLOT_API_BASE_URL) return String(globalScope.CHINA_SLOT_API_BASE_URL).replace(/\/$/, "");
        if (globalScope.location && globalScope.location.origin && globalScope.location.origin !== "null") {
            return globalScope.location.origin;
        }
        return "http://127.0.0.1:3000";
    }

    function createBrowserIdentity(storage) {
        var key = "china-slot-player-identity";
        var stored = null;

        try {
            stored = storage && storage.getItem(key);
        } catch (_error) {
            stored = null;
        }

        if (stored) {
            return { provider: "guest", subject: stored };
        }

        var subject = "browser-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);

        try {
            if (storage) storage.setItem(key, subject);
        } catch (_error) {
            // Storage is optional; keep the generated subject for this page session.
        }

        return { provider: "guest", subject: subject };
    }

    function normalizeBackendSpinResult(result) {
        if (!result || !Array.isArray(result.reelStops)) {
            throw new Error("Backend spin result is missing reelStops.");
        }

        return {
            spinId: result.spinId,
            clientSpinId: result.clientSpinId,
            sessionId: result.sessionId,
            reelStops: result.reelStops.map(function (stop) {
                return {
                    reelIndex: Number(stop.reelIndex),
                    stopIndex: Number(stop.stopIndex)
                };
            }),
            visibleWindow: result.visibleWindow,
            payout: Number(result.payout || 0),
            winBreakdown: result.winBreakdown || null,
            balanceAfter: Number(result.balanceAfter || 0),
            freeSpinState: result.freeSpinState || { awarded: 0, remaining: 0 },
            jackpotState: result.jackpotState || { awarded: 0 }
        };
    }

    function toReelStopPositions(result, reelCount) {
        var normalized = normalizeBackendSpinResult(result);
        var positions = new Array(reelCount || normalized.reelStops.length);

        normalized.reelStops.forEach(function (stop) {
            positions[stop.reelIndex] = stop.stopIndex;
        });

        return positions;
    }

    function buildProductionRenderPlan(options) {
        var backendResult = normalizeBackendSpinResult(options.backendResult);
        var reelCount = options.reelCount || backendResult.reelStops.length;

        return {
            mode: "production",
            source: "backend",
            reelStopPositions: toReelStopPositions(backendResult, reelCount),
            payout: backendResult.payout,
            winBreakdown: backendResult.winBreakdown,
            balanceAfter: backendResult.balanceAfter,
            freeSpinState: backendResult.freeSpinState,
            jackpotState: backendResult.jackpotState,
            retryable: false
        };
    }

    function buildDemoRenderPlan(options) {
        return {
            mode: "demo",
            source: "local-demo",
            localOutcome: options.localOutcome || null,
            retryable: false
        };
    }

    function resolveSpinRenderPlan(options) {
        if (options.mode === "production") {
            return buildProductionRenderPlan(options);
        }

        return buildDemoRenderPlan(options);
    }

    function buildRetryState(error) {
        return {
            mode: "production",
            source: "backend",
            status: "retry",
            retryable: true,
            message: (error && error.message) || defaultRetryWindowMessage
        };
    }

    function createBackendClient(options) {
        var settings = options || {};
        var mode = resolveMode(settings);
        var apiBaseUrl = resolveApiBaseUrl(settings);
        var fetchImpl = settings.fetch || globalScope.fetch;
        var storage = settings.storage || globalScope.localStorage;
        var identity = settings.identity || createBrowserIdentity(storage);
        var session = null;
        var status = mode === "production" ? "idle" : "demo";

        async function postJson(path, body) {
            if (!fetchImpl) throw new Error("Fetch is unavailable for backend mode.");

            var response = await fetchImpl(apiBaseUrl + path, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body)
            });
            var envelope = await response.json();

            if (!response.ok || envelope.error) {
                var message = envelope.error && envelope.error.message ? envelope.error.message : "Backend request failed.";
                var error = new Error(message);
                error.status = response.status;
                error.code = envelope.error && envelope.error.code;
                throw error;
            }

            return envelope.data;
        }

        async function startSession() {
            if (mode !== "production") return null;
            if (session && session.sessionId) return session;

            status = "pending";
            session = await postJson("/api/sessions", { identity: identity });
            status = "ready";
            return session;
        }

        async function spin(request) {
            if (mode !== "production") {
                throw new Error("Backend spins are only available in production mode.");
            }

            status = "pending";
            var activeSession = await startSession();
            var result = await postJson("/api/spins", {
                clientSpinId: request.clientSpinId,
                sessionId: activeSession.sessionId,
                wager: request.wager
            });
            status = "ready";
            return normalizeBackendSpinResult(result);
        }

        function setRetry(error) {
            status = "retry";
            return buildRetryState(error);
        }

        return {
            mode: mode,
            apiBaseUrl: apiBaseUrl,
            identity: identity,
            get status() { return status; },
            startSession: startSession,
            spin: spin,
            setRetry: setRetry
        };
    }

    var api = {
        createBackendClient: createBackendClient,
        createFromWindow: function (options) { return createBackendClient(options || {}); },
        normalizeBackendSpinResult: normalizeBackendSpinResult,
        toReelStopPositions: toReelStopPositions,
        resolveSpinRenderPlan: resolveSpinRenderPlan,
        buildRetryState: buildRetryState
    };

    globalScope.ChinaSlotServerClient = api;
})(typeof window !== "undefined" ? window : globalThis);

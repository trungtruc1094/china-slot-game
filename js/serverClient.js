(function (globalScope) {
    "use strict";

    var defaultRetryWindowMessage = "Reward-bearing play is paused while the backend is unavailable.";

    function getQueryMode(locationSearch) {
        if (!locationSearch || typeof URLSearchParams === "undefined") return null;
        return new URLSearchParams(locationSearch).get("mode");
    }

    function resolveMode(options) {
        if (options && options.mode) return normalizeMode(options.mode);
        var queryMode = getQueryMode(globalScope.location && globalScope.location.search);
        return normalizeMode(queryMode || globalScope.CHINA_SLOT_MODE || "production");
    }

    function normalizeMode(mode) {
        return mode === "demo" ? "demo" : "production";
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
            return {
                provider: "guest",
                subject: stored,
                expiresAt: createIdentityExpiry()
            };
        }

        var subject = "browser-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);

        try {
            if (storage) storage.setItem(key, subject);
        } catch (_error) {
            // Storage is optional; keep the generated subject for this page session.
        }

        return {
            provider: "guest",
            subject: subject,
            expiresAt: createIdentityExpiry()
        };
    }

    function createIdentityExpiry() {
        return new Date(Date.now() + 60 * 60 * 1000).toISOString();
    }

    function createRequestId() {
        return "req_browser_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
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
            // Story 8.7: server-owned Stars wallet fields. withdrawableBalance defaults to
            // balanceAfter (single integer wallet, no reservation yet); currency marks a Tevi
            // (Stars) session vs. a local credits session.
            withdrawableBalance: Number((result.withdrawableBalance != null) ? result.withdrawableBalance : (result.balanceAfter || 0)),
            currency: result.currency || "credits",
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
        if (!options.backendResult) {
            return buildRetryState();
        }

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
            message: safeRetryMessage(error)
        };
    }

    function safeRetryMessage(_error) {
        return defaultRetryWindowMessage;
    }

    function isPositiveInteger(value) {
        return typeof value === "number" && isFinite(value) && Math.floor(value) === value && value > 0;
    }

    function topupSignatureFailure(reason, retryable, requestId) {
        return {
            ok: false,
            status: retryable ? "retryable-failure" : "failed",
            reason: reason,
            retryable: !!retryable,
            requestId: requestId || null
        };
    }

    function topupSignatureReauth(reason) {
        return { ok: false, status: "re-authentication-required", reason: reason, retryable: true, requestId: null };
    }

    function topupSignatureBlocked(reason, requestId) {
        return { ok: false, status: "blocked", reason: reason, retryable: false, requestId: requestId || null };
    }

    var DEFAULT_TOPUP_MAX_STARS = 100000;

    function resolveTopupMaxStars() {
        var topupConfig = (globalScope.CHINA_SLOT_TEVI_CONFIG && globalScope.CHINA_SLOT_TEVI_CONFIG.topup) || {};
        var max = Number(topupConfig.maxStars);
        return isFinite(max) && max > 0 ? max : DEFAULT_TOPUP_MAX_STARS;
    }

    function mapTopupSignatureError(httpStatus, code, requestId) {
        // Status 0 / opaque (CORS, blocked) responses are transient, not terminal rejections.
        if (!httpStatus) {
            return topupSignatureFailure("backend-unavailable", true, requestId);
        }
        if (httpStatus === 401 || code === "TEVI_AUTH_REQUIRED" || code === "TEVI_REAUTH_REQUIRED" || code === "TEVI_TOKEN_INVALID") {
            return topupSignatureReauth("tevi-auth-required");
        }
        if (httpStatus === 403 || code === "TEVI_WRONG_APP" || code === "TEVI_ANONYMOUS_BLOCKED" || code === "TEVI_USER_INACTIVE") {
            return topupSignatureBlocked("tevi-forbidden", requestId);
        }
        if (httpStatus >= 500 || httpStatus === 429) {
            return topupSignatureFailure("backend-unavailable", true, requestId);
        }
        return topupSignatureFailure("signature-rejected", false, requestId);
    }

    function createBackendClient(options) {
        var settings = options || {};
        var mode = resolveMode(settings);
        var apiBaseUrl = resolveApiBaseUrl(settings);
        var fetchImpl = settings.fetch || globalScope.fetch;
        var storage = settings.storage || globalScope.localStorage;
        var identity = settings.identity || createBrowserIdentity(storage);
        var teviClient = settings.teviClient || null;
        var topupRequestTimeoutMs = typeof settings.topupRequestTimeoutMs === "number" ? settings.topupRequestTimeoutMs : 15000;
        var session = null;
        var sessionRequest = null;
        var status = mode === "production" ? "idle" : "demo";

        async function postJson(path, body) {
            if (!fetchImpl) throw new Error("Fetch is unavailable for backend mode.");

            var response = await fetchImpl(apiBaseUrl + path, {
                method: "POST",
                headers: { "content-type": "application/json", "x-request-id": createRequestId() },
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
            if (sessionRequest) return sessionRequest;

            status = "pending";
            sessionRequest = (isTeviSessionMode() ? startTeviSession() : postJson("/api/sessions", { identity: identity })).then(function (createdSession) {
                session = createdSession;
                status = "ready";
                return session;
            }).catch(function (error) {
                sessionRequest = null;
                throw error;
            });
            return sessionRequest;
        }

        async function startTeviSession() {
            var tokenResult = await teviClient.getUserAppToken();
            if (!tokenResult || !tokenResult.ok || !tokenResult.runtimeToken) {
                var error = new Error("Tevi re-authentication is required.");
                error.code = "TEVI_REAUTH_REQUIRED";
                // Preserve the underlying getUserAppToken reason (e.g. sdk-unavailable /
                // sdk-timeout vs. token-missing) so callers can distinguish a transient
                // SDK-not-ready-yet failure (retryable) from a genuine re-auth (terminal).
                error.reason = tokenResult && tokenResult.reason ? tokenResult.reason : "re-authentication-required";
                throw error;
            }

            var exchangeResult = await postJson("/api/tevi/token", { runtimeToken: tokenResult.runtimeToken });
            if (!exchangeResult || !exchangeResult.session) {
                var sessionError = new Error("Tevi session response is missing session data.");
                sessionError.code = "TEVI_REAUTH_REQUIRED";
                // A successful token exchange that returns no session is a genuine re-auth /
                // backend-contract failure, not a transient SDK-not-ready blip — mark it
                // terminal so it surfaces the re-auth state instead of being retried (8.12 review).
                sessionError.reason = "re-authentication-required";
                throw sessionError;
            }
            return exchangeResult.session;
        }

        // Re-read the authoritative session/balance from the server, bypassing the cached
        // session. Used after a Tevi deposit webhook credits the wallet so the HUD reflects
        // the new balance without a full reload. Read-only: the client never mutates balance.
        async function refreshSession() {
            if (mode !== "production") return null;

            var previousSession = session;
            sessionRequest = null;
            session = null;
            try {
                return await startSession();
            } catch (error) {
                // On a transient refresh failure keep the prior session so play continues.
                if (!session && previousSession) {
                    session = previousSession;
                }
                throw error;
            }
        }

        function isTeviSessionMode() {
            return teviClient && typeof teviClient.isTeviMode === "function" && teviClient.isTeviMode();
        }

        async function spin(request) {
            if (mode !== "production") {
                throw new Error("Backend spins are only available in production mode.");
            }

            try {
                status = "pending";
                var activeSession = await startSession();
                var result = await postJson("/api/spins", {
                    clientSpinId: request.clientSpinId,
                    sessionId: activeSession.sessionId,
                    wager: request.wager
                });
                status = "ready";
                return normalizeBackendSpinResult(result);
            } catch (error) {
                return setRetry(error);
            }
        }

        function setRetry(error) {
            status = "retry";
            return buildRetryState(error);
        }

        async function requestTopupSignature(amount) {
            if (mode !== "production") {
                // Local/demo mode must never issue value-bearing top-up requests.
                return topupSignatureFailure("not-production-mode", false);
            }
            if (!isTeviSessionMode()) {
                // No guest or client-supplied identity fallback for Tevi top-up.
                return topupSignatureBlocked("tevi-mode-required");
            }
            if (!isPositiveInteger(amount)) {
                return topupSignatureFailure("invalid-amount", false);
            }
            if (amount > resolveTopupMaxStars()) {
                // Client-side UX guard; the backend remains the authoritative limit.
                return topupSignatureFailure("amount-too-large", false);
            }
            if (!fetchImpl) {
                return topupSignatureFailure("backend-unavailable", true);
            }

            var tokenResult;
            try {
                tokenResult = await teviClient.getUserAppToken();
            } catch (_error) {
                return topupSignatureReauth("token-request-failed");
            }
            if (!tokenResult || !tokenResult.ok || !tokenResult.runtimeToken) {
                return topupSignatureReauth(tokenResult && tokenResult.reason ? tokenResult.reason : "re-authentication-required");
            }

            var requestId = createRequestId();
            var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
            var abortTimer = controller ? setTimeout(function () { controller.abort(); }, topupRequestTimeoutMs) : null;
            var response;
            try {
                response = await fetchImpl(apiBaseUrl + "/api/v1/payments/top-up-signature", {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        "x-request-id": requestId,
                        "authorization": "Bearer " + tokenResult.runtimeToken
                    },
                    body: JSON.stringify({ amount: amount }),
                    signal: controller ? controller.signal : undefined
                });
            } catch (_error) {
                // Network failure or abort timeout — recoverable, never strands the UI.
                return topupSignatureFailure("backend-unavailable", true, requestId);
            } finally {
                if (abortTimer) clearTimeout(abortTimer);
            }

            var envelope;
            try {
                envelope = await response.json();
            } catch (_error) {
                return topupSignatureFailure("invalid-response", true, requestId);
            }

            if (!response.ok || (envelope && envelope.error)) {
                var code = envelope && envelope.error && envelope.error.code;
                return mapTopupSignatureError(response.status, code, requestId);
            }

            var depositToken = envelope && envelope.data && envelope.data.deposit_token;
            if (typeof depositToken !== "string" || depositToken.length === 0) {
                // Never call the SDK without an authoritative deposit token.
                return topupSignatureFailure("deposit-token-missing", false, requestId);
            }

            return { ok: true, depositToken: depositToken, requestId: requestId };
        }

        return {
            mode: mode,
            apiBaseUrl: apiBaseUrl,
            identity: identity,
            get status() { return status; },
            startSession: startSession,
            refreshSession: refreshSession,
            spin: spin,
            setRetry: setRetry,
            requestTopupSignature: requestTopupSignature
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

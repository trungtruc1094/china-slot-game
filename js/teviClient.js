(function (globalScope) {
    "use strict";

    var defaultSdkUrl = "https://static.tevicdn.com/helper_tevi.js";
    var defaultAppId = "AZX29173";
    var defaultChannelId = "2300210851";
    var defaultAppUrl = "https://chinareel.pleagamehub.com/";
    var defaultWebhookUrl = "https://china-slot-api.onrender.com/api/webhooks/tevi";
    var sdkScriptRequest = null;
    var debugPanelElement = null;

    function getDocument() {
        if (globalScope.document) return globalScope.document;
        if (typeof document !== "undefined") return document;
        return null;
    }

    function getQueryValue(name) {
        var browserLocation = globalScope.location || (typeof location !== "undefined" ? location : null);
        if (!browserLocation || !browserLocation.search || typeof URLSearchParams === "undefined") return null;
        return new URLSearchParams(browserLocation.search).get(name);
    }

    function isQueryFlagEnabled(name) {
        var value = getQueryValue(name);
        return value === "1" || value === "true";
    }

    function asString(value) {
        return value === undefined || value === null ? "" : String(value);
    }

    function isExplicitTeviMode(config) {
        var queryTevi = getQueryValue("tevi");
        return globalScope.CHINA_SLOT_TEVI_MODE === true
            || config.enabled === true
            || config.mode === "tevi"
            || queryTevi === "1"
            || queryTevi === "true";
    }

    function resolveRuntimeConfig(options) {
        var configured = globalScope.CHINA_SLOT_TEVI_CONFIG || {};
        var overrides = options || {};
        var config = {
            enabled: overrides.enabled !== undefined ? overrides.enabled : configured.enabled,
            mode: overrides.mode || configured.mode,
            environment: overrides.environment || configured.environment || "",
            appId: overrides.appId || configured.appId || globalScope.TEVI_APP_ID || defaultAppId,
            channelId: overrides.channelId || configured.channelId || globalScope.TEVI_CHANNEL_ID || defaultChannelId,
            appUrl: overrides.appUrl || configured.appUrl || globalScope.TEVI_APP_URL || defaultAppUrl,
            webhookUrl: overrides.webhookUrl || configured.webhookUrl || globalScope.TEVI_WEBHOOK_URL || defaultWebhookUrl,
            sdkUrl: overrides.sdkUrl || configured.sdkUrl || defaultSdkUrl
        };
        var enabled = isExplicitTeviMode(config);

        return {
            enabled: enabled,
            environment: asString(enabled && config.environment === "local" ? "sandbox" : (config.environment || (enabled ? "sandbox" : "local"))),
            appId: asString(config.appId),
            channelId: asString(config.channelId),
            appUrl: asString(config.appUrl),
            webhookUrl: asString(config.webhookUrl),
            sdkUrl: asString(config.sdkUrl || defaultSdkUrl)
        };
    }

    function getSdk() {
        return globalScope.TeviJS || null;
    }

    function unavailable(reason) {
        return { available: false, called: false, reason: reason };
    }

    function callSdkMethod(methodName) {
        var sdk = getSdk();
        if (!sdk) return unavailable("sdk-unavailable");
        if (typeof sdk[methodName] !== "function") return unavailable("method-unavailable");

        try {
            var value = sdk[methodName]();
            return { available: true, called: true, value: value };
        } catch (_error) {
            return unavailable("sdk-call-failed");
        }
    }

    function getUserAppToken(config, options) {
        var sdk = getSdk();
        if (!sdk) return Promise.resolve(reauthState("sdk-unavailable"));
        if (typeof sdk.getUserInfo !== "function") return Promise.resolve(reauthState("method-unavailable"));

        return new Promise(function (resolve) {
            var settled = false;
            var timeoutMs = options && typeof options.timeoutMs === "number" ? options.timeoutMs : 10000;
            var timeoutId = setTimeout(function () {
                complete(reauthState("sdk-timeout"));
            }, timeoutMs);

            function complete(result) {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                resolve(result);
            }

            try {
                sdk.getUserInfo({
                    is_popup: options && options.isPopup === true,
                    app_id: config.appId
                }, function (response) {
                    var runtimeToken = response
                        && response.data
                        && response.data.userInfo
                        && response.data.userInfo.user_app_token;

                    if (typeof runtimeToken === "string" && runtimeToken.length > 0) {
                        complete({ ok: true, status: "authenticated", runtimeToken: runtimeToken });
                        return;
                    }

                    complete(reauthState(isCancellation(response) ? "user-cancelled" : "token-missing"));
                });
            } catch (_error) {
                complete(reauthState("sdk-call-failed"));
            }
        });
    }

    function isCancellation(response) {
        var code = response && response.error && response.error.code;
        return code === "CANCELLED" || code === "CANCELED" || code === "USER_CANCELLED";
    }

    function reauthState(reason) {
        return { ok: false, status: "re-authentication-required", reason: reason };
    }

    function isPositiveInteger(value) {
        return typeof value === "number" && isFinite(value) && Math.floor(value) === value && value > 0;
    }

    function topupState(status, reason) {
        return { ok: status === "webhook-pending", status: status, reason: reason };
    }

    function buildSafeTopupMetadata(options) {
        // Only safe correlation identifiers are forwarded to the SDK. Deposit tokens,
        // bearer/refresh tokens, API keys, and provider payloads must never appear here.
        var metadata = { type: "deposit" };
        if (options) {
            if (typeof options.requestId === "string" && options.requestId.length > 0) metadata.requestId = options.requestId;
            if (typeof options.attemptId === "string" && options.attemptId.length > 0) metadata.attemptId = options.attemptId;
        }
        return metadata;
    }

    // Tevi helper_tevi.js delivers callbacks shaped { error_code, error_message, data, action }.
    // error_code 0 / absent = success; transient codes (-14 timeout, -5 not ready, -6 device
    // unavailable) are recoverable; any other non-zero code is terminal. We also tolerate the
    // adapter's existing { error: { code }, data } convention used by getUserInfo.
    var RETRYABLE_SDK_ERROR_CODES = [-14, -5, -6];
    var DEFAULT_TOPUP_MAX_STARS = 100000;

    function resolveTopupMaxStars() {
        var topupConfig = (globalScope.CHINA_SLOT_TEVI_CONFIG && globalScope.CHINA_SLOT_TEVI_CONFIG.topup) || {};
        var max = Number(topupConfig.maxStars);
        return isFinite(max) && max > 0 ? max : DEFAULT_TOPUP_MAX_STARS;
    }

    function getSdkErrorCode(response) {
        return response && typeof response.error_code === "number" ? response.error_code : null;
    }

    function isLegacyTopupError(response) {
        if (!response) return false;
        return !!response.error || response.call === "error" || response.success === false;
    }

    function topupErrorReason(response) {
        var code = response && response.error && response.error.code;
        return typeof code === "string" && code.length > 0 ? "provider-error:" + code : "provider-error";
    }

    function extractSafeTopupReference(response) {
        var data = response && response.data;
        if (!data) return null;
        var candidate = data.reference || data.referenceId || data.transactionId || data.transaction_id || data.id;
        return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
    }

    function normalizeTopupOutcome(response) {
        if (isCancellation(response)) {
            return topupState("canceled", "user-cancelled");
        }

        var errorCode = getSdkErrorCode(response);
        if (errorCode !== null && errorCode !== 0) {
            // Reason carries only the numeric code — never error_message (provider text).
            var transient = RETRYABLE_SDK_ERROR_CODES.indexOf(errorCode) !== -1;
            return topupState(transient ? "retryable-failure" : "failed", "sdk-error:" + errorCode);
        }

        if (isLegacyTopupError(response)) {
            return topupState("failed", topupErrorReason(response));
        }

        var pending = topupState("webhook-pending", "sdk-confirmed");
        var reference = extractSafeTopupReference(response);
        if (reference) pending.reference = reference;
        return pending;
    }

    function runTopup(config, options) {
        if (!config.enabled) return Promise.resolve(topupState("failed", "tevi-mode-disabled"));

        var sdk = getSdk();
        if (!sdk) return Promise.resolve(topupState("retryable-failure", "sdk-unavailable"));
        if (typeof sdk.topup !== "function") return Promise.resolve(topupState("retryable-failure", "method-unavailable"));

        if (!isPositiveInteger(options.amount)) return Promise.resolve(topupState("failed", "invalid-amount"));
        if (options.amount > resolveTopupMaxStars()) return Promise.resolve(topupState("failed", "amount-too-large"));

        var depositToken = options.depositToken;
        var hasToken = typeof depositToken === "string" && depositToken.length > 0;
        // The token-less SDK call exists only for the manual 403 verification path, and is
        // gated to non-production so it can never ship as a normal deposit path.
        var allowForcedNoToken = options.forceSdkCallWithoutToken === true && config.environment !== "production";
        if (!hasToken && !allowForcedNoToken) {
            return Promise.resolve(topupState("failed", "deposit-token-missing"));
        }

        var sdkOptions = {
            amount: options.amount,
            channel_id: config.channelId,
            metadata: buildSafeTopupMetadata(options)
        };
        if (hasToken) sdkOptions.deposit_token = depositToken;

        return new Promise(function (resolve) {
            var settled = false;
            var timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : 60000;
            var timeoutId = setTimeout(function () {
                complete(topupState("retryable-failure", "sdk-timeout"));
            }, timeoutMs);

            function complete(result) {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                resolve(result);
            }

            try {
                sdk.topup(sdkOptions, function (response) {
                    complete(normalizeTopupOutcome(response));
                });
            } catch (_error) {
                complete(topupState("failed", "sdk-call-failed"));
            }
        });
    }

    function loadSdkScript(config) {
        if (!config.enabled) return Promise.resolve({ available: false, reason: "tevi-mode-disabled" });
        if (getSdk()) return Promise.resolve({ available: true, reason: "sdk-present" });

        var browserDocument = getDocument();
        if (!browserDocument || !browserDocument.createElement || !browserDocument.head) {
            return Promise.resolve({ available: false, reason: "document-unavailable" });
        }

        if (browserDocument.querySelector && browserDocument.querySelector('script[src="' + config.sdkUrl + '"]')) {
            return Promise.resolve({ available: true, reason: "sdk-script-present" });
        }

        if (sdkScriptRequest) return sdkScriptRequest;

        var script = browserDocument.createElement("script");
        var resolveRequest;
        var request;

        request = new Promise(function (resolve) {
            resolveRequest = resolve;
        });
        sdkScriptRequest = request;

        script.async = true;
        script.src = config.sdkUrl;
        script.onload = function () { resolveRequest({ available: true, reason: "sdk-script-loaded" }); };
        script.onerror = function () {
            sdkScriptRequest = null;
            resolveRequest({ available: false, reason: "sdk-script-error" });
        };
        browserDocument.head.appendChild(script);

        return request;
    }

    function renderDebugPanel(client) {
        if (!isQueryFlagEnabled("debugTevi")) return;

        var browserDocument = getDocument();
        if (!browserDocument || !browserDocument.createElement || !browserDocument.body) return;

        var existingPanel = debugPanelElement || (browserDocument.querySelector && browserDocument.querySelector("[data-china-slot-tevi-debug]"));
        var panel = existingPanel || browserDocument.createElement("pre");
        var state = client.getState();
        panel.textContent = [
            "China Slot Tevi Debug",
            "mode: " + state.mode,
            "environment: " + state.environment,
            "sdkAvailable: " + state.sdkAvailable,
            "appId: " + state.appId,
            "channelId: " + state.channelId,
            "appUrl: " + state.appUrl,
            "webhookUrl: " + state.webhookUrl
        ].join("\n");
        panel.setAttribute && panel.setAttribute("data-china-slot-tevi-debug", "true");
        panel.style.position = "fixed";
        panel.style.left = "8px";
        panel.style.bottom = "8px";
        panel.style.zIndex = "999999";
        panel.style.maxWidth = "calc(100vw - 16px)";
        panel.style.padding = "8px";
        panel.style.margin = "0";
        panel.style.border = "1px solid #2dd4bf";
        panel.style.borderRadius = "6px";
        panel.style.background = "rgba(0, 0, 0, 0.82)";
        panel.style.color = "#e6fffb";
        panel.style.font = "12px monospace";
        panel.style.whiteSpace = "pre-wrap";
        panel.style.pointerEvents = "none";

        if (!existingPanel) browserDocument.body.appendChild(panel);
        debugPanelElement = panel;
    }

    function createClient(options) {
        var config = resolveRuntimeConfig(options);
        var client;

        client = {
            initialize: function () {
                renderDebugPanel(client);
                return loadSdkScript(config).then(function (result) {
                    if (!result.available) return result;
                    callSdkMethod("showBackButton");
                    callSdkMethod("showCloseButton");
                    callSdkMethod("loadConfig");
                    renderDebugPanel(client);
                    return result;
                });
            },
            getState: function () {
                return {
                    mode: config.enabled ? "tevi" : "local",
                    environment: config.environment,
                    sdkAvailable: !!getSdk(),
                    appId: config.appId,
                    channelId: config.channelId,
                    appUrl: config.appUrl,
                    webhookUrl: config.webhookUrl
                };
            },
            isTeviMode: function () { return config.enabled; },
            isSdkAvailable: function () { return !!getSdk(); },
            getUserAppToken: function (options) { return getUserAppToken(config, options || {}); },
            topup: function (options) { return runTopup(config, options || {}); },
            showBackButton: function () { return callSdkMethod("showBackButton"); },
            showCloseButton: function () { return callSdkMethod("showCloseButton"); },
            loadConfig: function () { return callSdkMethod("loadConfig"); },
            close: function () {
                var quitResult = callSdkMethod("quitGame");
                if (quitResult.available) return quitResult;
                return callSdkMethod("close");
            }
        };

        return client;
    }

    globalScope.ChinaSlotTeviClient = {
        createFromWindow: function (options) { return createClient(options || {}); },
        resolveRuntimeConfig: resolveRuntimeConfig
    };
})(typeof window !== "undefined" ? window : globalThis);
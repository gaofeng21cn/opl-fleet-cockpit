package cn.gaofeng.ambientops.kiosk;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class MainActivity extends Activity {
    private static final String LOCAL_DISPLAY_URL =
        "file:///android_asset/ambient-ops/index.html";
    private static final String PREFS = "ambient_ops_kiosk";
    private static final String PREF_ENDPOINT = "last_endpoint";
    private static final String PREF_INSTANCE_ID = "last_instance_id";
    private static final String PREF_SOURCE_ID = "last_source_id";
    private static final String PREF_SOURCE_KIND = "last_source_kind";
    private static final String PREF_SOURCE_NAME = "last_source_name";
    private static final String PREF_MANUAL_URL = "manual_url";
    private static final String PREF_MANUAL_KIND = "manual_source_kind";
    private static final String EXTRA_URL = "ambient_ops_url";
    private static final String EXTRA_INSTANCE_ID = "ambient_ops_instance_id";
    private static final String EXTRA_SOURCE_KIND = "ambient_ops_source_kind";
    private static final long RETRY_DELAY_MS = 2_000L;
    private static final long LOAD_TIMEOUT_MS = 10_000L;
    private static final long AUTOMATIC_SELECTION_DELAY_MS = 800L;
    private static final long UPDATE_INITIAL_DELAY_MS = 10_000L;
    private static final long UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1_000L;
    private static final long UI_REVISION_INITIAL_DELAY_MS = 2_000L;
    private static final long UI_REVISION_INTERVAL_MS = 15_000L;
    private static final float DEFAULT_SCREEN_BRIGHTNESS = 0.5f;
    private static final int IMMERSIVE_FLAGS =
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<DisplaySource> discoveredSources = new ArrayList<>();
    private WebView webView;
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;
    private SharedPreferences preferences;
    private KioskUpdater kioskUpdater;
    private UiRevisionMonitor uiRevisionMonitor;
    private DualModeDiscovery discovery;
    private DisplaySource currentSource;
    private boolean pageLoaded;
    private boolean endpointAttemptInProgress;
    private boolean activityResumed;

    private final Runnable retry = () -> {
        DisplaySource preferred = preferredSource();
        if (preferred != null) {
            loadSource(preferred);
        } else {
            showDiscoveryState("正在查找 Fleet Gateway 与 Fleet Agent");
            startDiscovery();
        }
    };
    private final Runnable loadTimeout = () -> {
        if (pageLoaded || !endpointAttemptInProgress || webView == null) {
            return;
        }
        webView.stopLoading();
        handleLoadFailure();
    };
    private final Runnable automaticSelection = () -> {
        if (validHttpUrl(preferences.getString(PREF_MANUAL_URL, null))) {
            return;
        }
        DisplaySource selected = ServiceSelectionPolicy.automaticSource(
            discoveredSources,
            rememberedSourceId()
        );
        if (selected != null) {
            selectDiscoveredSource(selected);
        } else if (!pageLoaded && !endpointAttemptInProgress && discoveredSources.size() > 1) {
            showDiscoveryState("发现多个 OPL Fleet Agent，等待已保存来源或 Gateway");
        }
    };
    private final Runnable updateCheck = new Runnable() {
        @Override
        public void run() {
            if (kioskUpdater != null && pageLoaded && isGatewaySource()) {
                kioskUpdater.check(currentSource.endpoint);
                handler.postDelayed(this, UPDATE_INTERVAL_MS);
            }
        }
    };
    private final Runnable uiRevisionCheck = new Runnable() {
        @Override
        public void run() {
            if (
                uiRevisionMonitor != null
                    && activityResumed
                    && pageLoaded
                    && isGatewaySource()
            ) {
                DisplaySource source = currentSource;
                uiRevisionMonitor.check(
                    source.endpoint,
                    () -> handler.post(() -> reloadForUiRevision(source))
                );
                handler.postDelayed(this, UI_REVISION_INTERVAL_MS);
            }
        }
    };

    @Override
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(DisplayPowerPolicy.windowFlags());
        WindowManager.LayoutParams layout = getWindow().getAttributes();
        layout.screenBrightness = DEFAULT_SCREEN_BRIGHTNESS;
        getWindow().setAttributes(layout);
        enterImmersiveMode();

        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        kioskUpdater = new KioskUpdater(this);
        uiRevisionMonitor = new UiRevisionMonitor();
        applyConfiguration(getIntent());
        discovery = new DualModeDiscovery(this, new DualModeDiscovery.Listener() {
            @Override
            public void onSourcesChanged(List<DisplaySource> sources) {
                handler.post(() -> handleDiscoveredSources(sources));
            }

            @Override
            public void onDiscoveryError() {
                handler.post(MainActivity.this::scheduleRetry);
            }
        });

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(12, 15, 18));
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        webView.getSettings().setUserAgentString(
            webView.getSettings().getUserAgentString()
                + " AmbientOpsKiosk/"
                + BuildConfig.VERSION_NAME
        );
        webView.addJavascriptInterface(new DirectStatusBridge(), "AmbientOpsNative");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (currentSource != null && currentSource.kind == DisplaySource.Kind.DIRECT) {
                    verifyDirectShell(view, url);
                } else {
                    verifyGatewayPage(view, url);
                }
                enterImmersiveMode();
            }

            @Override
            public void onReceivedError(
                WebView view,
                WebResourceRequest request,
                WebResourceError error
            ) {
                if (request.isForMainFrame()) {
                    handleLoadFailure();
                }
            }

            @Override
            public void onReceivedHttpError(
                WebView view,
                WebResourceRequest request,
                WebResourceResponse errorResponse
            ) {
                if (request.isForMainFrame()) {
                    handleLoadFailure();
                }
            }
        });
        setContentView(webView);

        String requestedUrl = getIntent() == null
            ? null
            : getIntent().getStringExtra(EXTRA_URL);
        currentSource = validHttpUrl(requestedUrl)
            ? manualSource(requestedUrl)
            : preferredSource();
        if (currentSource != null) {
            loadSource(currentSource);
        } else {
            showDiscoveryState("正在查找 Fleet Gateway 与 Fleet Agent");
        }
        startDiscovery();
        registerNetworkRetry();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        applyConfiguration(intent);
        String requestedUrl = intent == null ? null : intent.getStringExtra(EXTRA_URL);
        if (validHttpUrl(requestedUrl)) {
            loadSource(manualSource(requestedUrl));
        } else if (!pageLoaded && !endpointAttemptInProgress) {
            handler.post(retry);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        activityResumed = true;
        enterImmersiveMode();
        if (webView != null && !pageLoaded && !endpointAttemptInProgress) {
            handler.post(retry);
        } else if (pageLoaded) {
            scheduleUiRevisionCheck();
        }
    }

    @Override
    protected void onPause() {
        activityResumed = false;
        handler.removeCallbacks(uiRevisionCheck);
        super.onPause();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enterImmersiveMode();
        }
    }

    @Override
    public void onBackPressed() {
        if (currentSource != null) {
            loadSource(currentSource);
        }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        unregisterNetworkRetry();
        if (discovery != null) {
            discovery.stop();
            discovery = null;
        }
        if (kioskUpdater != null) {
            kioskUpdater.close();
            kioskUpdater = null;
        }
        if (uiRevisionMonitor != null) {
            uiRevisionMonitor.close();
            uiRevisionMonitor = null;
        }
        if (webView != null) {
            webView.removeJavascriptInterface("AmbientOpsNative");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private void startDiscovery() {
        if (discovery != null) {
            discovery.start();
        }
    }

    private void handleDiscoveredSources(List<DisplaySource> sources) {
        discoveredSources.clear();
        discoveredSources.addAll(sources);
        if (validHttpUrl(preferences.getString(PREF_MANUAL_URL, null))) {
            return;
        }

        String remembered = rememberedSourceId();
        if (remembered != null) {
            for (DisplaySource source : discoveredSources) {
                if (remembered.equals(source.id)) {
                    handler.removeCallbacks(automaticSelection);
                    selectDiscoveredSource(source);
                    return;
                }
            }
        }
        handler.removeCallbacks(automaticSelection);
        handler.postDelayed(automaticSelection, AUTOMATIC_SELECTION_DELAY_MS);
    }

    private void selectDiscoveredSource(DisplaySource source) {
        if (
            pageLoaded
                && currentSource != null
                && currentSource.id.equals(source.id)
                && currentSource.endpoint.equals(source.endpoint)
        ) {
            return;
        }
        persistSource(source);
        loadSource(source);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void loadSource(DisplaySource source) {
        if (source == null || !validHttpUrl(source.endpoint)) {
            return;
        }
        currentSource = source;
        pageLoaded = false;
        endpointAttemptInProgress = true;
        handler.removeCallbacks(retry);
        handler.removeCallbacks(loadTimeout);
        handler.removeCallbacks(updateCheck);
        handler.removeCallbacks(uiRevisionCheck);
        handler.postDelayed(loadTimeout, LOAD_TIMEOUT_MS);

        if (source.isGateway()) {
            webView.getSettings().setAllowUniversalAccessFromFileURLs(false);
            if (uiRevisionMonitor != null) {
                uiRevisionMonitor.selectEndpoint(source.endpoint);
            }
            webView.loadUrl(source.endpoint);
        } else {
            webView.getSettings().setAllowUniversalAccessFromFileURLs(true);
            webView.loadUrl(
                LOCAL_DISPLAY_URL
                    + "?statusUrl="
                    + Uri.encode(source.endpoint)
                    + "&view=overview"
            );
        }
    }

    private void verifyGatewayPage(WebView view, String url) {
        if (
            currentSource == null
                || !currentSource.isGateway()
                || !ServiceSelectionPolicy.shouldMarkPageHealthy(currentSource.endpoint, url)
        ) {
            return;
        }
        view.evaluateJavascript(
            "document.getElementById('root') !== null",
            result -> {
                if (
                    view == webView
                        && "true".equals(result)
                        && currentSource != null
                        && currentSource.isGateway()
                        && ServiceSelectionPolicy.shouldMarkPageHealthy(
                            currentSource.endpoint,
                            url
                        )
                ) {
                    markPageHealthy();
                }
            }
        );
    }

    private void verifyDirectShell(WebView view, String url) {
        if (!url.startsWith(LOCAL_DISPLAY_URL)) {
            return;
        }
        view.evaluateJavascript(
            "document.getElementById('root') !== null",
            result -> {
                if (view == webView && !"true".equals(result)) {
                    handleLoadFailure();
                }
            }
        );
    }

    private void markPageHealthy() {
        if (currentSource == null) {
            return;
        }
        pageLoaded = true;
        endpointAttemptInProgress = false;
        handler.removeCallbacks(retry);
        handler.removeCallbacks(loadTimeout);
        persistSource(currentSource);
        if (currentSource.isGateway()) {
            handler.postDelayed(updateCheck, UPDATE_INITIAL_DELAY_MS);
            scheduleUiRevisionCheck();
        }
    }

    private void scheduleUiRevisionCheck() {
        handler.removeCallbacks(uiRevisionCheck);
        if (activityResumed && pageLoaded && isGatewaySource()) {
            handler.postDelayed(uiRevisionCheck, UI_REVISION_INITIAL_DELAY_MS);
        }
    }

    private void reloadForUiRevision(DisplaySource source) {
        if (
            !activityResumed
                || webView == null
                || !pageLoaded
                || currentSource == null
                || !currentSource.equals(source)
                || !source.isGateway()
        ) {
            return;
        }
        pageLoaded = false;
        endpointAttemptInProgress = true;
        handler.removeCallbacks(uiRevisionCheck);
        handler.removeCallbacks(loadTimeout);
        handler.postDelayed(loadTimeout, LOAD_TIMEOUT_MS);
        webView.reload();
    }

    private void handleLoadFailure() {
        if (webView == null) {
            return;
        }
        pageLoaded = false;
        endpointAttemptInProgress = false;
        handler.removeCallbacks(loadTimeout);
        handler.removeCallbacks(updateCheck);
        handler.removeCallbacks(uiRevisionCheck);
        showDiscoveryState("当前来源暂时不可用，正在重新查找");
        startDiscovery();
        scheduleRetry();
    }

    private void scheduleRetry() {
        handler.removeCallbacks(retry);
        handler.postDelayed(retry, RETRY_DELAY_MS);
    }

    private void registerNetworkRetry() {
        connectivityManager =
            (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivityManager == null) {
            return;
        }
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                handler.post(() -> {
                    if (!pageLoaded && !endpointAttemptInProgress) {
                        handler.post(retry);
                    }
                    startDiscovery();
                });
            }
        };
        try {
            connectivityManager.registerNetworkCallback(
                new NetworkRequest.Builder()
                    .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                    .build(),
                networkCallback
            );
        } catch (RuntimeException error) {
            networkCallback = null;
        }
    }

    private void unregisterNetworkRetry() {
        if (connectivityManager == null || networkCallback == null) {
            return;
        }
        try {
            connectivityManager.unregisterNetworkCallback(networkCallback);
        } catch (RuntimeException ignored) {
            // Android may already have released callbacks while shutting down.
        }
        networkCallback = null;
    }

    private DisplaySource preferredSource() {
        String manualUrl = preferences == null
            ? null
            : preferences.getString(PREF_MANUAL_URL, null);
        if (validHttpUrl(manualUrl)) {
            return manualSource(manualUrl);
        }
        if (currentSource != null && validHttpUrl(currentSource.endpoint)) {
            return currentSource;
        }
        String endpoint = preferences == null
            ? null
            : preferences.getString(PREF_ENDPOINT, null);
        if (!validHttpUrl(endpoint)) {
            return null;
        }
        DisplaySource.Kind kind = DisplaySource.Kind.fromPreference(
            preferences.getString(PREF_SOURCE_KIND, DisplaySource.Kind.GATEWAY.preferenceValue)
        );
        String instanceId = preferences.getString(PREF_INSTANCE_ID, endpoint);
        String id = rememberedSourceId();
        if (id == null) {
            id = kind.preferenceValue + ":" + instanceId;
        }
        String name = preferences.getString(PREF_SOURCE_NAME, "OPL Fleet Telemetry Gateway");
        return new DisplaySource(id, instanceId, name, endpoint, kind);
    }

    private String rememberedSourceId() {
        if (preferences == null) {
            return null;
        }
        String id = preferences.getString(PREF_SOURCE_ID, null);
        if (id != null && !id.isEmpty()) {
            return id;
        }
        String oldInstanceId = preferences.getString(PREF_INSTANCE_ID, null);
        return oldInstanceId == null || oldInstanceId.isEmpty()
            ? null
            : DisplaySource.Kind.GATEWAY.preferenceValue + ":" + oldInstanceId;
    }

    private DisplaySource manualSource(String endpoint) {
        String instanceId = preferences == null
            ? "manual"
            : preferences.getString(PREF_INSTANCE_ID, "manual");
        DisplaySource.Kind kind = preferences == null
            ? DisplaySource.Kind.GATEWAY
            : DisplaySource.Kind.fromPreference(
                preferences.getString(
                    PREF_MANUAL_KIND,
                    DisplaySource.Kind.GATEWAY.preferenceValue
                )
            );
        return new DisplaySource(
            kind.preferenceValue + ":" + instanceId,
            instanceId,
            kind == DisplaySource.Kind.DIRECT
                ? "Manual OPL Fleet Agent"
                : "Manual OPL Fleet Telemetry Gateway",
            endpoint,
            kind
        );
    }

    private void persistSource(DisplaySource source) {
        preferences.edit()
            .putString(PREF_ENDPOINT, source.endpoint)
            .putString(PREF_INSTANCE_ID, source.instanceId)
            .putString(PREF_SOURCE_ID, source.id)
            .putString(PREF_SOURCE_KIND, source.kind.preferenceValue)
            .putString(PREF_SOURCE_NAME, source.name)
            .apply();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void showDiscoveryState(String message) {
        if (webView == null) {
            return;
        }
        webView.getSettings().setAllowUniversalAccessFromFileURLs(false);
        String html =
            "<!doctype html><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<style>html,body{height:100%;margin:0;background:#0c0f12;color:#eef3f7;"
                + "font-family:sans-serif}body{display:grid;place-items:center}"
                + "main{text-align:center}strong{font-size:30px;font-weight:500}"
                + "p{font-size:16px;color:#9aa5ae}</style><main><strong>"
                + escapeHtml(message)
                + "</strong><p>OPL Fleet Telemetry Gateway · OPL Fleet Agent</p></main>";
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    private boolean applyConfiguration(Intent intent) {
        if (intent == null) {
            return false;
        }
        String url = intent.getStringExtra(EXTRA_URL);
        String instanceId = intent.getStringExtra(EXTRA_INSTANCE_ID);
        String sourceKind = intent.getStringExtra(EXTRA_SOURCE_KIND);
        SharedPreferences.Editor editor = getSharedPreferences(PREFS, MODE_PRIVATE).edit();
        boolean changed = false;
        if (validHttpUrl(url)) {
            editor.putString(PREF_MANUAL_URL, url);
            changed = true;
        }
        if (instanceId != null && instanceId.matches("[A-Za-z0-9._-]{1,80}")) {
            editor.putString(PREF_INSTANCE_ID, instanceId.toLowerCase(Locale.US));
            changed = true;
        }
        if (
            DisplaySource.Kind.GATEWAY.preferenceValue.equals(sourceKind)
                || DisplaySource.Kind.DIRECT.preferenceValue.equals(sourceKind)
        ) {
            editor.putString(PREF_MANUAL_KIND, sourceKind);
            changed = true;
        }
        if (changed) {
            editor.apply();
        }
        return changed;
    }

    private boolean validHttpUrl(String value) {
        if (value == null) {
            return false;
        }
        Uri uri = Uri.parse(value);
        return ("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
            && uri.getHost() != null;
    }

    private boolean isGatewaySource() {
        return currentSource != null && currentSource.isGateway();
    }

    private String escapeHtml(String value) {
        return value
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;");
    }

    private void enterImmersiveMode() {
        getWindow().getDecorView().setSystemUiVisibility(IMMERSIVE_FLAGS);
    }

    private final class DirectStatusBridge {
        @JavascriptInterface
        public void statusChanged(String state) {
            handler.post(() -> {
                if (currentSource == null || currentSource.kind != DisplaySource.Kind.DIRECT) {
                    return;
                }
                if ("live".equals(state)) {
                    markPageHealthy();
                } else if ("stale".equals(state) && pageLoaded) {
                    handleLoadFailure();
                }
            });
        }
    }
}

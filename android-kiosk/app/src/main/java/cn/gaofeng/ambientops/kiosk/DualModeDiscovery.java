package cn.gaofeng.ambientops.kiosk;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Handler;
import android.os.Looper;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

final class DualModeDiscovery {
    interface Listener {
        void onSourcesChanged(List<DisplaySource> sources);
        void onDiscoveryError();
    }

    private static final String GATEWAY_TYPE = "_ambient-ops._tcp.";
    private static final String DIRECT_TYPE = "_opl-fleet-agent._tcp.";
    private static final String GATEWAY_PATH = "/display/overview";
    private static final String DIRECT_PATH = "/api/v1/status";
    private static final long RESOLVE_TIMEOUT_MS = 5_000L;

    private final NsdManager manager;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Listener listener;
    private final Map<String, DisplaySource> sources = new HashMap<>();
    private final Map<String, String> sourceIdsByService = new HashMap<>();
    private final ArrayDeque<PendingService> resolveQueue = new ArrayDeque<>();
    private NsdManager.DiscoveryListener gatewayListener;
    private NsdManager.DiscoveryListener directListener;
    private PendingService resolving;
    private boolean running;

    DualModeDiscovery(Context context, Listener listener) {
        manager = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
        this.listener = listener;
    }

    void start() {
        if (running || manager == null) {
            return;
        }
        running = true;
        sources.clear();
        sourceIdsByService.clear();
        resolveQueue.clear();
        publish();
        gatewayListener = createDiscoveryListener(GATEWAY_TYPE, DisplaySource.Kind.GATEWAY);
        directListener = createDiscoveryListener(DIRECT_TYPE, DisplaySource.Kind.DIRECT);
        discover(GATEWAY_TYPE, gatewayListener);
        discover(DIRECT_TYPE, directListener);
    }

    void stop() {
        running = false;
        handler.removeCallbacksAndMessages(null);
        stopListener(gatewayListener);
        stopListener(directListener);
        gatewayListener = null;
        directListener = null;
        resolving = null;
        resolveQueue.clear();
    }

    private void discover(String type, NsdManager.DiscoveryListener discoveryListener) {
        try {
            manager.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, discoveryListener);
        } catch (RuntimeException error) {
            handler.post(this::failDiscovery);
        }
    }

    private NsdManager.DiscoveryListener createDiscoveryListener(
        String expectedType,
        DisplaySource.Kind kind
    ) {
        return new NsdManager.DiscoveryListener() {
            @Override
            public void onDiscoveryStarted(String serviceType) {}

            @Override
            public void onServiceFound(NsdServiceInfo serviceInfo) {
                if (!running || !expectedType.equals(serviceInfo.getServiceType())) {
                    return;
                }
                String key = serviceKey(serviceInfo, kind);
                if (sourceIdsByService.containsKey(key) || containsQueued(key)) {
                    return;
                }
                resolveQueue.addLast(new PendingService(key, serviceInfo, kind));
                resolveNext();
            }

            @Override
            public void onServiceLost(NsdServiceInfo serviceInfo) {
                String sourceId = sourceIdsByService.remove(serviceKey(serviceInfo, kind));
                if (sourceId != null && sources.remove(sourceId) != null) {
                    publish();
                }
            }

            @Override
            public void onDiscoveryStopped(String serviceType) {}

            @Override
            public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                handler.post(DualModeDiscovery.this::failDiscovery);
            }

            @Override
            public void onStopDiscoveryFailed(String serviceType, int errorCode) {}
        };
    }

    private void resolveNext() {
        if (!running || resolving != null || resolveQueue.isEmpty()) {
            return;
        }
        PendingService pending = resolveQueue.removeFirst();
        resolving = pending;
        Runnable timeout = () -> finishResolve(pending, null);
        pending.timeout = timeout;
        handler.postDelayed(timeout, RESOLVE_TIMEOUT_MS);
        try {
            manager.resolveService(pending.serviceInfo, new NsdManager.ResolveListener() {
                @Override
                public void onResolveFailed(NsdServiceInfo serviceInfo, int errorCode) {
                    handler.post(() -> finishResolve(pending, null));
                }

                @Override
                public void onServiceResolved(NsdServiceInfo serviceInfo) {
                    handler.post(() -> finishResolve(pending, serviceInfo));
                }
            });
        } catch (RuntimeException error) {
            finishResolve(pending, null);
        }
    }

    private void finishResolve(PendingService pending, NsdServiceInfo resolved) {
        if (resolving != pending) {
            return;
        }
        handler.removeCallbacks(pending.timeout);
        resolving = null;
        if (running && resolved != null) {
            DisplaySource source = source(resolved, pending.kind);
            if (source != null) {
                sourceIdsByService.put(pending.key, source.id);
                sources.put(source.id, source);
                publish();
            }
        }
        resolveNext();
    }

    private DisplaySource source(NsdServiceInfo serviceInfo, DisplaySource.Kind kind) {
        InetAddress host = serviceInfo.getHost();
        int port = serviceInfo.getPort();
        if (host == null || port <= 0) {
            return null;
        }
        String address = host.getHostAddress();
        if (address == null || address.isEmpty()) {
            return null;
        }
        if (address.contains(":")) {
            address = "[" + address.replaceAll("%.*$", "") + "]";
        }
        String instanceId = attribute(serviceInfo, "id");
        if (instanceId == null || instanceId.isEmpty()) {
            instanceId = serviceInfo.getServiceName();
        }
        String name = attribute(serviceInfo, "name");
        if (name == null || name.isEmpty()) {
            name = serviceInfo.getServiceName();
        }
        String path = attribute(serviceInfo, kind == DisplaySource.Kind.DIRECT ? "api" : "path");
        if (path == null || !path.startsWith("/") || path.startsWith("//")) {
            path = kind == DisplaySource.Kind.DIRECT ? DIRECT_PATH : GATEWAY_PATH;
        }
        String endpoint = String.format(Locale.US, "http://%s:%d%s", address, port, path);
        return new DisplaySource(
            kind.preferenceValue + ":" + instanceId,
            instanceId,
            name,
            endpoint,
            kind
        );
    }

    private String attribute(NsdServiceInfo serviceInfo, String key) {
        byte[] value = serviceInfo.getAttributes().get(key);
        return value == null ? null : new String(value, StandardCharsets.UTF_8);
    }

    private boolean containsQueued(String key) {
        if (resolving != null && resolving.key.equals(key)) {
            return true;
        }
        for (PendingService pending : resolveQueue) {
            if (pending.key.equals(key)) {
                return true;
            }
        }
        return false;
    }

    private String serviceKey(NsdServiceInfo serviceInfo, DisplaySource.Kind kind) {
        return kind.preferenceValue + ":" + serviceInfo.getServiceName();
    }

    private void publish() {
        List<DisplaySource> current = new ArrayList<>(sources.values());
        current.sort(Comparator.comparing(source -> source.name, String.CASE_INSENSITIVE_ORDER));
        listener.onSourcesChanged(Collections.unmodifiableList(current));
    }

    private void failDiscovery() {
        if (!running) {
            return;
        }
        stop();
        listener.onDiscoveryError();
    }

    private void stopListener(NsdManager.DiscoveryListener discoveryListener) {
        if (manager == null || discoveryListener == null) {
            return;
        }
        try {
            manager.stopServiceDiscovery(discoveryListener);
        } catch (IllegalArgumentException ignored) {
            // Android may already have stopped discovery after a network transition.
        }
    }

    private static final class PendingService {
        final String key;
        final NsdServiceInfo serviceInfo;
        final DisplaySource.Kind kind;
        Runnable timeout;

        PendingService(String key, NsdServiceInfo serviceInfo, DisplaySource.Kind kind) {
            this.key = key;
            this.serviceInfo = serviceInfo;
            this.kind = kind;
        }
    }
}

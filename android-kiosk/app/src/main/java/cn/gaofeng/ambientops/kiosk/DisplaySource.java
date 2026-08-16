package cn.gaofeng.ambientops.kiosk;

import java.util.Objects;

final class DisplaySource {
    enum Kind {
        GATEWAY("gateway"),
        DIRECT("fleetAgent");

        final String preferenceValue;

        Kind(String preferenceValue) {
            this.preferenceValue = preferenceValue;
        }

        static Kind fromPreference(String value) {
            return DIRECT.preferenceValue.equals(value) ? DIRECT : GATEWAY;
        }
    }

    final String id;
    final String instanceId;
    final String name;
    final String endpoint;
    final Kind kind;

    DisplaySource(String id, String instanceId, String name, String endpoint, Kind kind) {
        this.id = id;
        this.instanceId = instanceId;
        this.name = name;
        this.endpoint = endpoint;
        this.kind = kind;
    }

    boolean isGateway() {
        return kind == Kind.GATEWAY;
    }

    @Override
    public boolean equals(Object other) {
        if (!(other instanceof DisplaySource)) {
            return false;
        }
        DisplaySource source = (DisplaySource) other;
        return Objects.equals(id, source.id)
            && Objects.equals(endpoint, source.endpoint)
            && kind == source.kind;
    }

    @Override
    public int hashCode() {
        return Objects.hash(id, endpoint, kind);
    }
}

package cn.gaofeng.ambientops.kiosk;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.util.Arrays;
import java.util.Collections;

import org.junit.Test;

public final class ServiceSelectionPolicyTest {
    @Test
    public void savedSourceWinsEvenWhenGatewayIsAvailable() {
        DisplaySource gateway = source("gateway:home", "Home", DisplaySource.Kind.GATEWAY);
        DisplaySource direct = source("fleetAgent:studio", "Studio", DisplaySource.Kind.DIRECT);
        assertEquals(
            direct,
            ServiceSelectionPolicy.automaticSource(Arrays.asList(gateway, direct), direct.id)
        );
    }

    @Test
    public void gatewayWinsWithoutSavedSource() {
        DisplaySource gateway = source("gateway:home", "Home", DisplaySource.Kind.GATEWAY);
        DisplaySource direct = source("fleetAgent:studio", "Studio", DisplaySource.Kind.DIRECT);
        assertEquals(
            gateway,
            ServiceSelectionPolicy.automaticSource(Arrays.asList(direct, gateway), null)
        );
    }

    @Test
    public void gatewayChoiceIsDeterministic() {
        DisplaySource beta = source("gateway:beta", "Beta", DisplaySource.Kind.GATEWAY);
        DisplaySource alpha = source("gateway:alpha", "Alpha", DisplaySource.Kind.GATEWAY);
        assertEquals(
            alpha,
            ServiceSelectionPolicy.automaticSource(Arrays.asList(beta, alpha), null)
        );
    }

    @Test
    public void uniqueDirectIsSelectedWithoutGateway() {
        DisplaySource direct = source("fleetAgent:studio", "Studio", DisplaySource.Kind.DIRECT);
        assertEquals(
            direct,
            ServiceSelectionPolicy.automaticSource(Collections.singletonList(direct), null)
        );
    }

    @Test
    public void multipleDirectSourcesDoNotRaceForSelection() {
        DisplaySource studio = source("fleetAgent:studio", "Studio", DisplaySource.Kind.DIRECT);
        DisplaySource notebook = source("fleetAgent:notebook", "Notebook", DisplaySource.Kind.DIRECT);
        assertNull(
            ServiceSelectionPolicy.automaticSource(Arrays.asList(studio, notebook), null)
        );
    }

    @Test
    public void currentEndpointCompletionMarksPageHealthy() {
        assertEquals(
            true,
            ServiceSelectionPolicy.shouldMarkPageHealthy(
                "http://192.168.1.10:8791/display/overview",
                "http://192.168.1.10:8791/display/overview"
            )
        );
    }

    @Test
    public void staleEndpointCompletionDoesNotMarkNewEndpointHealthy() {
        assertEquals(
            false,
            ServiceSelectionPolicy.shouldMarkPageHealthy(
                "http://192.168.1.11:8791/display/overview",
                "http://192.168.1.10:8791/display/overview"
            )
        );
    }

    private DisplaySource source(String id, String name, DisplaySource.Kind kind) {
        return new DisplaySource(id, id, name, "http://127.0.0.1", kind);
    }
}

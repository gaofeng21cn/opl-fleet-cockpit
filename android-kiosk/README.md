# Ambient Ops Android Kiosk

This small native Android application owns the HTC display surface. It discovers
both `_ambient-ops._tcp.local` Gateways and `_opl-fleet-agent._tcp.local` Direct sources
with Android NSD, remembers the last successful source, keeps the screen awake,
restores immersive mode, retries after connection failures, and can act as the
default Home application. The saved source wins; otherwise Gateway wins; otherwise
one unique Direct source is selected. Multiple Direct sources never race for focus.
Normal operation uses Wi-Fi discovery and does not require USB or `adb reverse`.
On a rooted dedicated display, it also performs trusted unattended upgrades
from the selected Ambient Ops server.

The visible kiosk prevents Android's inactivity timeout, but never wakes a
display that the user turned off. Boot, package replacement, discovery, and
update checks may restore the Home activity in the background without turning
the screen on. When the user turns the screen back on, the existing activity
returns directly to the dashboard.

## Build and test

The project requires JDK 17 and Android SDK 35. On a Homebrew-based Mac, a
typical local setup is:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
./gradlew :app:testDebugUnitTest :app:assembleDebug
```

The debug APK is written to
`app/build/outputs/apk/debug/app-debug.apk`.

Use the unsigned release-like variant to qualify optimized production code
without signing credentials:

```bash
./gradlew :app:testReleaseUnsignedUnitTest :app:assembleReleaseUnsigned
```

Its APK is intentionally non-distributable. A real `assembleRelease`,
`bundleRelease`, or aggregate task that includes the signed release fails before
execution unless all signing inputs below are present and the keystore is a
readable file:

```bash
export AMBIENT_OPS_ANDROID_KEYSTORE=/absolute/path/to/release.keystore
export AMBIENT_OPS_ANDROID_KEYSTORE_PASSWORD='...'
export AMBIENT_OPS_ANDROID_KEY_ALIAS='ambient-ops'
export AMBIENT_OPS_ANDROID_KEY_PASSWORD='...'
./gradlew :app:testReleaseUnitTest :app:assembleRelease
```

Keep those values in the local secret store or CI secret manager. Do not commit
the keystore, passwords, or a populated properties file. The signed APK is
written to `app/build/outputs/apk/release/app-release.apk`.

On the production Mac, the signing password can remain in Keychain under
`cn.gaofeng.ambient-ops.android-signing` and the keystore can remain at
`~/Library/Application Support/Ambient Ops/android-signing/ambient-ops-release.p12`.
The repository helper reads those local values without printing them:

```bash
./scripts/build-signed-release-macos.sh
```

Back up the keystore and its password together in the owner's encrypted secret
store. Losing either one makes future in-place Android updates impossible.

## Install a published release

Each tagged GitHub Release contains a CI-built APK signed by the same stable
owner key used by the macOS helper, plus a sibling SHA-256 file. Download both
files from the release, then verify and install:

```bash
shasum -a 256 -c Ambient-Ops-Kiosk-1.2.9.apk.sha256
adb install -r Ambient-Ops-Kiosk-1.2.9.apk
```

The GitHub Release APK and checksum are public downloads. A future release
remains upgrade-compatible only when it keeps the application ID and signing key
and increments `versionCode`. GitHub Actions stores the key and passwords as
encrypted repository secrets; the recovery copy remains in the owner's
encrypted local secret store.

The same release workflow generates `kiosk-update.json` and embeds that APK
into the matching versioned Docker image. The kiosk downloads updates only from
the Ambient Ops endpoint whose display page is currently healthy; GitHub is not
part of the device update path.

## Install and update

USB is needed only for installation and diagnostics, not for normal operation:

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
adb shell cmd package set-home-activity cn.gaofeng.ambientops.kiosk/.MainActivity
adb shell am start -n cn.gaofeng.ambientops.kiosk/.MainActivity
```

For an update, build with the same application ID and signing key, increment
`versionCode`, then install without clearing application data:

```bash
adb install -r app/build/outputs/apk/release/app-release.apk
adb shell dumpsys package cn.gaofeng.ambientops.kiosk | \
  sed -n '/versionCode=/p;/versionName=/p'
```

Android rejects an update signed with a different key. Do not uninstall first:
uninstalling removes the remembered Ambient Ops instance and endpoint.

The one-time move from a debug-signed installation to the production signing
key is the exception: record the current instance or rescue URL, uninstall the
debug package, install the signed release, set it as Home again, and reapply the
rescue configuration if discovery is not immediately available. Later signed
updates must use `adb install -r` with that same production key.

Store a manual rescue URL and preferred instance without rebuilding:

```bash
adb shell am start -n cn.gaofeng.ambientops.kiosk/.MainActivity \
  --es ambient_ops_url http://192.168.1.10:8787/display/overview \
  --es ambient_ops_instance_id home-ops
```

For a deployment-time Direct binding, pass the OPL Fleet Agent status endpoint and
source kind explicitly:

```bash
adb shell am start -n cn.gaofeng.ambientops.kiosk/.MainActivity \
  --es ambient_ops_url http://192.168.1.20:7419/api/v1/status \
  --es ambient_ops_instance_id opl-fleet-agent-studio \
  --es ambient_ops_source_kind fleetAgent
```

The manual URL is a rescue path. Normal operation should continue to use LAN
discovery so the display is independent of a development computer.

## Trusted unattended updates

Version `1.2.1` and later check `/api/v1/kiosk/update` ten seconds after a healthy page
load and every six hours after that. A check runs only while the device is
on external power and its active network is Wi-Fi. Before invoking the package manager,
the client verifies:

- the fixed `cn.gaofeng.ambientops.kiosk` package ID
- a strictly higher `versionCode` and matching `versionName`
- the manifest's exact APK SHA-256
- the established signing-certificate SHA-256
  `4e5f5732645986e5a861446028846fcfb571b9dd006d87da19aa60f152639206`

Unattended installation uses `su -c "pm install -r ..."`. It therefore requires
Magisk root and a one-time permanent root grant to the kiosk. A failed download,
signature mismatch, downgrade, missing root grant, or package-manager failure
leaves the installed version untouched and is retried at a later check.
`MY_PACKAGE_REPLACED` restarts the Home activity after a successful replacement.

Gateway mode also checks `/api/v1/ui/revision` every 15 seconds while the
dashboard activity is visible. The first successful response establishes a
baseline. Two consecutive observations of a different content revision trigger
one WebView reload; network errors and invalid responses preserve the current
page. Selecting a different Ambient Ops endpoint resets the baseline.

The remembered endpoint has priority while its first load is pending and is
retained when a page load fails. After that explicit failure, it remains a retry
candidate while Android NSD searches for the logical instance at a new address.
An explicitly configured rescue URL remains pinned to its logical instance and
cannot fail over to an unrelated development server. A Wi-Fi availability
callback retries the endpoint during boot and wake recovery, while a ten-second
page-load watchdog and five-second NSD resolve timeout prevent Android 9 from
leaving the kiosk permanently at "searching".

## Cold-boot acceptance

Run this acceptance after a signed install or update:

1. Confirm the intended Ambient Ops server advertises
   `_ambient-ops._tcp.local` or one `_opl-fleet-agent._tcp.local` source on the same LAN.
2. Set the kiosk as Home, open it once, and confirm the live display loads.
3. Remove any development tunnel and prove none remains:

   ```bash
   adb reverse --remove-all
   adb reverse --list
   ```

4. Disconnect USB and cold-reboot the HTC device.
5. Verify the kiosk becomes Home without interaction, discovers Ambient Ops over
   Wi-Fi, fills the display, and recovers immersive mode after screen off/on.
6. Stop the selected Ambient Ops instance. Verify the unavailable state appears
   and another advertised instance is accepted after the page failure.
7. Restore the primary instance and reboot once more. Verify the remembered
   healthy instance remains selected while competing advertisements are present.

Restore the HTC launcher when kiosk ownership is no longer wanted:

```bash
adb shell cmd package set-home-activity com.htc.launcher/.Launcher
adb shell am start -n com.htc.launcher/.Launcher
```

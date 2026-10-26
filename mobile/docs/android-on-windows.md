# Running the app on an Android phone from Windows

How to build the development app on a Windows PC and run it on a real Android phone connected by USB, against the
backend running on the same PC. Written from the first setup (26 October 2026, Windows 11, Xiaomi Redmi Note 11 with
Android 13). Every problem we hit is in [Troubleshooting](#troubleshooting) with its fix.

The short version, once everything is set up: [Every day](#every-day-two-powershell-windows).

## How the pieces connect

```
 Phone (USB)                                 PC
 ───────────                                 ──
 Kanyaw Connect app ── 127.0.0.1:8081 ──┐
                       127.0.0.1:8000 ──┼── adb reverse (over the USB cable) ──► bundler  :8081  (npx expo start)
                       127.0.0.1:8080 ──┘                                    ──► API      :8000  (Docker: app)
                                                                             ──► Reverb   :8080  (Docker: reverb)
```

`adb reverse` makes `127.0.0.1` on the phone mean "this PC" for those three ports. So the phone needs no Wi-Fi, and the
Windows Firewall is not involved.

## One-time setup

Do these once per PC, in this order.

### 1. A short folder outside OneDrive

Android builds fail in folders with non-English letters, in long paths, and in OneDrive (it locks files while syncing).
Use a separate copy of the repository just for the phone app:

```powershell
mkdir C:\dev
cd C:\dev
git clone https://github.com/EhDohWah/kanyaw-connect.git
cd kanyaw-connect
git checkout claude/kind-thompson-htrbn1
```

The backend can keep running from wherever it already is.

### 2. Long paths on (PowerShell as Administrator)

Start → type "PowerShell" → right-click → **Run as administrator**:

```powershell
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
git config --global core.longpaths true
Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled
```

The last line must say `LongPathsEnabled : 1`. In a window without administrator rights the first line fails and the
value stays `0`.

### 3. A bigger page file

The build runs several large Java and C++ processes. With Docker and Android Studio open, Windows ran out of
"commit" memory (RAM plus page file) even with 32 GB of RAM.

Start → "Advanced system settings" → **Performance: Settings… → Advanced → Virtual memory: Change…** → untick
"Automatically manage…" → select **C:** → **Custom size**: initial `16384`, maximum `32768` → **Set → OK**.

### 4. Limit Docker's memory

Docker runs in WSL2, which may take half the RAM. The backend needs far less:

```powershell
Set-Content "$env:USERPROFILE\.wslconfig" -Value @("[wsl2]", "memory=8GB")
wsl --shutdown
```

Then start Docker Desktop again.

### 5. Restart the PC

The long-path setting and the page file both need it.

### 6. Android Studio and the SDK tools

Install Android Studio (choose **Standard** in the setup wizard). On its welcome screen, do **not** create or open a
project. Use **More Actions → SDK Manager → SDK Tools** and tick:

- Android SDK Build-Tools (until it shows ✓)
- Android SDK Command-line Tools (latest)
- Android SDK Platform-Tools
- Android Emulator

Leave NDK and CMake unticked: the first build downloads the exact versions it needs. Click **Apply**.

### 7. Environment variables

In PowerShell (no administrator needed):

```powershell
[Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
[Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Android\Android Studio\jbr", "User")
$p = [Environment]::GetEnvironmentVariable("Path", "User")
[Environment]::SetEnvironmentVariable("Path", "$p;$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:LOCALAPPDATA\Android\Sdk\emulator", "User")
```

`JAVA_HOME` points the build at Android Studio's own Java (version 21). Another Java on the PC (we had Oracle Java 25)
is then not used for the build.

**Close every terminal and open a new one**, then check:

```powershell
adb version
echo $env:ANDROID_HOME
echo $env:JAVA_HOME
```

### 8. Gradle: less at once

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.gradle" | Out-Null
Set-Content -Path "$env:USERPROFILE\.gradle\gradle.properties" -Value @(
  "org.gradle.jvmargs=-Xmx2g -XX:MaxMetaspaceSize=768m",
  "org.gradle.workers.max=2",
  "org.gradle.parallel=false",
  "kotlin.daemon.jvmargs=-Xmx1g"
)
```

This file is in your user folder, so `expo prebuild` never overwrites it.

### 9. A newer ninja (the C++ build tool)

The ninja that comes with the SDK's CMake 3.22.1 is version 1.10.2, which stops at 260-character paths even with long
paths on. Version 1.12 and later do not.

```powershell
$bin = "$env:LOCALAPPDATA\Android\Sdk\cmake\3.22.1\bin"
Rename-Item "$bin\ninja.exe" "ninja-old.exe"
Invoke-WebRequest "https://github.com/ninja-build/ninja/releases/download/v1.12.1/ninja-win.zip" -OutFile "$env:TEMP\ninja-win.zip"
Expand-Archive "$env:TEMP\ninja-win.zip" -DestinationPath $bin -Force
& "$bin\ninja.exe" --version
```

The `cmake\3.22.1` folder only exists after the first build has tried to run. If it is missing, run the build once (it
fails at the C++ step), then come back to this step.

### 10. The phone

1. **Settings → About phone** → tap **Build number** 7 times (on Xiaomi: **MIUI version** or **OS version**).
2. **Settings → Additional settings → Developer options**:
   - **USB debugging**: on
   - **Install via USB**: on (Xiaomi only; may ask you to sign in to a Mi account, with a SIM card and mobile data on)
   - **USB debugging (Security settings)**: on (Xiaomi only)
3. Connect the USB cable and allow USB debugging on the phone.
4. `adb devices` lists the phone as `device`.

### 11. Install and build the app

```powershell
cd C:\dev\kanyaw-connect\mobile
npm ci
copy .env.example .env
```

Put these values in `mobile\.env`:

```
EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:8000/api/v1
EXPO_PUBLIC_REVERB_APP_KEY=local-dev-key
EXPO_PUBLIC_REVERB_HOST=127.0.0.1
EXPO_PUBLIC_REVERB_PORT=8080
EXPO_PUBLIC_REVERB_SCHEME=http
EXPO_PUBLIC_FEED_SOURCE=mock
```

Then build and install once (10 to 20 minutes the first time; keep the phone unlocked and tap **Install** if it asks):

```powershell
npx expo run:android
```

Rebuild only after a native package, a config plugin or `app.config.ts` changes. JavaScript changes reload by
themselves.

## Every day: two PowerShell windows

The backend must be running (`docker compose up -d` in the backend folder).

**Window 1: the bundler.** Leave it open, and type nothing else in it. If it stops, the app shows "Failed to connect".

```powershell
cd C:\dev\kanyaw-connect\mobile
$env:REACT_NATIVE_PACKAGER_HOSTNAME = "127.0.0.1"
npx expo start --dev-client --clear
```

Wait for the QR code and the line `› Press a │ open Android`. (`--clear` is only needed after changing `.env`.)

**Window 2: everything else.**

```powershell
cd C:\dev\kanyaw-connect\mobile
Get-NetTCPConnection -LocalPort 8081 -State Listen | Select-Object LocalAddress
adb reverse tcp:8081 tcp:8081
adb reverse tcp:8000 tcp:8000
adb reverse tcp:8080 tcp:8080
```

The first command should list `0.0.0.0` and/or `::`. If it lists only `::1`, see
[the troubleshooting entry](#the-bundler-listens-only-on-1). Run the `adb reverse` lines again after unplugging the
phone or restarting the PC; `adb reverse --list` shows the active ones.

**Check, then open the app:**

1. PC browser: `http://127.0.0.1:8081/status` says `packager-status:running`.
2. Chrome on the phone: `http://127.0.0.1:8081/status` says the same.
3. Kanyaw Connect: type `http://127.0.0.1:8081` in the `http://` box and tap **Connect** (or press `a` in window 1).
   Window 1 shows "Bundling…", then the sign-in screen appears. Do **not** use "Scan QR Code".

## Troubleshooting

### `npm install` warnings

`deprecated …`, "6 high severity vulnerabilities" and "install scripts blocked" are harmless here. The vulnerabilities
are in Expo's command-line tool on the PC, not in the app. **Do not run `npm audit fix --force`**: it changes Expo's
pinned versions and breaks the project.

### `Cannot find module …\debug\src\index.js`

An incomplete install. Delete `node_modules` and reinstall with `npm ci`. If files vanish again, add `C:\dev` to the
Windows Defender exclusions.

### `Remove-Item` cannot delete `node_modules`

Some iOS files inside `expo-image` have paths over 260 characters. Delete with a Node tool instead:
`npx rimraf node_modules`.

### `Failed to resolve the Android SDK path` / `'adb' is not recognized`

Android Studio does not put its tools on the PATH. Do [step 7](#7-environment-variables) and open a new terminal.

### The emulator closes as soon as it starts

Usually hardware virtualization. Run `& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -accel-check` and check
Task Manager → Performance → CPU → "Virtualization". If it is disabled, enable Intel VT-x / AMD-V in the BIOS. Also turn
on the Windows features "Windows Hypervisor Platform" and "Virtual Machine Platform". Otherwise set the emulator's
graphics to Software. A real phone over USB avoids all of this, and the 8A device check needs one anyway.

### `Gradle build daemon disappeared unexpectedly`

Out of memory. The crash report (`android\hs_err_pid*.log`) says "There is insufficient memory for the Java Runtime
Environment" and shows `AvailPageFile` close to zero. Do steps [3](#3-a-bigger-page-file), [4](#4-limit-dockers-memory)
and [8](#8-gradle-less-at-once). Close Android Studio and the emulator while building.

### `ninja: error: Stat(…): Filename longer than 260 characters`

Both [step 2](#2-long-paths-on-powershell-as-administrator) (`LongPathsEnabled` must be `1`, then restart) and
[step 9](#9-a-newer-ninja-the-c-build-tool) (ninja 1.12 or later) are needed. Then delete the old C++ output with
`npx rimraf android\app\.cxx android\app\build` and build again. A shorter project folder alone is not enough: the
failing path contains the project folder twice and is about 330 characters long.

### `INSTALL_FAILED_USER_RESTRICTED: Install canceled by user`

Xiaomi blocks installs over USB. Turn on **Install via USB** and **USB debugging (Security settings)** ([step 10](#10-the-phone)).
Then install the APK you already built, without building again:

```powershell
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

Tap **Install** on the phone if it asks.

### `Failed to connect to /172.22.4.1:8081`

`172.x` is a virtual network adapter of WSL/Docker that the phone cannot reach; Expo picked it by itself. Start the
bundler with `REACT_NATIVE_PACKAGER_HOSTNAME = "127.0.0.1"` and type `http://127.0.0.1:8081` in the app instead of
scanning the QR code.

### `Failed to connect to /127.0.0.1:8081`

Nothing is listening on port 8081: the bundler is not running. It stops when you press Ctrl+C or close its window.
Check with `Get-NetTCPConnection -LocalPort 8081 -State Listen`: "No matching … objects found" means it is not running.
Start it again in its own window (window 1 above).

### `Port 8081 is being used by another process`

An old bundler is still running in another window. Answer **n** (the cable forwards 8081, not 8082), close the old
window, or stop it:

```powershell
Get-NetTCPConnection -LocalPort 8081 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

### The bundler listens only on `::1`

That happens with `npx expo start --localhost`. Node then listens only on the IPv6 address `::1`, but `adb reverse`
forwards to the IPv4 address `127.0.0.1`. The PC browser still works, but the phone gets "This page isn't working".
Start the bundler without `--localhost`, and with `REACT_NATIVE_PACKAGER_HOSTNAME = "127.0.0.1"`.

### `adb reverse` is set but the phone still cannot reach the PC

Restart adb, then set the forwards again:

```powershell
adb kill-server
adb devices
adb reverse tcp:8081 tcp:8081
adb reverse tcp:8000 tcp:8000
adb reverse tcp:8080 tcp:8080
```

### Using Wi-Fi instead of the cable

Put the phone and the PC on the same Wi-Fi, and set the network to **Private** in Windows. Find the PC's address with
`ipconfig` (under "Wireless LAN adapter Wi-Fi", not the `172.x` "vEthernet" entries). Put it in `.env`
(`EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_REVERB_HOST`), and start the bundler with
`$env:REACT_NATIVE_PACKAGER_HOSTNAME = "<that address>"`. Allow Node.js through the Windows Firewall on private
networks when Windows asks.

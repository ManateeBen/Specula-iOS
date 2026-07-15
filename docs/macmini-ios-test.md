# Mac mini iOS Test Flow

This project can be built and smoke-tested on the Mac mini over SSH.

## Host

```text
User: ben
Host: 192.168.10.118
Project: /Users/ben/Desktop/Specula-iOS
```

The Mac mini has Node installed under Homebrew, so non-interactive SSH commands
must set `PATH` explicitly. CocoaPods also needs UTF-8 locale variables.

## Smoke Test

Run from Windows/Codex:

```bash
ssh ben@192.168.10.118 'export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH; export LANG=en_US.UTF-8; export LC_ALL=en_US.UTF-8; cd /Users/ben/Desktop/Specula-iOS && git pull origin main && npm install && npm run build && npx cap sync ios'
```

This verifies:

- dependencies install
- Vite production build succeeds
- web assets copy into the iOS project
- CocoaPods native dependency sync succeeds

## Run In Simulator

List simulators:

```bash
ssh ben@192.168.10.118 'xcrun simctl list devices available'
```

Build, install, and launch on a chosen simulator UDID:

```bash
ssh ben@192.168.10.118 'export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH; export LANG=en_US.UTF-8; export LC_ALL=en_US.UTF-8; cd /Users/ben/Desktop/Specula-IOS 2>/dev/null || cd /Users/ben/Desktop/Specula-iOS; npx cap run ios --target SIMULATOR_UDID'
```

Launch the app explicitly if needed:

```bash
ssh ben@192.168.10.118 'xcrun simctl launch SIMULATOR_UDID com.specula.reader'
```

## XCUITest

Run the automated iOS UI test suite on the verified simulator:

```bash
ssh ben@192.168.10.118 'export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH; export LANG=en_US.UTF-8; export LC_ALL=en_US.UTF-8; cd /Users/ben/Desktop/Specula-iOS && npm run build && npx cap sync ios && cd ios/App && rm -rf /tmp/SpeculaUITests.xcresult && xcodebuild test -workspace App.xcworkspace -scheme App -destination "id=E70A3985-20E6-49AC-B0C1-ED319834FB89" -resultBundlePath /tmp/SpeculaUITests.xcresult'
```

Export screenshots from the last UI test run:

```bash
ssh ben@192.168.10.118 'rm -rf /tmp/SpeculaUITestAttachments && xcrun xcresulttool export attachments --path /tmp/SpeculaUITests.xcresult --output-path /tmp/SpeculaUITestAttachments'
scp ben@192.168.10.118:/tmp/SpeculaUITestAttachments/*.png D:\Work\DevProject\Specula-ios\xcuitest-artifacts\
scp ben@192.168.10.118:/tmp/SpeculaUITestAttachments/manifest.json D:\Work\DevProject\Specula-ios\xcuitest-artifacts\manifest.json
```

The current XCUITest covers:

- library screen render
- bundled `Specula Getting Started` book tap
- reader screen render
- EPUB swipe left to the next chapter
- EPUB swipe right back to the previous chapter
- reader back navigation
- settings tab navigation

## Screenshot

Capture a screenshot on the Mac mini:

```bash
ssh ben@192.168.10.118 'mkdir -p ~/Desktop/specula-test-shots; xcrun simctl io SIMULATOR_UDID screenshot ~/Desktop/specula-test-shots/home.png'
```

Copy it back to this workspace:

```bash
scp ben@192.168.10.118:/Users/ben/Desktop/specula-test-shots/home.png D:\Work\DevProject\Specula-ios\home.png
```

## Notes

- `npm install` may report audit warnings; they do not block the smoke test.
- If `npx cap sync ios` fails with a CocoaPods ASCII-8BIT / UTF-8 error, make
  sure `LANG=en_US.UTF-8` and `LC_ALL=en_US.UTF-8` are exported.
- If SSH cannot find `node`, make sure `/opt/homebrew/bin` is at the front of
  `PATH`.
- Current verified simulator: `iPhone 17`, UDID
  `E70A3985-20E6-49AC-B0C1-ED319834FB89`.
- Current verified result: app launches in the simulator and the bundled
  `Specula Getting Started` EPUB appears on the library page.
- Current verified XCUITest result: `xcodebuild test` succeeded on
  `2026-07-13` using the `iPhone 17` simulator.

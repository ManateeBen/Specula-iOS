# iOS Functional Test Checklist

Use this checklist after changes that affect reading, library import, AI actions,
settings, or iOS layout.

## Test Levels

### 1. Build Smoke

Run on the Mac mini:

```bash
ssh ben@192.168.10.118 'export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH; export LANG=en_US.UTF-8; export LC_ALL=en_US.UTF-8; cd /Users/ben/Desktop/Specula-iOS && git pull origin main && npm install && npm run build && npx cap sync ios'
```

Expected:

- `npm run build` succeeds.
- `npx cap sync ios` succeeds.
- CocoaPods does not fail with an encoding error.

### 2. Simulator Launch

Use the verified simulator unless another device is needed:

```text
iPhone 17
E70A3985-20E6-49AC-B0C1-ED319834FB89
```

Run:

```bash
ssh ben@192.168.10.118 'export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH; export LANG=en_US.UTF-8; export LC_ALL=en_US.UTF-8; cd /Users/ben/Desktop/Specula-iOS && npx cap run ios --target E70A3985-20E6-49AC-B0C1-ED319834FB89'
```

Expected:

- Xcode build succeeds.
- App deploys to the simulator.
- App launches without a blank screen.

### 3. Screenshot Capture

Capture screenshots on the Mac mini:

```bash
ssh ben@192.168.10.118 'mkdir -p ~/Desktop/specula-test-shots; xcrun simctl io E70A3985-20E6-49AC-B0C1-ED319834FB89 screenshot ~/Desktop/specula-test-shots/home.png'
```

Copy screenshots back:

```bash
scp ben@192.168.10.118:/Users/ben/Desktop/specula-test-shots/home.png D:\Work\DevProject\Specula-ios\home.png
```

Expected home screenshot:

- Header and bottom navigation are visible.
- No content is hidden under the status bar or home indicator.
- Bundled `Specula Getting Started` EPUB appears.
- Import button is visible and tappable-sized.

### 4. Automated XCUITest

Run the automated click-path test on the Mac mini:

```bash
ssh ben@192.168.10.118 'export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH; export LANG=en_US.UTF-8; export LC_ALL=en_US.UTF-8; cd /Users/ben/Desktop/Specula-iOS && npm run build && npx cap sync ios && cd ios/App && rm -rf /tmp/SpeculaUITests.xcresult && xcodebuild test -workspace App.xcworkspace -scheme App -destination "id=E70A3985-20E6-49AC-B0C1-ED319834FB89" -resultBundlePath /tmp/SpeculaUITests.xcresult'
```

Export test screenshots:

```bash
ssh ben@192.168.10.118 'rm -rf /tmp/SpeculaUITestAttachments && xcrun xcresulttool export attachments --path /tmp/SpeculaUITests.xcresult --output-path /tmp/SpeculaUITestAttachments'
scp ben@192.168.10.118:/tmp/SpeculaUITestAttachments/*.png D:\Work\DevProject\Specula-ios\xcuitest-artifacts\
```

Expected:

- `xcodebuild test` ends with `** TEST SUCCEEDED **`.
- The test opens the bundled book from the library.
- The reader page renders `Welcome to Specula`.
- A left swipe changes the EPUB reader to `How AI Reading Helps`.
- A right swipe changes the EPUB reader back to `Welcome to Specula`.
- Back navigation returns to the library.
- Settings navigation renders the settings page.

## Manual Simulator Paths

These paths currently need manual interaction in Simulator, followed by
screenshot capture.

### Library

Steps:

1. Launch app.
2. Confirm bundled sample EPUB appears.
3. Tap `Specula Getting Started`.

Expected:

- Reader opens.
- Top navigation is visible.
- Chapter content appears.
- No large blank area or clipping.

Recommended screenshot names:

```text
home.png
epub-reader.png
```

### EPUB Reader

Steps:

1. Open `Specula Getting Started`.
2. Change chapter from the table of contents if available.
3. Select a text fragment.

Expected:

- Text renders with readable spacing.
- Selection popover appears.
- AI explain action is visible.

Recommended screenshot names:

```text
epub-reader.png
epub-selection.png
```

### Settings

Steps:

1. Open Settings tab.
2. Check model settings.

Expected:

- Settings page renders.
- Built-in TestFlight keys are not shown in plain text.
- Connection test buttons are visible.

Recommended screenshot names:

```text
settings.png
```

### AI Explain

Requires `.env.local` with valid keys in the Mac mini project before build.

Steps:

1. Select EPUB text.
2. Tap AI explain.
3. Wait for streaming response.

Expected:

- Response starts within a reasonable time.
- Error state is clear if the model fails.
- Full API key is never shown in UI.

Recommended screenshot names:

```text
ai-explain-loading.png
ai-explain-result.png
```

### PDF Reader

Steps:

1. Import or open a PDF.
2. Change pages.
3. Use zoom controls.
4. Tap image explanation where supported.

Expected:

- Page content is visible.
- Previous/next page works.
- Zoom changes page size without clipping controls.
- AI image explanation works for renderable pages, or shows a clear unsupported state.

Recommended screenshot names:

```text
pdf-reader.png
pdf-zoom.png
pdf-ai-image.png
```

## Result Review

For each screenshot, mark:

```text
PASS: feature works and layout is acceptable.
WARN: feature works but layout/content should be improved.
FAIL: feature is blocked, blank, clipped, or throws a visible error.
```

Record the command output and screenshots together when reporting a test run.

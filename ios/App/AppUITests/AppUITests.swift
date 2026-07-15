import XCTest

final class AppUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments += ["--uitesting"]
        app.launch()
    }

    func testLibraryReaderAndSettingsNavigation() throws {
        waitForAny("Specula", timeout: 20)
        waitForAny("Specula Getting Started", timeout: 20)
        attachScreenshot(named: "01-home")

        tapSampleBookCard()
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        attachScreenshot(named: "02-after-book-tap")
        waitForAny("Specula Getting Started", timeout: 20)
        normalizeReaderToFirstChapter()
        waitForAny("Welcome to Specula", timeout: 20)
        attachScreenshot(named: "03-reader")

        runQuickBrowseGapLoop()

        swipeReaderLeft()
        waitForAny("How AI Reading Helps", timeout: 10)
        attachScreenshot(named: "08-swipe-next-chapter")

        swipeReaderRight()
        waitForAny("Welcome to Specula", timeout: 10)
        attachScreenshot(named: "09-swipe-prev-chapter")

        tapBackFromReader()
        waitForAny("library-page", timeout: 10)
        waitForAny("Specula Getting Started", timeout: 10)

        tapAny(["settings-tab", "设置"])
        waitForAny(["settings-page", "设置"], timeout: 10)
        attachScreenshot(named: "10-settings")
    }

    private func runQuickBrowseGapLoop() {
        tapAny(["快速浏览本章"])
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        attachScreenshot(named: "04-after-quick-browse-tap")
        waitForAny(["quick-browse-page", "快速浏览本章"], timeout: 20)
        let reset = app.buttons["重新浏览"].firstMatch
        if reset.exists && reset.isHittable {
            reset.tap()
            RunLoop.current.run(until: Date().addingTimeInterval(0.8))
        }
        waitForAny("答不上来", timeout: 90)
        attachScreenshot(named: "04-quick-browse-card")

        tapAny(["答不上来"])
        RunLoop.current.run(until: Date().addingTimeInterval(0.8))

        for _ in 0..<4 {
            let confident = app.buttons["我能答上来"].firstMatch
            guard confident.waitForExistence(timeout: 2) else { break }
            confident.tap()
            RunLoop.current.run(until: Date().addingTimeInterval(0.8))
        }

        waitForAny("发现 1 个认知缺口", timeout: 15)
        attachScreenshot(named: "05-quick-browse-summary")
        tapAny(["quick-browse-gap-1"])
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        attachScreenshot(named: "06-after-gap-tap")
        waitForAny(["认知缺口问题钉", "你带着一个问题来"], timeout: 15)
        attachScreenshot(named: "06-gap-anchor")
        tapAny(["我搞懂了，修复缺口"])
        waitForAny(["quick-browse-page", "快速浏览本章"], timeout: 15)
        attachScreenshot(named: "07-gap-repaired")
        tapAny(["quick-browse-back"])
        waitForAny("Welcome to Specula", timeout: 15)
    }

    private func waitForAny(_ identifier: String, timeout: TimeInterval) {
        waitForAny([identifier], timeout: timeout)
    }

    private func waitForAny(_ identifiers: [String], timeout: TimeInterval) {
        _ = findAny(identifiers, timeout: timeout)
    }

    private func tapAny(_ identifiers: [String]) {
        let element = findAny(identifiers, timeout: 10)
        element.tap()
    }

    private func findAny(_ identifiers: [String], timeout: TimeInterval) -> XCUIElement {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            for identifier in identifiers {
                let element = app.descendants(matching: .any)
                    .matching(identifier: identifier)
                    .firstMatch
                if element.exists && element.isHittable {
                    return element
                }
                if element.exists {
                    return element
                }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        XCTFail("Missing UI element: \(identifiers.joined(separator: ", "))")
        return app.descendants(matching: .any)[identifiers[0]]
    }

    private func existsAny(_ identifiers: [String]) -> Bool {
        identifiers.contains { identifier in
            app.descendants(matching: .any)
                .matching(identifier: identifier)
                .firstMatch
                .exists
        }
    }

    private func normalizeReaderToFirstChapter() {
        if existsAny(["Welcome to Specula"]) {
            return
        }
        if existsAny(["How AI Reading Helps", "A Short Practice Chapter"]) {
            swipeReaderRight()
        }
    }

    private func swipeReaderLeft() {
        drag(from: CGVector(dx: 0.82, dy: 0.52), to: CGVector(dx: 0.18, dy: 0.52))
    }

    private func swipeReaderRight() {
        drag(from: CGVector(dx: 0.18, dy: 0.52), to: CGVector(dx: 0.82, dy: 0.52))
    }

    private func drag(from start: CGVector, to end: CGVector) {
        let startPoint = app.coordinate(withNormalizedOffset: start)
        let endPoint = app.coordinate(withNormalizedOffset: end)
        startPoint.press(forDuration: 0.05, thenDragTo: endPoint)
        RunLoop.current.run(until: Date().addingTimeInterval(0.8))
    }

    private func tapBackFromReader() {
        let back = app.descendants(matching: .any)["reader-back"]
        if back.waitForExistence(timeout: 3) {
            back.tap()
            return
        }

        // WebKit may expose icon-only links inconsistently. Fall back to the
        // top-left reader back button area on phone-sized simulators.
        let fallbackPoints = [
            CGVector(dx: 0.15, dy: 0.105),
            CGVector(dx: 0.16, dy: 0.12),
            CGVector(dx: 0.13, dy: 0.12),
        ]

        for point in fallbackPoints {
            app.coordinate(withNormalizedOffset: point).tap()
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
            if app.descendants(matching: .any)["library-page"].exists {
                return
            }
        }
    }

    private func tapSampleBookCard() {
        // The starter EPUB card is seeded by the app and appears in a stable
        // first-grid position on phone-sized simulators. Tapping the card body
        // exercises the same path a user takes, while avoiding WebKit's nested
        // accessibility nodes for links inside the card.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.27, dy: 0.62)).tap()
    }

    private func attachScreenshot(named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

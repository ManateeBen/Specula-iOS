import XCTest

final class AppUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments += ["--uitesting"]
        addUIInterruptionMonitor(withDescription: "Notification permission") { alert in
            for label in ["Allow", "允许", "允许通知"] {
                let button = alert.buttons[label]
                if button.exists {
                    button.tap()
                    return true
                }
            }
            return false
        }
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

        runAIExplanationFlow()

        swipeReaderUp()
        attachScreenshot(named: "03-reader-progress")
        swipeReaderDown()

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
        waitForAny(["讲解语气", "严谨", "轻松"], timeout: 10)
        XCTAssertFalse(app.staticTexts["默认讲解偏好"].exists)
        tapAny(["轻松"])
        attachScreenshot(named: "10-settings")
    }

    func testQuickBrowseRecordDesign() throws {
        waitForAny("Specula", timeout: 20)
        waitForAny("Specula Getting Started", timeout: 20)
        tapSampleBookCard()
        waitForAny("Specula Getting Started", timeout: 20)
        normalizeReaderToFirstChapter()
        waitForAny("Welcome to Specula", timeout: 20)
        runQuickBrowseGapLoop()
    }

    func testEpubChapterSwipeNavigation() throws {
        waitForAny("Specula", timeout: 20)
        waitForAny("Specula Getting Started", timeout: 20)
        tapSampleBookCard()
        waitForAny("Specula Getting Started", timeout: 20)
        normalizeReaderToFirstChapter()
        waitForAny("Welcome to Specula", timeout: 20)

        swipeReaderLeft()
        waitForAny("How AI Reading Helps", timeout: 10)
        attachScreenshot(named: "epub-swipe-next")

        swipeReaderRight()
        waitForAny("Welcome to Specula", timeout: 10)
        attachScreenshot(named: "epub-swipe-previous")
    }

    func testRecordStyleTableOfContents() throws {
        waitForAny("Specula", timeout: 20)
        waitForAny("Specula Getting Started", timeout: 20)
        tapSampleBookCard()
        waitForAny("Specula Getting Started", timeout: 20)
        normalizeReaderToFirstChapter()
        waitForAny("Welcome to Specula", timeout: 20)

        tapAny(["reader-toggle-toc", "目录"])
        waitForAny(["record-toc", "TRACK LIST"], timeout: 10)
        attachScreenshot(named: "record-style-toc")
        tapAny(["toc-track-2"])
        waitForAny("How AI Reading Helps", timeout: 10)
    }

    private func runAIExplanationFlow() {
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.28, dy: 0.40))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.72, dy: 0.40))
        start.press(forDuration: 0.65, thenDragTo: end)
        RunLoop.current.run(until: Date().addingTimeInterval(0.8))

        tapAny(["AI 解释"])
        waitForAny(["AI 解释面板", "完全没懂"], timeout: 12)
        waitForAny("ai-explain-choose-need", timeout: 10)
        attachScreenshot(named: "03-ai-explanation")

        tapAny(["完全没懂"])
        waitForAny(["CHECK · 一道是非题", "CHECK"], timeout: 60)
        attachScreenshot(named: "03-ai-loaded")
        tapAny(["错"])

        tapAny(["再讲透一点"])
        waitForAny(["GO DEEPER"], timeout: 60)
        tapAny(["已经透了"])

        tapAny(["帮我记住"])
        waitForAny(["FLASHCARD"], timeout: 60)
        tapAfterScrolling("save-flashcard")
        waitForAny(["flashcard-saved"], timeout: 10)

        tapAny(["为什么这样设计"])
        waitForAny(["PATTERN"], timeout: 60)
        tapAfterScrolling("save-exploration")
        waitForAny(["exploration-saved"], timeout: 10)

        tapAny(["怎么用起来"])
        waitForAny(["5-MIN ACTION"], timeout: 60)
        tapAfterScrolling("claim-learning-task")
        app.tap()
        waitForAny(["learning-task-claimed"], timeout: 15)
        attachScreenshot(named: "03-ai-tail-actions")
        tapAny(["关闭"])
        waitForAny("Welcome to Specula", timeout: 10)
    }

    private func runQuickBrowseGapLoop() {
        tapAny(["快速浏览本章"])
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        attachScreenshot(named: "04-after-quick-browse-tap")
        waitForAny(["preview-loading", "quick-browse-reset", "quick-browse-answer-gap-1"], timeout: 20)
        let reset = app.buttons["quick-browse-reset"].firstMatch
        if reset.exists && reset.isHittable {
            reset.tap()
            RunLoop.current.run(until: Date().addingTimeInterval(0.8))
        }
        waitForAny("quick-browse-answer-gap-1", timeout: 90)
        attachScreenshot(named: "04-quick-browse-card")

        tapAny(["quick-browse-answer-gap-1"])
        RunLoop.current.run(until: Date().addingTimeInterval(0.8))

        for index in 2...5 {
            let confident = app.buttons["quick-browse-answer-confident-\(index)"].firstMatch
            guard confident.waitForExistence(timeout: 2) else { break }
            confident.tap()
            RunLoop.current.run(until: Date().addingTimeInterval(0.8))
        }

        waitForAny("1 个待答问题", timeout: 15)
        attachScreenshot(named: "05-quick-browse-summary")
        tapAny(["quick-browse-gap-1"])
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        attachScreenshot(named: "06-after-gap-tap")
        waitForAny(["mark-question-answered", "我答上了"], timeout: 15)
        attachScreenshot(named: "06-gap-anchor")
        tapAny(["mark-question-answered"])
        waitForAny(["quick-browse-summary", "ALL RECORDED"], timeout: 15)
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

    private func tapAfterScrolling(_ identifier: String) {
        let deadline = Date().addingTimeInterval(12)
        while Date() < deadline {
            let element = app.descendants(matching: .any)
                .matching(identifier: identifier)
                .firstMatch
            if element.exists && element.isHittable {
                element.tap()
                return
            }
            drag(from: CGVector(dx: 0.52, dy: 0.86), to: CGVector(dx: 0.52, dy: 0.58))
        }
        XCTFail("Missing hittable UI element: \(identifier)")
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

    private func swipeReaderUp() {
        drag(from: CGVector(dx: 0.52, dy: 0.74), to: CGVector(dx: 0.52, dy: 0.38))
    }

    private func swipeReaderDown() {
        drag(from: CGVector(dx: 0.52, dy: 0.38), to: CGVector(dx: 0.52, dy: 0.74))
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

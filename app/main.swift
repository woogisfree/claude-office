// Claude Office 앱 셸: Node 서버 실행, WKWebView 창, 메뉴 막대, 알림, 설정(메뉴).
import Cocoa
import WebKit
import UserNotifications
import ServiceManagement

// 시스템 언어가 한국어이면 한국어 문구를, 그 밖에는 영어 문구를 쓴다.
let isKorean = (Locale.preferredLanguages.first ?? "en").hasPrefix("ko")
func L(_ ko: String, _ en: String) -> String { isKorean ? ko : en }

let log = (NSHomeDirectory() as NSString).appendingPathComponent("Library/Logs/Claude Office.log")
func writeLog(_ s: String) {
    let line = "\(Date()) \(s)\n"
    if let h = FileHandle(forWritingAtPath: log) { h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close() }
    else { try? line.write(toFile: log, atomically: true, encoding: .utf8) }
}

struct Session: Decodable {
    let sessionId: String
    let name: String
    let status: String
    let parentId: String?
    let kind: String?
    let workedMs: Double?
}
struct Window5: Decodable { let pct: Double; let resetsAt: Double }
struct Usage: Decodable { let ok: Bool; let fiveHour: Window5?; let weekly: Window5? }

// 웹 화면 위에 올리는 투명한 드래그 전용 뷰. WKWebView는 안쪽 뷰가 마우스 이벤트를 먼저 받아 서브클래스로는 잡히지 않는다.
final class DragStrip: NSView {
    override var mouseDownCanMoveWindow: Bool { true }
    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2 { window?.performZoom(nil) } else { window?.performDrag(with: event) }
    }
}

// claude.ai에 로그인된 쿠키(WKWebsiteDataStore.default)로 사용량을 가져온다. 비밀번호는 앱이 다루지 않고, 로그인은 사용자가 claude.ai 화면에서 직접 한다.
// 사용량 API는 공개 규격이 아니라서 응답 원문(JSON)을 그대로 화면으로 넘기고, 해석은 화면(panel.js)이 느슨하게 한다.
final class UsageFetcher: NSObject, WKNavigationDelegate {
    let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 10, height: 10), configuration: WKWebViewConfiguration())
    private var ready = false, loading = false
    private var pending: [(Result<String, Error>) -> Void] = []
    override init() { super.init(); web.navigationDelegate = self }

    func fetch(_ done: @escaping (Result<String, Error>) -> Void) {
        if ready { run(done); return }
        pending.append(done)
        if !loading { loading = true; web.load(URLRequest(url: URL(string: "https://claude.ai/favicon.ico")!)) }
    }
    func webView(_ w: WKWebView, didFinish n: WKNavigation!) { ready = true; loading = false; let p = pending; pending = []; p.forEach { run($0) } }
    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { fail(e) }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { fail(e) }
    private func fail(_ e: Error) { loading = false; ready = false; let p = pending; pending = []; p.forEach { $0(.failure(e)) } }

    private func run(_ done: @escaping (Result<String, Error>) -> Void) {
        // 예외 대신 상태 코드가 담긴 JSON을 돌려준다. (예외로 던지면 Swift에서 일반 문구만 보여 원인을 알 수 없다.)
        let js = """
        const get = async (u) => { const r = await fetch(u, { credentials: 'include' }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, json: j }; };
        const why = (x) => (x.json && x.json.error && x.json.error.message) || '';
        try {
          const o = await get('/api/organizations');
          if (o.status !== 200) return JSON.stringify({ status: o.status, step: 'organizations', msg: why(o) });
          const org = (Array.isArray(o.json) ? o.json : []).find((x) => x && x.uuid);
          if (!org) return JSON.stringify({ status: 401, step: 'organizations', msg: 'no-org' });
          const u = await get('/api/organizations/' + org.uuid + '/usage');
          if (u.status !== 200) return JSON.stringify({ status: u.status, step: 'usage', msg: why(u) });
          return JSON.stringify({ status: 200, data: u.json });
        } catch (e) { return JSON.stringify({ status: 0, step: 'fetch', msg: String(e) }); }
        """
        func err(_ m: String) -> NSError { NSError(domain: "usage", code: 1, userInfo: [NSLocalizedDescriptionKey: m]) }
        web.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { r in
            switch r {
            case .success(let v):
                guard let s = v as? String, let d = s.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { done(.failure(err("empty response"))); return }
                let status = o["status"] as? Int ?? 0
                if status == 200, let data = o["data"], let out = try? JSONSerialization.data(withJSONObject: data), let text = String(data: out, encoding: .utf8) { done(.success(text)) }
                else { done(.failure(err("HTTP \(status) \(o["step"] as? String ?? "") \(o["msg"] as? String ?? "")"))) }
            case .failure(let e):
                let m = (e as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String ?? e.localizedDescription
                done(.failure(err("JS exception: \(m)")))
            }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, NSWindowDelegate, WKScriptMessageHandler {
    var statusItem: NSStatusItem!
    var window: NSWindow!
    var web: WKWebView!
    var server: Process?
    var baseURL: URL?
    var lastStatus: [String: String] = [:]
    var busySince: [String: Date] = [:]
    var timer: Timer?
    let fetcher = UsageFetcher()
    var usageState = "login"            // ok, login, error
    var lastUsageJSON: String?
    var appFive: Double?
    var loginWin: NSWindow?
    var loginTimer: Timer?
    var usageTimer: Timer?
    let d = UserDefaults.standard

    var theme: String { d.string(forKey: "theme") ?? "office" }
    var zoom: String { d.string(forKey: "zoom") ?? "normal" }
    // 창밖 날씨와 일출·일몰을 가져올 도시. 키는 server.mjs의 CITIES와 같아야 한다.
    var city: String { d.string(forKey: "city") ?? "seoul" }
    // 카페인 폭주 기준(분당 k 토큰)은 120으로 고정한다.
    let threshold = 120

    func applicationDidFinishLaunching(_ n: Notification) {
        NSApp.setActivationPolicy(.regular)
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        // 메뉴 막대 아이콘: 앱 아이콘과 같은 색의 픽셀 마스코트. 32px 이미지를 16pt로 보여 줘서 고해상도 화면에서 또렷하다.
        if let path = Bundle.main.path(forResource: "StatusIcon", ofType: "png"), let img = NSImage(contentsOfFile: path) {
            img.size = NSSize(width: 16, height: 16)
            statusItem.button?.image = img
            statusItem.button?.imagePosition = .imageLeft
        } else { statusItem.button?.title = "🏢" }
        buildMenu()
        buildWindow()
        startServer()
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows: Bool) -> Bool { showWindow(); return true }
    func applicationWillTerminate(_ n: Notification) { server?.terminate() }
    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let m = NSMenu(); m.addItem(withTitle: L("사무실 열기", "Open Office"), action: #selector(showWindow), keyEquivalent: ""); return m
    }

    // MARK: 메뉴
    func buildMenu() {
        let m = NSMenu()
        m.addItem(withTitle: L("사무실 열기", "Open Office"), action: #selector(showWindow), keyEquivalent: "o")
        m.addItem(.separator())
        let t = NSMenuItem(title: L("테마", "Theme"), action: nil, keyEquivalent: ""); let ts = NSMenu()
        for (k, v) in [("office", L("사무실", "Office")), ("mine", L("탄광", "Mine")), ("xmas", L("크리스마스", "Christmas"))] { let i = NSMenuItem(title: v, action: #selector(pickTheme(_:)), keyEquivalent: ""); i.representedObject = k; i.state = theme == k ? .on : .off; ts.addItem(i) }
        t.submenu = ts; m.addItem(t)
        let z = NSMenuItem(title: L("사무실 크기", "Office Size"), action: nil, keyEquivalent: ""); let zs = NSMenu()
        for (k, v) in [("small", L("작게", "Small")), ("normal", L("보통", "Medium")), ("large", L("크게", "Large"))] { let i = NSMenuItem(title: v, action: #selector(pickZoom(_:)), keyEquivalent: ""); i.representedObject = k; i.state = zoom == k ? .on : .off; zs.addItem(i) }
        z.submenu = zs; m.addItem(z)
        let c = NSMenuItem(title: L("날씨 위치", "Weather Location"), action: nil, keyEquivalent: ""); let cs = NSMenu()
        for (k, v) in [("seoul", L("서울", "Seoul")), ("tokyo", L("도쿄", "Tokyo")), ("newyork", L("뉴욕", "New York")), ("london", L("런던", "London")), ("sydney", L("시드니", "Sydney"))] { let i = NSMenuItem(title: v, action: #selector(pickCity(_:)), keyEquivalent: ""); i.representedObject = k; i.state = city == k ? .on : .off; cs.addItem(i) }
        c.submenu = cs; m.addItem(c)
        let login = NSMenuItem(title: L("로그인할 때 열기", "Open at Login"), action: #selector(toggleLogin(_:)), keyEquivalent: "")
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off; m.addItem(login)
        m.addItem(.separator())
        m.addItem(withTitle: L("종료", "Quit"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        statusItem.menu = m
        NSApp.mainMenu = { let mm = NSMenu(); let it = NSMenuItem(); mm.addItem(it); let sub = NSMenu(); sub.addItem(withTitle: L("종료", "Quit"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"); it.submenu = sub; return mm }()
    }
    @objc func pickTheme(_ s: NSMenuItem) { d.set(s.representedObject as? String, forKey: "theme"); buildMenu(); pushSettings() }
    @objc func pickCity(_ s: NSMenuItem) { d.set(s.representedObject as? String, forKey: "city"); buildMenu(); pushSettings() }
    @objc func pickZoom(_ s: NSMenuItem) { d.set(s.representedObject as? String, forKey: "zoom"); buildMenu(); pushSettings() }
    @objc func toggleLogin(_ s: NSMenuItem) {
        do { if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() } } catch { writeLog("login item: \(error)") }
        buildMenu()
    }

    // MARK: 창
    func buildWindow() {
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(self, name: "office")
        web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.titlebarAppearsTransparent = true; window.titleVisibility = .hidden
        // 컨테이너 안에 웹 화면을 채우고, 헤더 왼쪽(오른쪽 컨트롤 영역 제외)에 드래그 뷰를 올린다.
        let box = NSView(frame: NSRect(x: 0, y: 0, width: 1280, height: 860))
        web.frame = box.bounds; web.autoresizingMask = [.width, .height]; box.addSubview(web)
        let strip = DragStrip(frame: NSRect(x: 0, y: box.bounds.height - 44, width: box.bounds.width - 440, height: 44))
        strip.autoresizingMask = [.width, .minYMargin]; box.addSubview(strip, positioned: .above, relativeTo: web)
        window.contentView = box; window.center(); window.delegate = self
        window.isReleasedWhenClosed = false
        web.loadHTMLString(loadingHTML(), baseURL: nil)
        window.makeKeyAndOrderFront(nil)
    }
    func loadingHTML() -> String {
        let msg = ["office": L("사무실 문 여는 중", "Opening the office"), "mine": L("탄광으로 들어가는 중", "Heading into the mine"), "xmas": L("선물 작업실 문 여는 중", "Opening the workshop")][theme] ?? L("문 여는 중", "Opening")
        return "<body style='background:#1d1f27;color:#e8e9ee;font:15px -apple-system;display:flex;align-items:center;justify-content:center;height:100vh'>\(msg)…</body>"
    }
    @objc func showWindow() { NSApp.activate(ignoringOtherApps: true); window.makeKeyAndOrderFront(nil) }
    func pushSettings() {
        let js = "window.setTheme&&setTheme('\(theme)');window.setZoom&&setZoom('\(zoom)');window.setFireThreshold&&setFireThreshold(\(threshold));window.setCity&&setCity('\(city)');"
        web.evaluateJavaScript(js, completionHandler: nil)
    }
    func webView(_ w: WKWebView, didFinish n: WKNavigation!) { if baseURL != nil { pushSettings(); pushUsage() } }

    // MARK: claude.ai 사용량 (로그인, 가져오기, 화면으로 전달)
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let body = m.body as? String else { return }
        if body == "login" { openLogin() } else if body.hasPrefix("log:") { writeLog(String(body.dropFirst(4))) }
    }
    func refreshUsage(fromLogin: Bool = false) {
        fetcher.fetch { [weak self] r in
            DispatchQueue.main.async {
                guard let self else { return }
                switch r {
                case .success(let json):
                    // 응답 원문을 한 번 해석했다가 다시 직렬화해서, 화면에는 순수한 JSON만 넘긴다.
                    guard let data = json.data(using: .utf8), let obj = try? JSONSerialization.jsonObject(with: data),
                          let clean = try? JSONSerialization.data(withJSONObject: obj), let text = String(data: clean, encoding: .utf8) else { self.usageState = "error"; self.pushUsage(); return }
                    if let d = obj as? [String: Any], let f = d["five_hour"] as? [String: Any], let u = f["utilization"] as? Double { self.appFive = u }
                    self.lastUsageJSON = text
                    if self.usageState != "ok" { self.usageState = "ok"; self.buildMenu() }
                    self.pushUsage(); self.refreshTitle()
                    if fromLogin { self.loginWin?.close() }
                case .failure(let e):
                    let m = e.localizedDescription
                    writeLog("usage fetch failed: \(m)")
                    let needLogin = m.contains("401") || m.contains("403")
                    let next = needLogin ? "login" : "error"
                    if self.usageState != next { self.usageState = next; self.buildMenu() }
                    if needLogin { self.appFive = nil; self.lastUsageJSON = nil }
                    self.pushUsage(); self.refreshTitle()
                }
            }
        }
    }
    func pushUsage() {
        guard web != nil, baseURL != nil else { return }
        var js = ""
        if usageState == "ok", let j = lastUsageJSON { js += "window.setAppUsage&&setAppUsage(\(j));" }
        js += "window.setAppUsageState&&setAppUsageState('\(usageState)');"
        web.evaluateJavaScript(js, completionHandler: nil)
    }
    @objc func openLogin() {
        if let w = loginWin { NSApp.activate(ignoringOtherApps: true); w.makeKeyAndOrderFront(nil); return }
        let wv = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        wv.load(URLRequest(url: URL(string: "https://claude.ai/login")!))
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 720), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        w.title = L("claude.ai 로그인", "claude.ai Login"); w.contentView = wv; w.center(); w.isReleasedWhenClosed = false; w.delegate = self
        loginWin = w
        NSApp.activate(ignoringOtherApps: true); w.makeKeyAndOrderFront(nil)
        // 로그인이 끝나면 사용량 요청이 성공하므로, 창이 열려 있는 동안 3초마다 시도하고 성공하면 창을 닫는다.
        loginTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in self?.refreshUsage(fromLogin: true) }
    }
    @objc func logoutClaude() {
        let store = WKWebsiteDataStore.default(), types = WKWebsiteDataStore.allWebsiteDataTypes()
        store.fetchDataRecords(ofTypes: types) { recs in
            let mine = recs.filter { $0.displayName.contains("claude.ai") || $0.displayName.contains("anthropic.com") }
            store.removeData(ofTypes: types, for: mine) {
                DispatchQueue.main.async { self.usageState = "login"; self.appFive = nil; self.lastUsageJSON = nil; self.buildMenu(); self.pushUsage(); self.refreshTitle() }
            }
        }
    }
    func windowWillClose(_ n: Notification) {
        if (n.object as? NSWindow) === loginWin { loginTimer?.invalidate(); loginTimer = nil; loginWin = nil }
    }

    // MARK: Node 서버
    func findNode() -> (String, String)? {
        let p = Process(); p.executableURL = URL(fileURLWithPath: "/bin/zsh")
        p.arguments = ["-lic", "command -v node; echo $PATH"]
        let out = Pipe(); p.standardOutput = out; p.standardError = Pipe()
        do { try p.run() } catch { return nil }
        p.waitUntilExit()
        let lines = (String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "").split(separator: "\n").map(String.init)
        guard lines.count >= 2, lines[lines.count - 2].hasPrefix("/") else { return nil }
        return (lines[lines.count - 2], lines[lines.count - 1])
    }
    func startServer() {
        guard let (node, path) = findNode() else {
            let a = NSAlert(); a.messageText = L("Node.js를 찾지 못했습니다", "Node.js not found"); a.informativeText = L("Node.js 18 이상을 설치한 뒤 앱을 다시 실행하세요.", "Install Node.js 18 or later and relaunch the app."); a.runModal(); statusItem.button?.title = "⚠️"; return
        }
        guard let res = Bundle.main.resourcePath else { return }
        let script = (res as NSString).appendingPathComponent("server/server.mjs")
        let p = Process(); p.executableURL = URL(fileURLWithPath: node); p.arguments = [script]
        var env = ProcessInfo.processInfo.environment; env["PORT"] = "0"; env["PATH"] = path; env["CLAUDE_OFFICE_THEME"] = theme; p.environment = env
        let out = Pipe(); p.standardOutput = out
        let err = Pipe(); p.standardError = err
        err.fileHandleForReading.readabilityHandler = { h in if let s = String(data: h.availableData, encoding: .utf8), !s.isEmpty { writeLog("server: \(s)") } }
        out.fileHandleForReading.readabilityHandler = { [weak self] h in
            guard let s = String(data: h.availableData, encoding: .utf8), !s.isEmpty else { return }
            writeLog("server: \(s)")
            if let r = s.range(of: #"http://localhost:\d+"#, options: .regularExpression), let url = URL(string: String(s[r])) {
                DispatchQueue.main.async { self?.serverReady(url) }
            }
        }
        p.terminationHandler = { [weak self] _ in DispatchQueue.main.async { self?.statusItem.button?.title = "⚠️"; writeLog("server exited") } }
        do { try p.run(); server = p } catch { writeLog("launch failed: \(error)"); statusItem.button?.title = "⚠️" }
    }
    func serverReady(_ url: URL) {
        guard baseURL == nil else { return }
        baseURL = url
        web.load(URLRequest(url: url))
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.tick() }
        refreshUsage()
        usageTimer = Timer.scheduledTimer(withTimeInterval: 45, repeats: true) { [weak self] _ in self?.refreshUsage() }
    }

    // MARK: 메뉴 막대와 알림
    func tick() {
        guard let base = baseURL else { return }
        URLSession.shared.dataTask(with: base.appendingPathComponent("api/sessions")) { [weak self] data, _, _ in
            guard let self, let data, let list = try? JSONDecoder().decode([Session].self, from: data) else { return }
            DispatchQueue.main.async { self.handle(list) }
        }.resume()
        URLSession.shared.dataTask(with: base.appendingPathComponent("api/usage")) { [weak self] data, _, _ in
            guard let self, let data, let u = try? JSONDecoder().decode(Usage.self, from: data) else { return }
            DispatchQueue.main.async { self.usage = u; self.refreshTitle() }
        }.resume()
    }
    var usage: Usage?
    var count = 0
    func refreshTitle() {
        var t = statusItem.button?.image == nil ? "🏢 \(count)" : " \(count)"
        if let f = appFive { t += " · \(max(0, 100 - Int(f.rounded())))% \(L("남음", "left"))" }
        else if let u = usage, u.ok, let f = u.fiveHour { t += " · \(max(0, 100 - Int(f.pct.rounded())))% \(L("남음", "left"))" }
        statusItem.button?.title = t
    }
    func handle(_ list: [Session]) {
        count = list.filter { $0.parentId == nil }.count; refreshTitle()
        for s in list {
            let prev = lastStatus[s.sessionId]
            if s.status == "busy", busySince[s.sessionId] == nil { busySince[s.sessionId] = Date() }
            if let prev, prev != s.status {
                if s.status == "waiting" { notify(L("승인 요청", "Approval needed"), L("\(s.name): 확인이 필요합니다.", "\(s.name): needs your attention.")) }
                else if s.status == "idle", prev == "busy" {
                    let secs = Int(Date().timeIntervalSince(busySince[s.sessionId] ?? Date()))
                    if s.parentId == nil || secs > 120 { notify(L("작업 완료", "Work finished"), L("\(s.name): \(secs / 60)분 \(secs % 60)초 동안 일했습니다.", "\(s.name): worked for \(secs / 60)m \(secs % 60)s.")) }
                }
            }
            if s.status != "busy" { busySince[s.sessionId] = nil }
            lastStatus[s.sessionId] = s.status
        }
        let ids = Set(list.map { $0.sessionId }); lastStatus = lastStatus.filter { ids.contains($0.key) }
    }
    func notify(_ title: String, _ body: String) {
        let c = UNMutableNotificationContent(); c.title = title; c.body = body; c.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()

//
//  WebShellView.swift
//  StrengthMaxxing iOS
//
//  Full-screen WKWebView on the live site. Cookies persist (dashboard sign-in survives
//  relaunches), pull to refresh, links that leave the site open in Safari, and an offline
//  page with Retry. The page talks to native code through `NativeBridge`.
//

import SwiftUI
import WebKit

struct WebShellView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()                       // persistent cookies
        config.applicationNameForUserAgent = "StrengthMaxxingApp/1" // lets the page detect the app
        config.allowsInlineMediaPlayback = true
        config.userContentController.addScriptMessageHandler(
            NativeBridge.shared, contentWorld: .page, name: "smx")

        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = true
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 10 / 255, green: 10 / 255, blue: 12 / 255, alpha: 1)
        web.scrollView.backgroundColor = web.backgroundColor
        web.scrollView.contentInsetAdjustmentBehavior = .never     // page pads itself for the notch

        let refresh = UIRefreshControl()
        refresh.tintColor = .lightGray
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.pulled(_:)), for: .valueChanged)
        web.scrollView.refreshControl = refresh

        context.coordinator.web = web
        context.coordinator.loadHome()
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        weak var web: WKWebView?

        var home: URL {
            URL(string: AppSettings.shared.baseURLString) ?? URL(string: AppSettings.defaultBaseURL)!
        }

        func loadHome() { web?.load(URLRequest(url: home)) }

        @objc func pulled(_ sender: UIRefreshControl) {
            if web?.url == nil || web?.url?.scheme == "about" { loadHome() } else { web?.reload() }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { sender.endRefreshing() }
        }

        // Keep navigation inside the site; anything else (sources, tel:, mailto:) goes to the OS.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { return decisionHandler(.allow) }
            let sameSite = url.host == home.host || url.scheme == "about"
            if sameSite { return decisionHandler(.allow) }
            if action.navigationType == .linkActivated || action.targetFrame == nil {
                UIApplication.shared.open(url)
                return decisionHandler(.cancel)
            }
            decisionHandler(.allow)
        }

        // target="_blank" links
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url { UIApplication.shared.open(url) }
            return nil
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
                     withError error: Error) {
            showOffline(error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code != NSURLErrorCancelled { showOffline(error) }
        }

        private func showOffline(_ error: Error) {
            guard (error as NSError).code != NSURLErrorCancelled else { return }
            let html = """
            <html><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>body{background:#0a0a0c;color:#e4e4e7;font:16px -apple-system,sans-serif;
            display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;padding:24px;text-align:center}
            a{margin-top:20px;background:#ff5c00;color:#0a0a0c;font-weight:700;padding:12px 28px;border-radius:12px;text-decoration:none}
            p{color:#71717a;font-size:14px}</style></head>
            <body><h2>Can't reach StrengthMaxxing</h2><p>Check your connection. Your watch keeps logging offline.</p>
            <a href="\(home.absoluteString)">Retry</a></body></html>
            """
            web?.loadHTMLString(html, baseURL: nil)
        }
    }
}

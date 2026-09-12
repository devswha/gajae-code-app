//! Built-in WebView browser proof of concept.
//!
//! Opens one dedicated `WebviewWindow` that renders a remote https page
//! directly in the system WebView — no screencast, no input forwarding, no
//! Puppeteer/Chromium sidecar. The user interacts with the page natively.
//!
//! Security model (see docs/BUILTIN-WEBVIEW-POC.md):
//! - The window label [`WINDOW_LABEL`] is referenced by no Tauri capability,
//!   so the remote page can invoke neither plugin commands nor app commands
//!   (app commands are ACL-gated because build.rs declares an app manifest).
//! - [`STRIP_TAURI_BRIDGE`] additionally removes the `window.__TAURI__`
//!   global API from the remote document before page scripts run
//!   (`__TAURI_INTERNALS__` itself is non-configurable and remains, but
//!   every invoke through it is denied by the ACL).
//! - `navigation::plugin` lets this window navigate to https URLs only;
//!   every other webview keeps the loopback-only lock.

use serde::Serialize;
use tauri::Manager;

pub const WINDOW_LABEL: &str = "browser-poc";
const WINDOW_TITLE: &str = "Gajae Built-in Browser (PoC)";
const MAX_URL_LENGTH: usize = 4096;

/// Fixed macOS WKWebsiteDataStore for the PoC browser: persistent across
/// window reopen and app restarts, isolated from the main webview's store.
#[cfg(target_os = "macos")]
const WEBKIT_STORE: [u8; 16] = [
    0xa4, 0xc8, 0x1f, 0x6e, 0x2b, 0x90, 0x4c, 0x57, 0x8d, 0x3e, 0x6f, 0x1b, 0x2a, 0x9c, 0x4d, 0x80,
];

pub(crate) fn owns_window(label: &str) -> bool {
    label == WINDOW_LABEL
}

/// The PoC browser window may only ever show plain https pages: no app
/// surfaces (`tauri:`/loopback), no cleartext http, no exotic schemes and
/// no URL-embedded credentials.
pub fn permits_url(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
}

pub fn validated_url(raw: &str) -> Result<tauri::Url, String> {
    if raw.len() > MAX_URL_LENGTH {
        return Err("The PoC browser only accepts URLs up to 4096 characters.".to_owned());
    }
    let url: tauri::Url = raw
        .parse()
        .map_err(|error| format!("The PoC browser could not parse the URL: {error}"))?;
    if !permits_url(&url) {
        return Err("The PoC browser only opens https URLs.".to_owned());
    }
    Ok(url)
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenOutcome {
    pub created: bool,
    pub url: String,
}

/// Opens (or focuses) the PoC browser window. A second call never creates a
/// duplicate window: the existing one is shown and focused instead, keeping
/// its user-navigated page intact.
pub fn open(app: &tauri::AppHandle, raw_url: &str) -> Result<OpenOutcome, String> {
    let url = validated_url(raw_url)?;
    if let Some(existing) = app.get_webview_window(WINDOW_LABEL) {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        // Report where the window actually is, not what was requested: the
        // PoC window keeps its user-navigated page on re-open.
        let current = existing
            .url()
            .map(|url| url.to_string())
            .unwrap_or_else(|_| url.to_string());
        return Ok(OpenOutcome {
            created: false,
            url: current,
        });
    }
    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        WINDOW_LABEL,
        tauri::WebviewUrl::External(url.clone()),
    )
    .title(WINDOW_TITLE)
    .inner_size(1200.0, 800.0)
    .min_inner_size(480.0, 320.0)
    .resizable(true)
    .initialization_script(STRIP_TAURI_BRIDGE);
    #[cfg(target_os = "macos")]
    {
        builder = builder.data_store_identifier(WEBKIT_STORE);
    }
    #[cfg(not(target_os = "macos"))]
    {
        // WebView2 / WebKitGTK profile directory. Best effort: the platform
        // default data folder is an acceptable PoC fallback.
        if let Ok(data_dir) = app.path().app_data_dir() {
            builder = builder.data_directory(data_dir.join(WINDOW_LABEL));
        }
    }
    builder
        .build()
        .map_err(|error| format!("The PoC browser window could not be opened: {error}"))?;
    Ok(OpenOutcome {
        created: true,
        url: url.to_string(),
    })
}

/// PoC-only read-only probe: evaluates `document.title` in the browser
/// window and renders the result as a dismissable-looking banner inside the
/// page itself. This is the whole "automation" surface of the PoC.
pub fn title_probe(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(WINDOW_LABEL)
        .ok_or_else(|| "The PoC browser window is not open.".to_owned())?;
    window
        .eval(TITLE_PROBE_SCRIPT)
        .map_err(|error| format!("The PoC title probe could not run: {error}"))
}

/// Runs after Tauri's own initialization scripts (user scripts are appended),
/// still before any remote page script. It removes the `window.__TAURI__`
/// global API bundle (a plain assignment, so redefining works).
/// `window.__TAURI_INTERNALS__` itself cannot be removed — Tauri defines it
/// non-configurable — so it stays present in remote pages; every command
/// invoked through it is denied by the capability ACL (no capability
/// references this window label) and the per-app invoke key it needs is only
/// reachable inside initialization-script closures. Verified live in the PoC
/// smoke test: `invoke('retry_desktop_server')` from example.com was rejected
/// with `not allowed on window "browser-poc"`.
const STRIP_TAURI_BRIDGE: &str = r#"
(function () {
  ['__TAURI__', '__TAURI_INTERNALS__'].forEach(function (name) {
    try { delete window[name]; } catch (error) {}
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: function () { return undefined; }
      });
    } catch (error) {}
  });
})();
"#;

const TITLE_PROBE_SCRIPT: &str = r#"
(function () {
  var previous = document.getElementById('gajae-browser-poc-title');
  if (previous) previous.remove();
  var banner = document.createElement('div');
  banner.id = 'gajae-browser-poc-title';
  banner.textContent = 'Gajae PoC: document.title = ' + (document.title || '(empty)');
  banner.setAttribute('style', 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#111827;color:#f9fafb;font:12px ui-monospace,monospace;padding:6px 10px;pointer-events:none;');
  (document.body || document.documentElement).appendChild(banner);
})();
"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn url(value: &str) -> tauri::Url {
        value.parse().expect("test URL parses")
    }

    #[test]
    fn owns_window_matches_only_the_poc_label() {
        assert!(owns_window(WINDOW_LABEL));
        assert!(!owns_window("main"));
        assert!(!owns_window(""));
        assert!(!owns_window("browser-poc-extra"));
    }

    #[test]
    fn only_plain_https_urls_are_permitted() {
        assert!(permits_url(&url("https://example.com/")));
        assert!(permits_url(&url("https://example.com/some/path?q=1#frag")));
        assert!(!permits_url(&url("http://example.com/")));
        assert!(!permits_url(&url("http://127.0.0.1:3001/")));
        assert!(!permits_url(&url("tauri://localhost/")));
        assert!(!permits_url(&url("file:///etc/passwd")));
        assert!(!permits_url(&url("about:blank")));
        assert!(!permits_url(&url("javascript:alert(1)")));
        assert!(!permits_url(&url("https://user:pass@example.com/")));
        assert!(!permits_url(&url("https://:pass@example.com/")));
        assert!(permits_url(&url("https://127.0.0.1:8443/")));
    }

    #[test]
    fn validated_url_reports_clear_errors() {
        assert_eq!(
            validated_url("https://example.com/").unwrap().as_str(),
            "https://example.com/"
        );
        assert!(validated_url("http://example.com/").is_err());
        assert!(validated_url("not a url").is_err());
        assert!(validated_url(&format!("https://example.com/{}", "a".repeat(4096))).is_err());
    }

    #[test]
    fn open_outcome_serializes_camel_case() {
        let outcome = OpenOutcome {
            created: true,
            url: "https://example.com/".to_owned(),
        };
        assert_eq!(
            serde_json::to_string(&outcome).unwrap(),
            r#"{"created":true,"url":"https://example.com/"}"#
        );
    }

    #[test]
    fn capability_files_keep_the_browser_window_unprivileged() {
        let capabilities_dir =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
        let mut files: Vec<_> = std::fs::read_dir(&capabilities_dir)
            .expect("capabilities directory exists")
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
            .collect();
        files.sort();
        assert!(!files.is_empty(), "at least one capability must exist");

        let poc_permissions = ["allow-browser-poc-open", "allow-browser-poc-title-probe"];
        let mut saw_poc_capability = false;
        for path in &files {
            let value: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
            let identifier = value["identifier"].as_str().unwrap_or_default();
            let windows: Vec<&str> = value["windows"]
                .as_array()
                .map(|windows| {
                    windows
                        .iter()
                        .map(|window| window.as_str().unwrap_or_default())
                        .collect()
                })
                .unwrap_or_default();
            let permissions: Vec<&str> = value["permissions"]
                .as_array()
                .map(|permissions| {
                    permissions
                        .iter()
                        .map(|permission| permission.as_str().unwrap_or_default())
                        .collect()
                })
                .unwrap_or_default();

            // The browser window itself is granted nothing: no capability may
            // reference its label, in any context.
            assert!(
                !windows.contains(&WINDOW_LABEL),
                "{} must not grant anything to the {WINDOW_LABEL} window",
                path.display()
            );

            if identifier == "browser-poc" {
                saw_poc_capability = true;
                assert_eq!(windows, vec!["main"], "PoC commands are main-window only");
                assert_eq!(
                    value["remote"]["urls"],
                    serde_json::json!(["http://127.0.0.1:*"]),
                    "the PoC capability must only match the supervised loopback origin"
                );
                assert_eq!(
                    permissions, poc_permissions,
                    "the PoC capability grants exactly the two PoC commands"
                );
            } else {
                for permission in poc_permissions {
                    assert!(
                        !permissions.contains(&permission),
                        "{} must not grant {permission}",
                        path.display()
                    );
                }
            }
        }
        assert!(saw_poc_capability, "the browser-poc capability must exist");
    }
}

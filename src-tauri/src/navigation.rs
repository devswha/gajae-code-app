use std::sync::Mutex;

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager,
};

#[derive(Default)]
pub struct LoopbackOrigin(Mutex<Option<String>>);

impl LoopbackOrigin {
    pub(crate) fn clear(&self) {
        *self.0.lock().expect("loopback origin lock poisoned") = None;
    }

    pub fn set(&self, origin: String) {
        *self.0.lock().expect("loopback origin lock poisoned") = Some(origin);
    }

    pub(crate) fn permits(&self, url: &tauri::Url) -> bool {
        if url.scheme() == "tauri" {
            return bundled_page(url);
        }
        #[cfg(target_os = "windows")]
        if url.scheme() == "http" && url.host_str() == Some("tauri.localhost") {
            return bundled_page(url);
        }
        let origin = self.0.lock().expect("loopback origin lock poisoned");
        let Some(origin) = origin.as_deref() else {
            return false;
        };
        let expected: tauri::Url = origin
            .parse()
            .expect("supervisor created a valid loopback origin");
        url.scheme() == expected.scheme()
            && url.host_str() == expected.host_str()
            && url.port_or_known_default() == expected.port_or_known_default()
    }

    pub(crate) fn conflicts_with_server(&self, url: &tauri::Url) -> bool {
        if url.scheme() != "http" || !loopback_host(url.host_str()) {
            return false;
        }
        let origin = self.0.lock().expect("loopback origin lock poisoned");
        let Some(origin) = origin.as_deref() else {
            return false;
        };
        let expected: tauri::Url = origin
            .parse()
            .expect("supervisor created a valid loopback origin");
        loopback_host(expected.host_str())
            && url.port_or_known_default() == expected.port_or_known_default()
    }
}

fn loopback_host(host: Option<&str>) -> bool {
    matches!(host, Some("localhost" | "127.0.0.1" | "[::1]" | "::1"))
}

/// The shell's own bundled documents, and nothing else.
///
/// `tauri://` is where the desktop IPC lives, and the app's webview normally
/// sits on a loopback HTTP origin that has none. Permitting the scheme as a
/// whole let any page that reached the webview navigate back onto the shell's
/// origin; only the two documents this app actually ships are reachable now.
fn bundled_page(url: &tauri::Url) -> bool {
    matches!(url.host_str(), Some("localhost" | "tauri.localhost"))
        && matches!(url.path(), "/" | "/index.html" | "/builtin-browser.html")
}

pub fn plugin() -> TauriPlugin<tauri::Wry> {
    Builder::new("desktop-navigation")
        .on_navigation(|webview, url| {
            #[cfg(target_os = "macos")]
            if webview.label() == crate::builtin_browser::PAGE_LABEL {
                if !crate::builtin_browser::permits_page_url(webview.app_handle(), url) {
                    return false;
                }
                crate::builtin_browser::navigation_requested(webview.app_handle(), url);
                return true;
            }
            #[cfg(target_os = "macos")]
            if !crate::updater_restart::permits_navigation(webview.app_handle(), url) {
                return false;
            }
            webview.app_handle().state::<LoopbackOrigin>().permits(url)
        })
        .build()
}

pub fn bootstrap_url(port: u16, nonce: &str) -> Result<tauri::Url, String> {
    format!("http://127.0.0.1:{port}/desktop/bootstrap?nonce={nonce}")
        .parse()
        .map_err(|error| format!("invalid desktop bootstrap URL: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstrap_url_uses_the_loopback_nonce_exchange() {
        assert_eq!(
            bootstrap_url(43123, "nonce-value").unwrap().as_str(),
            "http://127.0.0.1:43123/desktop/bootstrap?nonce=nonce-value"
        );
    }
}
#[cfg(test)]
mod navigation_policy_tests {
    use super::*;

    #[test]
    fn navigation_allows_only_the_assigned_loopback_origin() {
        let origin = LoopbackOrigin::default();
        origin.set("http://127.0.0.1:43123".to_owned());
        assert!(origin.permits(&"http://127.0.0.1:43123/api/jobs".parse().unwrap()));
        assert!(!origin.permits(&"http://127.0.0.1:43124/".parse().unwrap()));
        assert!(!origin.permits(&"https://example.com/".parse().unwrap()));
        origin.clear();
        assert!(!origin.permits(&"http://127.0.0.1:43123/".parse().unwrap()));
        assert!(origin.permits(&"tauri://localhost/".parse().unwrap()));
    }

    #[test]
    fn only_the_bundled_documents_are_reachable_on_the_shell_origin() {
        // tauri:// is where the desktop IPC lives; the webview sits on loopback
        // HTTP, which has none. Permitting the scheme as a whole let any page
        // that reached the webview navigate back onto the shell's own origin.
        let origin = LoopbackOrigin::default();
        origin.set("http://127.0.0.1:43123".to_owned());
        for allowed in [
            "tauri://localhost/",
            "tauri://localhost/index.html",
            "tauri://localhost/builtin-browser.html",
        ] {
            assert!(origin.permits(&allowed.parse().unwrap()), "{allowed}");
        }
        for refused in [
            "tauri://localhost/../secrets",
            "tauri://localhost/anything-else.html",
            "tauri://evil.example/index.html",
            "tauri://localhost/index.html/../../etc/passwd",
        ] {
            assert!(!origin.permits(&refused.parse().unwrap()), "{refused}");
        }
    }

    #[test]
    fn supervised_http_port_conflicts_through_every_loopback_alias() {
        let origin = LoopbackOrigin::default();
        origin.set("http://127.0.0.1:43123".to_owned());
        for url in [
            "http://127.0.0.1:43123/",
            "http://localhost:43123/",
            "http://[::1]:43123/",
        ] {
            assert!(origin.conflicts_with_server(&url.parse().unwrap()), "{url}");
        }
        assert!(!origin.conflicts_with_server(&"http://localhost:43124/".parse().unwrap()));
        assert!(!origin.conflicts_with_server(&"https://localhost:43123/".parse().unwrap()));
    }
}

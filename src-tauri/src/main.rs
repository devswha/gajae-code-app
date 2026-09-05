#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;

use fs2::FileExt;
use tauri::Manager;

mod lifecycle;
mod navigation;
mod supervisor;

struct SingleInstanceLock {
    _file: std::fs::File,
}

fn acquire_single_instance_lock() -> Result<SingleInstanceLock, String> {
    let lock_path = std::env::temp_dir().join("gajae-app-desktop.lock");
    acquire_single_instance_lock_at(&lock_path)
}

fn acquire_single_instance_lock_at(
    lock_path: &std::path::Path,
) -> Result<SingleInstanceLock, String> {
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(lock_path)
        .map_err(|error| format!("could not open desktop instance lock: {error}"))?;
    file.try_lock_exclusive()
        .map_err(|_| "Gajae Code App is already running.".to_owned())?;
    Ok(SingleInstanceLock { _file: file })
}
fn is_gajae_deep_link(url: &tauri::Url) -> bool {
    url.scheme() == "gajae-app"
}

fn deep_link_route(url: &tauri::Url) -> Option<String> {
    if !is_gajae_deep_link(url) || url.host_str() != Some("open") {
        return None;
    }
    let segments: Vec<&str> = url.path_segments()?.filter(|s| !s.is_empty()).collect();
    match segments.as_slice() {
        ["job", id]
            if !id.is_empty()
                && id.len() <= 128
                && id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-')) =>
        {
            Some("/".to_owned())
        }
        _ => None,
    }
}

#[cfg(any(target_os = "linux", test))]
struct StartupDeepLinks(std::sync::Mutex<Vec<tauri::Url>>);

#[cfg(any(target_os = "linux", test))]
impl StartupDeepLinks {
    fn new(urls: Vec<tauri::Url>) -> Self {
        Self(std::sync::Mutex::new(
            urls.into_iter()
                .filter(|url| deep_link_route(url).is_some())
                .collect(),
        ))
    }

    fn take_for_page(
        &self,
        label: &str,
        url: &tauri::Url,
        event: tauri::webview::PageLoadEvent,
    ) -> Vec<tauri::Url> {
        // The navigation policy already restricts HTTP pages to the assigned
        // loopback origin. Wait for bootstrap's redirect to the app root;
        // recovery and nonce-exchange documents cannot consume startup links.
        if label != "main"
            || event != tauri::webview::PageLoadEvent::Finished
            || url.scheme() != "http"
            || url.host_str() != Some("127.0.0.1")
            || url.path() != "/"
        {
            return Vec::new();
        }
        std::mem::take(&mut *self.0.lock().expect("startup deep-link lock poisoned"))
    }
}

#[cfg(target_os = "linux")]
fn route_startup_deep_links(
    webview: &tauri::Webview,
    payload: &tauri::webview::PageLoadPayload<'_>,
) {
    let app = webview.app_handle();
    if let Some(startup) = app.try_state::<StartupDeepLinks>() {
        for url in startup.take_for_page(webview.label(), payload.url(), payload.event()) {
            route_deep_link(app, url);
        }
    }
}

fn route_deep_link(app: &tauri::AppHandle, url: tauri::Url) {
    use tauri::{Emitter, Manager};

    if !is_gajae_deep_link(&url) {
        return;
    }
    let _ = app.emit_to("main", "desktop://deep-link", url.as_str());
    if let Some(window) = app.get_webview_window("main") {
        // The served UI is a remote loopback origin where Tauri IPC event
        // injection is not guaranteed, so navigate the SPA directly; the id
        // is validated above and contains no characters needing escaping.
        if let Some(path) = deep_link_route(&url) {
            let _ = window.eval(format!(
                "window.history.pushState({{}},'','{path}');window.dispatchEvent(new PopStateEvent('popstate'));"
            ));
        }
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn retry_desktop_server(app: tauri::AppHandle) {
    supervisor::start(app);
}

fn main() {
    use tauri_plugin_deep_link::DeepLinkExt;

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(navigation::plugin())
        .on_window_event(lifecycle::handle_close_request)
        .invoke_handler(tauri::generate_handler![retry_desktop_server])
        .setup(|app| {
            // A held lock means another instance is running. Setup errors
            // abort inside did_finish_launching (panic_cannot_unwind ->
            // SIGABRT -> crash-reporter dialog), so exit cleanly instead;
            // macOS LaunchServices focuses the running instance on reopen.
            // Linux second-launch URLs still need interprocess forwarding;
            // the file lock prevents duplicate servers but cannot relay URLs.
            let lock = match acquire_single_instance_lock() {
                Ok(lock) => lock,
                Err(message) => {
                    eprintln!("{message}");
                    std::process::exit(0);
                }
            };
            app.manage(lock);
            app.manage(navigation::LoopbackOrigin::default());
            app.manage(lifecycle::SidecarLifecycle::default());
            let app_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    route_deep_link(&app_handle, url);
                }
            });
            #[cfg(target_os = "linux")]
            {
                // The plugin handles Linux argv before this setup callback,
                // so on_open_url alone misses the initial launch event.
                let urls = app.deep_link().get_current().unwrap_or_else(|error| {
                    eprintln!("could not read desktop startup deep links: {error}");
                    None
                });
                app.manage(StartupDeepLinks::new(urls.unwrap_or_default()));
            }
            supervisor::start(app.handle().clone());
            Ok(())
        });
    #[cfg(target_os = "linux")]
    let builder = builder.on_page_load(route_startup_deep_links);
    let app = builder
        .build(tauri::generate_context!())
        .expect("failed to run Gajae Code App desktop shell");
    app.run(
        |app: &tauri::AppHandle<tauri::Wry>, event: tauri::RunEvent| match event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                // graceful_quit finishes with app.exit(), which requests exit
                // again on Linux. Let that request through only after the
                // sidecar is gone; otherwise closing can never release the
                // single-instance lock for the next launch.
                if !app
                    .state::<lifecycle::SidecarLifecycle>()
                    .shutdown_complete()
                {
                    api.prevent_exit();
                    lifecycle::graceful_quit(app.clone());
                }
            }
            tauri::RunEvent::Exit => {
                // macOS Quit Apple events (Cmd-Q, AppleScript quit) bypass a
                // preventable ExitRequested in this Tauri version; guarantee
                // the sidecar's graceful shutdown on every exit path.
                lifecycle::blocking_shutdown(app);
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {}
        },
    );
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_deep_links_wait_for_the_main_app_after_bootstrap_and_are_consumed_once() {
        use tauri::webview::PageLoadEvent::{Finished, Started};

        let link: tauri::Url = "gajae-app://open/job/job-123".parse().unwrap();
        let startup = StartupDeepLinks::new(vec![link.clone()]);
        for (label, url, event) in [
            ("main", "tauri://localhost/", Finished),
            (
                "main",
                "http://127.0.0.1:43123/desktop/bootstrap?nonce=test",
                Finished,
            ),
            ("main", "https://example.com/", Finished),
            ("other", "http://127.0.0.1:43123/", Finished),
            ("main", "http://127.0.0.1:43123/", Started),
        ] {
            assert!(startup
                .take_for_page(label, &url.parse().unwrap(), event)
                .is_empty());
        }
        let app_url = "http://127.0.0.1:43123/".parse().unwrap();
        assert_eq!(
            startup.take_for_page("main", &app_url, Finished),
            vec![link]
        );
        assert!(startup.take_for_page("main", &app_url, Finished).is_empty());
    }

    #[test]
    fn startup_deep_links_validate_cli_urls_before_queueing() {
        let startup = StartupDeepLinks::new(
            [
                "https://example.com/",
                "gajae-app://other/job/123",
                "gajae-app://open/job/bad%20id",
                "gajae-app://open/job/job-123",
            ]
            .into_iter()
            .map(|url| url.parse().unwrap())
            .collect(),
        );
        assert_eq!(
            startup.take_for_page(
                "main",
                &"http://127.0.0.1:43123/".parse().unwrap(),
                tauri::webview::PageLoadEvent::Finished,
            ),
            vec!["gajae-app://open/job/job-123"
                .parse::<tauri::Url>()
                .unwrap()]
        );
    }

    #[test]
    fn single_instance_lock_is_released_for_a_fresh_launch() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let lock_path = std::env::temp_dir().join(format!(
            "gajae-app-desktop-test-{}-{unique}.lock",
            std::process::id()
        ));
        let first = acquire_single_instance_lock_at(&lock_path).unwrap();
        assert!(acquire_single_instance_lock_at(&lock_path).is_err());
        drop(first);

        // The lock file persists after shutdown; its presence alone must not
        // stop the next launch once the previous shell releases its handle.
        assert!(lock_path.exists());
        let relaunched = acquire_single_instance_lock_at(&lock_path)
            .expect("a stopped shell must not prevent relaunch");
        drop(relaunched);
        std::fs::remove_file(lock_path).unwrap();
    }

    #[test]
    fn deep_link_router_accepts_only_the_registered_scheme() {
        assert!(is_gajae_deep_link(
            &"gajae-app://open/job/123".parse().unwrap()
        ));
        assert!(!is_gajae_deep_link(
            &"https://example.com/".parse().unwrap()
        ));
    }

    #[test]
    fn deep_link_route_returns_validated_job_urls_to_the_root_shell() {
        assert_eq!(
            deep_link_route(&"gajae-app://open/job/job-7fb9426de036".parse().unwrap()),
            Some("/".to_owned())
        );
        for rejected in [
            "gajae-app://open/job/",
            "gajae-app://open/session/x",
            "gajae-app://other/job/x",
            "gajae-app://open/job/bad%20id",
            "gajae-app://open/job/a/b",
            "https://example.com/open/job/x",
        ] {
            assert_eq!(
                deep_link_route(&rejected.parse().unwrap()),
                None,
                "{rejected}"
            );
        }
    }
}

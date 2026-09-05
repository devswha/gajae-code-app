#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;

use fs2::FileExt;
use tauri::Manager;

mod lifecycle;
mod navigation;
mod supervisor;
#[cfg(windows)]
mod windows_process;

#[derive(Default)]
struct PendingDeepLink {
    url: std::sync::Mutex<Option<tauri::Url>>,
    ui_ready: std::sync::atomic::AtomicBool,
}

struct SingleInstanceLock {
    _file: std::fs::File,
}

fn acquire_single_instance_lock() -> Result<SingleInstanceLock, String> {
    let lock_path = std::env::temp_dir().join("gajae-app-desktop.lock");
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
    if !is_gajae_deep_link(url)
        || url.host_str() != Some("open")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
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

fn route_deep_link(app: &tauri::AppHandle, url: tauri::Url) {
    use tauri::{Emitter, Manager};

    if deep_link_route(&url).is_none() {
        return;
    }
    if app.get_webview_window("main").is_none() {
        *app.state::<PendingDeepLink>()
            .url
            .lock()
            .expect("deep-link lock poisoned") = Some(url);
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let on_server = app
            .state::<PendingDeepLink>()
            .ui_ready
            .load(std::sync::atomic::Ordering::SeqCst)
            && window.url().ok().is_some_and(|current| {
                current.host_str() == Some("127.0.0.1")
                    && current.path() != "/desktop/bootstrap"
                    && app.state::<navigation::LoopbackOrigin>().permits(&current)
            });
        if !on_server {
            *app.state::<PendingDeepLink>()
                .url
                .lock()
                .expect("deep-link lock poisoned") = Some(url);
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            return;
        }
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
        let _ = window.unminimize();
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
        .manage(PendingDeepLink::default())
        .manage(navigation::LoopbackOrigin::default())
        .manage(lifecycle::SidecarLifecycle::default());
    // Windows protocol activation starts a second process. Forward to the
    // running instance before its setup lock can reject the activation.
    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        if args.len() == 2 {
            if let Ok(url) = args[1].parse() {
                route_deep_link(app, url);
            }
        }
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));
    let app = builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(navigation::plugin())
        .on_window_event(lifecycle::hide_on_close)
        .on_page_load(|window, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                window
                    .app_handle()
                    .state::<PendingDeepLink>()
                    .ui_ready
                    .store(false, std::sync::atomic::Ordering::SeqCst);
            }
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
                && payload.url().host_str() == Some("127.0.0.1")
                && payload.url().path() != "/desktop/bootstrap"
                && window
                    .app_handle()
                    .state::<navigation::LoopbackOrigin>()
                    .permits(payload.url())
            {
                window
                    .app_handle()
                    .state::<PendingDeepLink>()
                    .ui_ready
                    .store(true, std::sync::atomic::Ordering::SeqCst);
                let pending = window
                    .app_handle()
                    .state::<PendingDeepLink>()
                    .url
                    .lock()
                    .expect("deep-link lock poisoned")
                    .take();
                if let Some(url) = pending {
                    route_deep_link(window.app_handle(), url);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![retry_desktop_server])
        .setup(|app| {
            // A held lock means another instance is running. Setup errors
            // abort inside did_finish_launching (panic_cannot_unwind ->
            // SIGABRT -> crash-reporter dialog), so exit cleanly instead;
            // LaunchServices already focuses the running instance on reopen.
            let lock = match acquire_single_instance_lock() {
                Ok(lock) => lock,
                Err(message) => {
                    eprintln!("{message}");
                    std::process::exit(0);
                }
            };
            app.manage(lock);
            let app_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    route_deep_link(&app_handle, url);
                }
            });
            // The plugin captures cold-start arguments before this listener.
            if let Some(urls) = app.deep_link().get_current()? {
                for url in urls {
                    route_deep_link(app.handle(), url);
                }
            }
            supervisor::start(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to run Gajae Code App desktop shell");
    app.run(
        |app: &tauri::AppHandle<tauri::Wry>, event: tauri::RunEvent| match event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                // app.exit() emits ExitRequested again. Once the tree is gone,
                // allow that request instead of endlessly preventing our Quit.
                if !app.state::<lifecycle::SidecarLifecycle>().may_exit() {
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
            "gajae-app://user@open/job/x",
            "gajae-app://open:123/job/x",
            "gajae-app://open/job/x?redirect=evil",
            "gajae-app://open/job/x#evil",
        ] {
            assert_eq!(
                deep_link_route(&rejected.parse().unwrap()),
                None,
                "{rejected}"
            );
        }
    }
}

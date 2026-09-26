//! Creates the configured windows from setup instead of letting Tauri create
//! them before it, so the main window can carry the hooks a config entry
//! cannot express (its document-title observer).

use tauri::utils::config::WindowConfig;

/// Takes the configured windows out of Tauri's automatic creation and returns
/// the ones to build in setup.
pub fn defer(config: &mut tauri::Config) -> Vec<WindowConfig> {
    let mut windows = Vec::new();
    for window in &mut config.app.windows {
        if window.create {
            windows.push(window.clone());
        }
        window.create = false;
    }
    windows
}

pub fn create(app: &tauri::App, windows: &[WindowConfig]) -> tauri::Result<()> {
    for window in windows {
        let mut builder = tauri::WebviewWindowBuilder::from_config(app, window)?;
        // The runtime drops the UUID in WindowConfig -> WebviewAttributes, so
        // an isolated QA store must be set explicitly.
        if let Some(store) = window.data_store_identifier {
            builder = builder.data_store_identifier(store);
        }
        if window.label == "main" {
            builder = builder.on_document_title_changed(|window, title| {
                crate::window_title::apply(&window, &title);
            });
        }
        builder.build()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deferred_windows_are_returned_once_and_no_longer_auto_created() {
        let mut config: tauri::Config =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let windows = defer(&mut config);
        assert_eq!(
            windows
                .iter()
                .map(|window| window.label.as_str())
                .collect::<Vec<_>>(),
            ["main"]
        );
        assert!(config.app.windows.iter().all(|window| !window.create));
        assert!(
            defer(&mut config).is_empty(),
            "a second pass finds nothing left to create"
        );
    }
}

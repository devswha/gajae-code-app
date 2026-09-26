//! The macOS menu bar.
//!
//! App commands reach the page as a DOM event, because the page has no IPC
//! into the shell: the shell evaluates
//! `window.dispatchEvent(new CustomEvent('gajae:menu', { detail: '<id>' }))`
//! on the main webview and `src/components/app/DesktopMenuBridge.tsx` runs the
//! matching command. Only the constant ids below are ever sent.

use tauri::menu::{
    AboutMetadata, Menu, MenuBuilder, MenuEvent, MenuItemBuilder, PredefinedMenuItem,
    SubmenuBuilder,
};
use tauri::{AppHandle, Wry};

/// Menu ids forwarded to the page, each with its label and accelerator.
const PAGE_COMMANDS: &[(&str, &str, Option<&str>)] = &[
    ("settings", "Settings…", Some("CmdOrCtrl+,")),
    ("new-conversation", "New Conversation", Some("CmdOrCtrl+N")),
    ("new-workspace", "Add Workspace…", Some("CmdOrCtrl+Shift+N")),
    ("command-palette", "Search…", Some("CmdOrCtrl+K")),
    (
        "toggle-sidebar",
        "Show or Hide Sidebar",
        Some("Ctrl+CmdOrCtrl+S"),
    ),
    (
        "toggle-agent-panel",
        "Show or Hide Agent Panel",
        Some("Alt+CmdOrCtrl+0"),
    ),
];

/// Help items; the page opens their links through its external-link path,
/// so the shell holds no URLs and opens nothing itself.
const HELP_COMMANDS: &[(&str, &str)] = &[
    ("report-issue", "Report an Issue…"),
    ("community", "Community on Discord"),
    ("repository", "Gajae Code App on GitHub"),
];

fn page_item(app: &AppHandle, id: &str) -> tauri::Result<tauri::menu::MenuItem<Wry>> {
    let (_, label, accelerator) = PAGE_COMMANDS
        .iter()
        .find(|(command, _, _)| *command == id)
        .expect("page command is declared");
    let builder = MenuItemBuilder::with_id(id, *label);
    match accelerator {
        Some(accelerator) => builder.accelerator(*accelerator).build(app),
        None => builder.build(app),
    }
}

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let name = app.package_info().name.clone();
    let about = AboutMetadata {
        name: Some(name.clone()),
        version: Some(app.package_info().version.to_string()),
        ..Default::default()
    };
    let app_menu = SubmenuBuilder::new(app, &name)
        .item(&PredefinedMenuItem::about(app, None, Some(about))?)
        .separator()
        .item(&page_item(app, "settings")?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&page_item(app, "new-conversation")?)
        .item(&page_item(app, "new-workspace")?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&page_item(app, "command-palette")?)
        .separator()
        .item(&page_item(app, "toggle-sidebar")?)
        .item(&page_item(app, "toggle-agent-panel")?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .build()?;
    let mut help = SubmenuBuilder::new(app, "Help");
    for (id, label) in HELP_COMMANDS {
        help = help.item(&MenuItemBuilder::with_id(*id, *label).build(app)?);
    }
    MenuBuilder::new(app)
        .items(&[&app_menu, &file, &edit, &view, &window, &help.build()?])
        .build()
}

/// The script that hands a page command to `DesktopMenuBridge`.
fn dispatch_script(command: &str) -> String {
    format!("window.dispatchEvent(new CustomEvent('gajae:menu',{{detail:'{command}'}}));")
}

pub fn handle(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    let Some(command) = page_commands().find(|command| *command == id) else {
        return;
    };
    let Some(window) = crate::main_webview_window(app) else {
        return;
    };
    // A command for a hidden window (closed to the Dock) brings it back.
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.eval(dispatch_script(command));
}

/// Every id the page is asked to run.
fn page_commands() -> impl Iterator<Item = &'static str> {
    PAGE_COMMANDS
        .iter()
        .map(|(command, _, _)| *command)
        .chain(HELP_COMMANDS.iter().map(|(command, _)| *command))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_commands_match_the_bridge() {
        // DesktopMenuBridge.tsx ignores anything it does not declare; keep the
        // two lists the same.
        let bridge = include_str!("../../src/components/app/DesktopMenuBridge.tsx");
        for command in page_commands() {
            let quoted = [format!("'{command}':"), format!("{command}:")];
            assert!(
                quoted.iter().any(|needle| bridge.contains(needle.as_str())),
                "the page does not handle menu command {command}"
            );
        }
    }

    #[test]
    fn the_dispatch_script_carries_only_the_constant_id() {
        assert_eq!(
            dispatch_script("new-conversation"),
            "window.dispatchEvent(new CustomEvent('gajae:menu',{detail:'new-conversation'}));"
        );
        for command in page_commands() {
            assert!(command
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte == b'-'));
        }
    }
}

//! The main window's title, Dock badge and attention request, driven by the
//! page's `document.title`.
//!
//! The app page has no IPC into the shell, but its title is already public:
//! the page composes it as `[Done] (n) <place> — Gajae Code App`
//! (`src/utils/windowTitle.ts`, `src/utils/pageTitleNotification.ts`), where
//! `(n)` counts the conversations waiting on the user and `[Done] ` marks the
//! open conversation finishing while the window was elsewhere. The shell
//! mirrors the clean title onto the window, shows the count on the Dock icon,
//! and bounces the Dock once when something new starts waiting while the
//! window is in the background.

use std::sync::Mutex;

const DONE_PREFIX: &str = "[Done] ";
/// The longest title the shell passes on; page titles are short, and a
/// runaway string must not reach AppKit.
const MAX_TITLE_CHARS: usize = 200;
/// A badge beyond this reads as "a lot" and is shown as the cap.
const MAX_BADGE: u32 = 999;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TitleState {
    /// The title without the notice and the count.
    pub title: String,
    /// What the Dock badge shows; zero clears it.
    pub badge: u32,
}

/// Splits a page title into the window title and its badge count.
pub fn parse(raw: &str) -> TitleState {
    let (done, rest) = match raw.strip_prefix(DONE_PREFIX) {
        Some(rest) => (true, rest),
        None => (false, raw),
    };
    let (count, rest) = leading_count(rest);
    let title: String = rest.trim().chars().take(MAX_TITLE_CHARS).collect();
    let badge = count.saturating_add(u32::from(done)).min(MAX_BADGE);
    TitleState { title, badge }
}

/// `(12) rest` -> `(12, "rest")`; anything else -> `(0, input)`.
fn leading_count(input: &str) -> (u32, &str) {
    let Some(inner) = input.strip_prefix('(') else {
        return (0, input);
    };
    let Some(close) = inner.find(") ") else {
        return (0, input);
    };
    let digits = &inner[..close];
    if digits.is_empty() || digits.len() > 6 || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return (0, input);
    }
    match digits.parse::<u32>() {
        Ok(count) => (count, &inner[close + 2..]),
        Err(_) => (0, input),
    }
}

/// Remembers the last badge so the Dock bounces only when it goes up.
#[derive(Default)]
pub struct Attention(Mutex<u32>);

impl Attention {
    /// Records `badge` and reports whether it rose since the last title.
    pub fn rose(&self, badge: u32) -> bool {
        let Ok(mut last) = self.0.lock() else {
            return false;
        };
        let rose = badge > *last;
        *last = badge;
        rose
    }
}

/// Applies a page title to the main window. Runs on the main thread (the
/// title callback is delivered there by WebKit).
pub fn apply(window: &tauri::WebviewWindow, raw: &str) {
    use tauri::Manager;

    let state = parse(raw);
    if !state.title.is_empty() {
        let _ = window.set_title(&state.title);
    }
    let _ = window.set_badge_count(if state.badge == 0 {
        None
    } else {
        Some(i64::from(state.badge))
    });
    let rose = window
        .app_handle()
        .try_state::<Attention>()
        .is_some_and(|attention| attention.rose(state.badge));
    if rose && !window.is_focused().unwrap_or(true) {
        let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(title: &str, badge: u32) -> TitleState {
        TitleState {
            title: title.into(),
            badge,
        }
    }

    #[test]
    fn a_plain_title_has_no_badge() {
        assert_eq!(parse("Gajae Code App"), state("Gajae Code App", 0));
        assert_eq!(
            parse("tidepool — Gajae Code App"),
            state("tidepool — Gajae Code App", 0)
        );
    }

    #[test]
    fn the_leading_count_becomes_the_badge() {
        assert_eq!(
            parse("(3) Fix the test — Gajae Code App"),
            state("Fix the test — Gajae Code App", 3)
        );
    }

    #[test]
    fn a_completion_notice_counts_once_on_top_of_the_count() {
        assert_eq!(parse("[Done] Gajae Code App"), state("Gajae Code App", 1));
        assert_eq!(
            parse("[Done] (2) tidepool — Gajae Code App"),
            state("tidepool — Gajae Code App", 3)
        );
    }

    #[test]
    fn only_a_well_formed_count_is_read() {
        for raw in [
            "(3)No space",
            "(x) Letters",
            "() Empty",
            "(1234567) Too long",
            "(-1) Negative",
            " (3) Indented",
        ] {
            assert_eq!(parse(raw).badge, 0, "{raw}");
        }
        assert_eq!(parse("(3)No space").title, "(3)No space");
    }

    #[test]
    fn the_badge_and_the_title_are_bounded() {
        assert_eq!(parse("(999999) Many").badge, MAX_BADGE);
        let long = format!("(1) {}", "x".repeat(MAX_TITLE_CHARS * 2));
        assert_eq!(parse(&long).title.chars().count(), MAX_TITLE_CHARS);
    }

    #[test]
    fn attention_rises_only_on_an_increase() {
        let attention = Attention::default();
        assert!(attention.rose(1));
        assert!(!attention.rose(1));
        assert!(!attention.rose(0));
        assert!(attention.rose(2));
    }
}

//! Paints the main window's transparent title bar in the page's own colour.
//!
//! The window uses a transparent, title-less title bar (`tauri.conf.json`), so
//! the band that holds the traffic lights shows the window's background. The
//! page states its chrome colour in `<meta name="theme-color">`, which WebKit
//! exposes as `WKWebView.themeColor`; observing that property keeps the band
//! the same colour as the page through theme changes, with no channel from the
//! page to the shell. The window's appearance is left alone on purpose: it
//! drives the page's `prefers-color-scheme`, which must keep following macOS.

use std::cell::RefCell;
use std::ffi::c_void;
use std::ptr;

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject};
use objc2::{define_class, msg_send, MainThreadMarker, MainThreadOnly};
use objc2_foundation::{
    ns_string, NSKeyValueObservingOptions, NSObjectNSKeyValueObserverRegistration, NSString,
};
use objc2_web_kit::WKWebView;

thread_local! {
    // The observer lives as long as the main webview, which is the life of
    // the app; it is main-thread only, like the view it watches.
    static OBSERVER: RefCell<Option<Retained<ThemeColorObserver>>> = const { RefCell::new(None) };
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements, and this type does
    // not implement Drop.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "GajaeThemeColorObserver"]
    struct ThemeColorObserver;

    impl ThemeColorObserver {
        // SAFETY: the signature matches NSKeyValueObserving's callback.
        #[unsafe(method(observeValueForKeyPath:ofObject:change:context:))]
        fn observe_value(
            &self,
            _key_path: Option<&NSString>,
            object: Option<&AnyObject>,
            _change: Option<&AnyObject>,
            _context: *mut c_void,
        ) {
            if let Some(webview) = object.and_then(|object| object.downcast_ref::<WKWebView>()) {
                paint_title_bar(webview);
            }
        }
    }
);

impl ThemeColorObserver {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(());
        // SAFETY: NSObject's init has this signature.
        unsafe { msg_send![super(this), init] }
    }
}

fn paint_title_bar(webview: &WKWebView) {
    // SAFETY: themeColor is a plain property read on the main thread.
    let Some(color) = (unsafe { webview.themeColor() }) else {
        return;
    };
    if let Some(window) = webview.window() {
        window.setBackgroundColor(Some(&color));
    }
}

/// Starts following the main webview's theme colour. Call once, after the
/// main window exists.
pub fn follow_page_color(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|platform| {
        let raw = platform.inner();
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        if raw.is_null() || OBSERVER.with_borrow(Option::is_some) {
            return;
        }
        // SAFETY: Wry hands back its live WKWebView on the main thread.
        let webview = unsafe { &*raw.cast::<WKWebView>() };
        let observer = ThemeColorObserver::new(mtm);
        // SAFETY: the observer is an NSObject retained for the webview's
        // lifetime, the key path is a constant, and no context is used.
        unsafe {
            webview.addObserver_forKeyPath_options_context(
                &observer,
                ns_string!("themeColor"),
                NSKeyValueObservingOptions::Initial | NSKeyValueObservingOptions::New,
                ptr::null_mut(),
            );
        }
        OBSERVER.set(Some(observer));
    });
}

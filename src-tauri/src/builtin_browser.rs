//! macOS built-in browser and its server-owned control bridge.
//!
//! The trusted toolbar and untrusted page are separate child webviews. The
//! page label is intentionally granted no Tauri capability; agent requests
//! arrive only through the authenticated Unix socket owned by this module.

use std::{
    cell::RefCell,
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    os::{
        fd::AsRawFd,
        unix::{
            ffi::OsStrExt,
            fs::{DirBuilderExt, MetadataExt, PermissionsExt},
            net::{UnixListener, UnixStream},
        },
    },
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc, Arc, Condvar, Mutex,
    },
    time::{Duration, Instant},
};

use hmac::{Hmac, Mac};
use objc2::{rc::Retained, runtime::AnyObject, MainThreadMarker};
use objc2_foundation::{NSError, NSPoint, NSRect, NSSize, NSString};
use objc2_web_kit::{WKContentWorld, WKWebView};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::Digest;
use tauri::{Emitter, Manager};

pub const WINDOW_LABEL: &str = "builtin-browser";
pub const CONTROLS_LABEL: &str = "builtin-controls";
pub const PAGE_LABEL: &str = "builtin-page";
const TOOLBAR_HEIGHT: f64 = 56.0;
const MAX_FRAME: usize = 256 * 1024;
const MAX_PREVIEW: usize = 32 * 1024;
const MAX_PENDING: usize = 8;
const HANDSHAKE_DEADLINE: Duration = Duration::from_secs(2);
const MAX_COMMAND_TIMEOUT_MS: u64 = 30_000;
const DEFAULT_URL: &str = "https://example.com/";
const CONTENT_WORLD_NAME: &str = "app.gajae.builtin-browser";
const DOCUMENT_TOKEN_PROPERTY: &str = "__gajaeBuiltinDocumentIdentity";

thread_local! {
    // WebKit preserves a named world's globals only while that world object is
    // retained. Keep the actual instance on its required main thread.
    static CONTENT_WORLD: RefCell<Option<Retained<WKContentWorld>>> = const { RefCell::new(None) };
}

fn retained_content_world(mtm: MainThreadMarker) -> Retained<WKContentWorld> {
    CONTENT_WORLD.with_borrow_mut(|slot| {
        slot.get_or_insert_with(|| unsafe {
            WKContentWorld::worldWithName(&NSString::from_str(CONTENT_WORLD_NAME), mtm)
        })
        .clone()
    })
}
const STRIP_TAURI_BRIDGE: &str = r#"
(function () {
  ['__TAURI__', '__TAURI_INTERNALS__'].forEach(function (name) {
    try { delete window[name]; } catch (_) {}
    try { Object.defineProperty(window, name, { configurable: true, get: function () { return undefined; } }); } catch (_) {}
  });
})();
"#;

#[cfg(target_os = "macos")]
const WEBKIT_STORE: [u8; 16] = [
    0x77, 0x0d, 0x98, 0xc7, 0xe5, 0x55, 0x4a, 0x7d, 0x8d, 0x35, 0x42, 0x7f, 0xe1, 0x09, 0x23, 0x62,
];
#[cfg(target_os = "macos")]
const WEBKIT_CONTROLS_STORE: [u8; 16] = [
    0x16, 0x61, 0xb9, 0x97, 0x8e, 0xe6, 0x49, 0x33, 0x94, 0x5d, 0x1d, 0xa7, 0x25, 0x31, 0x4a, 0xd1,
];

#[derive(Clone, Copy)]
enum StorePurpose {
    Controls,
    Page,
}

fn store_identifier_for(qa_root: Option<&std::path::Path>, purpose: StorePurpose) -> [u8; 16] {
    let Some(root) = qa_root else {
        return match purpose {
            StorePurpose::Controls => WEBKIT_CONTROLS_STORE,
            StorePurpose::Page => WEBKIT_STORE,
        };
    };
    let mut digest = sha2::Sha256::new();
    digest.update(b"gajae-builtin-browser-store-v1\0");
    digest.update(root.as_os_str().as_bytes());
    digest.update(match purpose {
        StorePurpose::Controls => b"\0controls" as &[u8],
        StorePurpose::Page => b"\0page" as &[u8],
    });
    let digest = digest.finalize();
    let mut identifier = [0u8; 16];
    identifier.copy_from_slice(&digest[..16]);
    // Preserve UUID variant/version shape for WebKit's identifier API.
    identifier[6] = (identifier[6] & 0x0f) | 0x50;
    identifier[8] = (identifier[8] & 0x3f) | 0x80;
    identifier
}

fn store_identifier(app: &tauri::AppHandle, purpose: StorePurpose) -> [u8; 16] {
    let root = app
        .try_state::<crate::qa_profile::QaProfile>()
        .map(|profile| profile.root().to_path_buf());
    store_identifier_for(root.as_deref(), purpose)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeInit {
    pub protocol_version: u8,
    pub socket: PathBuf,
    pub secret: String,
    pub epoch: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserBinding {
    window_epoch: String,
    document_epoch: u64,
    origin: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTabState {
    id: String,
    title: String,
    url: String,
    loading: bool,
    can_go_back: bool,
    can_go_forward: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserState {
    session_id: String,
    active_tab_id: Option<String>,
    tabs: Vec<BrowserTabState>,
    binding: Option<BrowserBinding>,
    profile_mode: &'static str,
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum ToolbarCommand {
    State,
    Navigate { url: String },
    Back,
    Forward,
    Reload,
    Close,
}

#[derive(Clone)]
struct Owner {
    session_id: String,
    window_epoch: String,
    document_epoch: u64,
    url: String,
    title: String,
    loading: bool,
    can_go_back: bool,
    can_go_forward: bool,
    document_token: Option<String>,
    profile_mode: &'static str,
}

struct Coordinator {
    epoch: String,
    revision: u64,
    owner: Option<Owner>,
    fenced: bool,
    pending: BTreeMap<String, bool>,
}

impl Default for Coordinator {
    fn default() -> Self {
        Self {
            epoch: random_hex().unwrap_or_else(|_| "browser-entropy-unavailable".into()),
            revision: 0,
            owner: None,
            fenced: false,
            pending: BTreeMap::new(),
        }
    }
}

struct BridgeRun {
    active: AtomicBool,
    pid: u32,
    secret: String,
    epoch: String,
    socket: PathBuf,
    pending: AtomicUsize,
}

impl BridgeRun {
    fn retire(&self) {
        self.active.store(false, Ordering::Release);
    }
}

#[derive(Default)]
pub(crate) struct BrowserCoordinator {
    state: Mutex<Coordinator>,
    destroyed: Condvar,
    bridge: Mutex<Option<Arc<BridgeRun>>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Challenge {
    protocol_version: u8,
    kind: String,
    epoch: String,
    pid: u32,
    nonce: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExpectedBinding {
    window_epoch: String,
    document_epoch: u64,
    origin: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    protocol_version: u8,
    secret: String,
    epoch: String,
    pid: u32,
    id: String,
    session_id: String,
    operation: String,
    #[serde(default)]
    payload: serde_json::Value,
    timeout_ms: u64,
    expected: Option<ExpectedBinding>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OpenPayload {
    url: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CommandPayload {
    command: BrowserCommand,
}

#[derive(Deserialize)]
#[serde(tag = "action", deny_unknown_fields)]
enum BrowserCommand {
    #[serde(rename = "navigate")]
    Navigate { url: String },
    #[serde(rename = "back")]
    Back,
    #[serde(rename = "forward")]
    Forward,
    #[serde(rename = "reload")]
    Reload,
    #[serde(rename = "observe")]
    Observe,
    #[serde(rename = "extract")]
    Extract {
        selector: Option<String>,
        format: Option<String>,
    },
    #[serde(rename = "click")]
    Click { selector: String },
    #[serde(rename = "fill")]
    Fill { selector: String, text: String },
}

const OBSERVE_SCRIPT: &str = r#"(function(){try{
var encoder=new TextEncoder(),decoder=new TextDecoder(),budget=28672;
function clip(value,bytes){var encoded=encoder.encode(String(value||''));return {text:decoder.decode(encoded.slice(0,bytes)),truncated:encoded.length>bytes};}
function uniquePath(el){if(el.id){var byId='#'+CSS.escape(el.id);if(document.querySelectorAll(byId).length===1)return byId;}var parts=[];for(var node=el;node&&node.nodeType===1;node=node.parentElement){var tag=node.tagName.toLowerCase();var parent=node.parentElement;if(parent){var siblings=Array.from(parent.children).filter(function(child){return child.tagName===node.tagName;});if(siblings.length>1)tag+=':nth-of-type('+(siblings.indexOf(node)+1)+')';}parts.unshift(tag);var selector=parts.join(' > ');if(selector.length<=4096&&document.querySelectorAll(selector).length===1)return selector;}return null;}
var body=clip(document.body&&(document.body.innerText||document.body.textContent)||'',12000),all=Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"]')),elements=[];
for(var i=0;i<all.length&&elements.length<100;i++){var el=all[i],selector=uniquePath(el);if(!selector)continue;var label=clip((el.innerText||el.textContent||el.getAttribute('aria-label')||el.getAttribute('placeholder')||'').trim(),256);elements.push({selector:selector,tag:el.tagName.toLowerCase(),text:label.text,textTruncated:label.truncated});}
var value={url:location.href,title:clip(document.title,1024).text,text:body.text,elements:elements,truncated:body.truncated||all.length>elements.length};
while(encoder.encode(JSON.stringify(value)).length>budget&&value.elements.length){value.elements.pop();value.truncated=true;}
while(encoder.encode(JSON.stringify(value)).length>budget&&value.text.length){value.text=value.text.slice(0,Math.floor(value.text.length/2));value.truncated=true;}
return {ok:true,value:value};
}catch(error){return {ok:false,error:'evaluation_failed'};}})()"#;

fn extract_script(selector: &str, html: bool) -> String {
    format!(
        "(function(){{try{{var matches={0}?document.querySelectorAll({0}):[document.documentElement];if(matches.length===0)return {{ok:false,error:'selector_not_found'}};if(matches.length!==1)return {{ok:false,error:'selector_not_unique'}};var raw={1};var encoder=new TextEncoder(),decoder=new TextDecoder(),encoded=encoder.encode(String(raw||'')),budget=28672,value={{content:decoder.decode(encoded.slice(0,budget)),format:{2},truncated:encoded.length>budget}};while(encoder.encode(JSON.stringify(value)).length>budget&&value.content.length){{value.content=value.content.slice(0,Math.floor(value.content.length/2));value.truncated=true;}}return {{ok:true,value:value}};}}catch(error){{return {{ok:false,error:'evaluation_failed'}};}}}})()",
        selector,
        if html {
            "matches[0].outerHTML"
        } else {
            "matches[0].innerText||matches[0].textContent||''"
        },
        if html { "'html'" } else { "'text'" },
    )
}

fn click_script(selector: &str) -> String {
    format!("(function(){{try{{var matches=document.querySelectorAll({selector});if(matches.length===0)return {{ok:false,error:'selector_not_found'}};if(matches.length!==1)return {{ok:false,error:'selector_not_unique'}};matches[0].click();return {{ok:true,value:{{clicked:true}}}};}}catch(error){{return {{ok:false,error:'evaluation_failed'}};}}}})()")
}

fn fill_script(selector: &str, text: &str) -> String {
    format!("(function(){{try{{var matches=document.querySelectorAll({selector});if(matches.length===0)return {{ok:false,error:'selector_not_found'}};if(matches.length!==1)return {{ok:false,error:'selector_not_unique'}};var el=matches[0],value={text};if(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement){{el.focus();var proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;var descriptor=Object.getOwnPropertyDescriptor(proto,'value');if(descriptor&&descriptor.set)descriptor.set.call(el,value);else el.value=value;}}else if(el.isContentEditable){{el.focus();el.textContent=value;}}else return {{ok:false,error:'element_not_fillable'}};el.dispatchEvent(new Event('input',{{bubbles:true}}));el.dispatchEvent(new Event('change',{{bubbles:true}}));return {{ok:true,value:{{filled:true}}}};}}catch(error){{return {{ok:false,error:'evaluation_failed'}};}}}})()")
}

fn guarded_script(
    script: &str,
    expected_url: &str,
    expected_origin: &Option<String>,
    document_token: &str,
) -> Result<String, &'static str> {
    let expected_url =
        serde_json::to_string(expected_url).map_err(|_| "builtin_browser_evaluation_failed")?;
    let expected_origin =
        serde_json::to_string(expected_origin).map_err(|_| "builtin_browser_evaluation_failed")?;
    let document_token =
        serde_json::to_string(document_token).map_err(|_| "builtin_browser_evaluation_failed")?;
    Ok(format!(
        "JSON.stringify((function(){{if(globalThis.{DOCUMENT_TOKEN_PROPERTY}!=={document_token}||location.href!=={expected_url}||location.origin!=={expected_origin})return {{ok:false,error:'stale_document'}};return ({script});}})())"
    ))
}

fn safe_id(value: &str) -> bool {
    value.len() <= 128
        && value
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_alphanumeric())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
}

fn equal_secret(left: &str, right: &str) -> bool {
    left.len() == 64
        && right.len() == 64
        && left
            .bytes()
            .zip(right.bytes())
            .fold(0u8, |difference, (a, b)| difference | (a ^ b))
            == 0
}

fn random_hex() -> Result<String, String> {
    use std::fmt::Write as _;
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|_| "builtin_browser_unavailable".to_owned())?;
    let mut value = String::with_capacity(64);
    for byte in bytes {
        write!(&mut value, "{byte:02x}").expect("hex string");
    }
    Ok(value)
}

fn proof(secret: &str, epoch: &str, nonce: &str) -> String {
    use std::fmt::Write as _;
    let mut mac = Hmac::<sha2::Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC key");
    mac.update(format!("gajae-native-browser-v1\0{epoch}\0{nonce}").as_bytes());
    let mut encoded = String::with_capacity(64);
    for byte in mac.finalize().into_bytes() {
        write!(&mut encoded, "{byte:02x}").expect("hex string");
    }
    encoded
}

fn peer_pid(stream: &UnixStream) -> Option<u32> {
    let mut pid: libc::pid_t = 0;
    let mut size = std::mem::size_of::<libc::pid_t>() as libc::socklen_t;
    let result = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_LOCAL,
            libc::LOCAL_PEERPID,
            (&mut pid as *mut libc::pid_t).cast(),
            &mut size,
        )
    };
    (result == 0 && size as usize == std::mem::size_of::<libc::pid_t>() && pid > 0)
        .then_some(pid as u32)
}

fn read_frame<T: DeserializeOwned>(stream: &mut UnixStream, deadline: Instant) -> Result<T, ()> {
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(());
        }
        stream.set_read_timeout(Some(remaining)).map_err(|_| ())?;
        let count = stream.read(&mut chunk).map_err(|_| ())?;
        if count == 0 || bytes.len() + count > MAX_FRAME {
            return Err(());
        }
        bytes.extend_from_slice(&chunk[..count]);
        if let Some(newline) = bytes.iter().position(|byte| *byte == b'\n') {
            if newline != bytes.len() - 1 {
                return Err(());
            }
            return serde_json::from_slice(&bytes[..newline]).map_err(|_| ());
        }
    }
}

fn write_frame(stream: &mut UnixStream, value: &serde_json::Value, deadline: Duration) -> bool {
    let Ok(mut bytes) = serde_json::to_vec(value) else {
        return false;
    };
    if bytes.len() + 1 > MAX_FRAME {
        return false;
    }
    bytes.push(b'\n');
    stream.set_write_timeout(Some(deadline)).is_ok() && stream.write_all(&bytes).is_ok()
}

pub(crate) fn attach(app: &tauri::AppHandle, pid: u32) -> Result<BridgeInit, String> {
    let secret = random_hex()?;
    let epoch = random_hex()?;
    let directory = std::env::temp_dir()
        .canonicalize()
        .map_err(|_| "builtin_browser_unavailable")?
        .join(format!("gjb-{}", &epoch[..16]));
    let socket = directory.join("rpc");
    if socket.as_os_str().as_bytes().len() >= 100 {
        return Err("builtin_browser_unavailable".into());
    }
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&directory)
        .map_err(|_| "builtin_browser_unavailable")?;
    let listener = UnixListener::bind(&socket).map_err(|_| "builtin_browser_unavailable")?;
    fs::set_permissions(&socket, fs::Permissions::from_mode(0o600))
        .map_err(|_| "builtin_browser_unavailable")?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "builtin_browser_unavailable")?;
    let inode = fs::symlink_metadata(&socket)
        .map_err(|_| "builtin_browser_unavailable")?
        .ino();
    let run = Arc::new(BridgeRun {
        active: AtomicBool::new(true),
        pid,
        secret: secret.clone(),
        epoch: epoch.clone(),
        socket: socket.clone(),
        pending: AtomicUsize::new(0),
    });
    let coordinator = app.state::<BrowserCoordinator>();
    if let Some(previous) = coordinator
        .bridge
        .lock()
        .map_err(|_| "builtin_browser_unavailable")?
        .replace(run.clone())
    {
        previous.retire();
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        while run.active.load(Ordering::Acquire) {
            match listener.accept() {
                Ok((stream, _)) => {
                    if run
                        .pending
                        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                            (count < MAX_PENDING).then_some(count + 1)
                        })
                        .is_err()
                    {
                        continue;
                    }
                    let run = run.clone();
                    let handle = handle.clone();
                    std::thread::spawn(move || {
                        serve(stream, &run, &handle);
                        run.pending.fetch_sub(1, Ordering::AcqRel);
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(25));
                }
                Err(_) => break,
            }
        }
        drop(listener);
        if fs::symlink_metadata(&run.socket).is_ok_and(|metadata| metadata.ino() == inode) {
            let _ = fs::remove_file(&run.socket);
        }
        let _ = fs::remove_dir(directory);
    });
    Ok(BridgeInit {
        protocol_version: 1,
        socket,
        secret,
        epoch,
    })
}

pub(crate) fn retire(app: &tauri::AppHandle) {
    if let Some(coordinator) = app.try_state::<BrowserCoordinator>() {
        if let Ok(mut bridge) = coordinator.bridge.lock() {
            if let Some(run) = bridge.take() {
                run.retire();
            }
        }
    }
}

fn serve(mut stream: UnixStream, run: &BridgeRun, app: &tauri::AppHandle) {
    if stream.set_nonblocking(false).is_err() {
        return;
    }
    let deadline = Instant::now() + HANDSHAKE_DEADLINE;
    let Some(peer) = peer_pid(&stream).filter(|peer| *peer == run.pid) else {
        return;
    };
    let Ok(challenge) = read_frame::<Challenge>(&mut stream, deadline) else {
        return;
    };
    if challenge.protocol_version != 1
        || challenge.kind != "challenge"
        || challenge.epoch != run.epoch
        || challenge.pid != peer
        || challenge.nonce.len() != 64
        || !challenge.nonce.bytes().all(|byte| byte.is_ascii_hexdigit())
        || !run.active.load(Ordering::Acquire)
    {
        return;
    }
    let challenge_response = serde_json::json!({
        "protocolVersion": 1,
        "kind": "challenge",
        "epoch": challenge.epoch,
        "nonce": challenge.nonce,
        "proof": proof(&run.secret, &run.epoch, &challenge.nonce),
    });
    if !write_frame(&mut stream, &challenge_response, HANDSHAKE_DEADLINE) {
        return;
    }
    let Ok(request) = read_frame::<Request>(&mut stream, deadline) else {
        return;
    };
    if request.protocol_version != 1
        || request.pid != peer
        || request.epoch != run.epoch
        || !equal_secret(&request.secret, &run.secret)
        || !safe_id(&request.id)
        || !safe_id(&request.session_id)
        || request.timeout_ms == 0
        || request.timeout_ms > MAX_COMMAND_TIMEOUT_MS
        || !run.active.load(Ordering::Acquire)
    {
        return;
    }
    let response_deadline = Duration::from_millis(request.timeout_ms.min(MAX_COMMAND_TIMEOUT_MS));
    let cancelled = Arc::new(AtomicBool::new(false));
    let finished = Arc::new(AtomicBool::new(false));
    if request.operation == "command" {
        if let Ok(mut observer) = stream.try_clone() {
            let cancelled = cancelled.clone();
            let finished = finished.clone();
            std::thread::spawn(move || {
                let _ = observer.set_read_timeout(Some(Duration::from_millis(50)));
                let mut byte = [0u8; 1];
                while !finished.load(Ordering::Acquire) {
                    match observer.read(&mut byte) {
                        Err(error)
                            if matches!(
                                error.kind(),
                                std::io::ErrorKind::WouldBlock
                                    | std::io::ErrorKind::TimedOut
                                    | std::io::ErrorKind::Interrupted
                            ) => {}
                        _ => {
                            cancelled.store(true, Ordering::Release);
                            break;
                        }
                    }
                }
            });
        }
    }
    let id = request.id.clone();
    let session_id = request.session_id.clone();
    let result = execute(app, &request, response_deadline, &cancelled);
    finished.store(true, Ordering::Release);
    let response = match result {
        Ok((result, current)) => serde_json::json!({
            "protocolVersion": 1, "id": id, "epoch": run.epoch,
            "sessionId": session_id, "ok": true, "result": result, "current": current,
        }),
        Err(error) => serde_json::json!({
            "protocolVersion": 1, "id": id, "epoch": run.epoch,
            "sessionId": session_id, "ok": false, "error": error,
        }),
    };
    let _ = write_frame(&mut stream, &response, response_deadline);
}

fn execute(
    app: &tauri::AppHandle,
    request: &Request,
    timeout: Duration,
    cancelled: &AtomicBool,
) -> Result<(serde_json::Value, Option<BrowserBinding>), &'static str> {
    match request.operation.as_str() {
        "status" => {
            let activity = activity(app)?;
            Ok((
                serde_json::json!({ "ready": true, "activity": activity }),
                current_binding(app),
            ))
        }
        "open" => {
            let payload: OpenPayload = serde_json::from_value(request.payload.clone())
                .map_err(|_| "builtin_browser_invalid_request")?;
            let state = open(app, &request.session_id, payload.url.as_deref())?;
            Ok((
                serde_json::to_value(&state).map_err(|_| "builtin_browser_unavailable")?,
                state.binding,
            ))
        }
        "state" => {
            let state = state_for(app, &request.session_id)?;
            Ok((
                serde_json::to_value(&state).map_err(|_| "builtin_browser_unavailable")?,
                state.binding,
            ))
        }
        "close" => {
            close(app, &request.session_id)?;
            let state = closed_state(&request.session_id);
            Ok((
                serde_json::to_value(state).map_err(|_| "builtin_browser_unavailable")?,
                None,
            ))
        }
        "command" => {
            let expected = request
                .expected
                .as_ref()
                .ok_or("builtin_browser_stale_document")?;
            let payload: CommandPayload = serde_json::from_value(request.payload.clone())
                .map_err(|_| "builtin_browser_invalid_request")?;
            let result = command(
                app,
                &request.id,
                &request.session_id,
                expected,
                payload.command,
                timeout,
                cancelled,
            )?;
            Ok((result, current_binding(app)))
        }
        _ => Err("builtin_browser_invalid_request"),
    }
}

fn activity(app: &tauri::AppHandle) -> Result<serde_json::Value, &'static str> {
    let coordinator = app.state::<BrowserCoordinator>();
    let state = coordinator
        .state
        .lock()
        .map_err(|_| "builtin_browser_unavailable")?;
    Ok(activity_value(&state))
}

fn activity_value(state: &Coordinator) -> serde_json::Value {
    let unknown: Vec<&str> = state
        .pending
        .values()
        .any(|uncertain| *uncertain)
        .then_some(vec!["browser_callback_unconfirmed"])
        .unwrap_or_default();
    serde_json::json!({
        "owner": "browser",
        "generation": format!("{}:{}", state.epoch, state.revision),
        "complete": unknown.is_empty(),
        "starting": 0,
        "queued": 0,
        "running": state.pending.len(),
        "settling": 0,
        "approvals": 0,
        "retained": usize::from(state.owner.is_some()),
        "unknown": unknown,
    })
}

fn current_binding(app: &tauri::AppHandle) -> Option<BrowserBinding> {
    app.state::<BrowserCoordinator>()
        .state
        .lock()
        .ok()
        .and_then(|state| state.owner.as_ref().map(binding))
}

fn binding(owner: &Owner) -> BrowserBinding {
    BrowserBinding {
        window_epoch: owner.window_epoch.clone(),
        document_epoch: owner.document_epoch,
        origin: origin(&owner.url),
    }
}

fn browser_state(owner: &Owner) -> BrowserState {
    BrowserState {
        session_id: owner.session_id.clone(),
        active_tab_id: Some(owner.window_epoch.clone()),
        tabs: vec![BrowserTabState {
            id: owner.window_epoch.clone(),
            title: owner.title.clone(),
            url: owner.url.clone(),
            loading: owner.loading,
            can_go_back: owner.can_go_back,
            can_go_forward: owner.can_go_forward,
        }],
        binding: Some(binding(owner)),
        profile_mode: owner.profile_mode,
    }
}

fn closed_state(session_id: &str) -> BrowserState {
    BrowserState {
        session_id: session_id.to_owned(),
        active_tab_id: None,
        tabs: Vec::new(),
        binding: None,
        profile_mode: profile_mode(),
    }
}

fn state_for(app: &tauri::AppHandle, session_id: &str) -> Result<BrowserState, &'static str> {
    let coordinator = app.state::<BrowserCoordinator>();
    let window_epoch = {
        let state = coordinator
            .state
            .lock()
            .map_err(|_| "builtin_browser_unavailable")?;
        let Some(owner) = state.owner.as_ref() else {
            return Ok(closed_state(session_id));
        };
        if owner.session_id != session_id {
            return Err("builtin_browser_in_use");
        }
        owner.window_epoch.clone()
    };
    let (can_go_back, can_go_forward) = native_history_state(app)?;
    let mut state = coordinator
        .state
        .lock()
        .map_err(|_| "builtin_browser_unavailable")?;
    let owner = state.owner.as_mut().ok_or("builtin_browser_not_open")?;
    if owner.session_id != session_id || owner.window_epoch != window_epoch {
        return Err("builtin_browser_stale_document");
    }
    let changed = owner.can_go_back != can_go_back || owner.can_go_forward != can_go_forward;
    if changed {
        owner.can_go_back = can_go_back;
        owner.can_go_forward = can_go_forward;
    }
    let result = browser_state(owner);
    if changed {
        state.revision += 1;
    }
    Ok(result)
}

fn native_history_state(app: &tauri::AppHandle) -> Result<(bool, bool), &'static str> {
    let page = app
        .get_webview(PAGE_LABEL)
        .ok_or("builtin_browser_not_open")?;
    let (sender, receiver) = mpsc::sync_channel(1);
    page.with_webview(move |platform| {
        let raw = platform.inner();
        if raw.is_null() {
            let _ = sender.send(None);
            return;
        }
        // SAFETY: Tauri documents PlatformWebview::inner as the live WKWebView
        // pointer on macOS, and this reference never escapes the callback.
        let webview = unsafe { &*raw.cast::<WKWebView>() };
        let state = unsafe { (webview.canGoBack(), webview.canGoForward()) };
        let _ = sender.send(Some(state));
    })
    .map_err(|_| "builtin_browser_unavailable")?;
    receiver
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "builtin_browser_unavailable")?
        .ok_or("builtin_browser_unavailable")
}

fn refresh_history(app: &tauri::AppHandle) {
    let Some(page) = app.get_webview(PAGE_LABEL) else {
        return;
    };
    let handle = app.clone();
    let _ = page.with_webview(move |platform| {
        let raw = platform.inner();
        if raw.is_null() {
            return;
        }
        // SAFETY: same scoped WKWebView contract as native_history_state.
        let webview = unsafe { &*raw.cast::<WKWebView>() };
        let history = unsafe { (webview.canGoBack(), webview.canGoForward()) };
        let coordinator = handle.state::<BrowserCoordinator>();
        if let Ok(mut state) = coordinator.state.lock() {
            if let Some(owner) = state.owner.as_mut() {
                if (owner.can_go_back, owner.can_go_forward) != history {
                    owner.can_go_back = history.0;
                    owner.can_go_forward = history.1;
                    state.revision += 1;
                }
            }
        }
        emit_state(&handle);
    });
}

#[derive(Clone, Copy)]
enum HistoryAction {
    Back,
    Forward,
}

fn native_history_action(
    app: &tauri::AppHandle,
    action: HistoryAction,
) -> Result<(), &'static str> {
    let page = app
        .get_webview(PAGE_LABEL)
        .ok_or("builtin_browser_not_open")?;
    let (sender, receiver) = mpsc::sync_channel(1);
    page.with_webview(move |platform| {
        let raw = platform.inner();
        if raw.is_null() {
            let _ = sender.send(false);
            return;
        }
        // SAFETY: the typed WKWebView is used only on Tauri's webview thread.
        let webview = unsafe { &*raw.cast::<WKWebView>() };
        unsafe {
            match action {
                HistoryAction::Back => {
                    let _ = webview.goBack();
                }
                HistoryAction::Forward => {
                    let _ = webview.goForward();
                }
            }
        }
        let _ = sender.send(true);
    })
    .map_err(|_| "builtin_browser_unavailable")?;
    receiver
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "builtin_browser_unavailable")?
        .then_some(())
        .ok_or("builtin_browser_unavailable")
}

fn emit_state(app: &tauri::AppHandle) {
    let Some(state) = app
        .state::<BrowserCoordinator>()
        .state
        .lock()
        .ok()
        .and_then(|state| state.owner.as_ref().map(browser_state))
    else {
        return;
    };
    let _ = app.emit_to(CONTROLS_LABEL, "builtin-browser-state", state);
}

fn profile_mode() -> &'static str {
    let major = std::process::Command::new("/usr/bin/sw_vers")
        .arg("-productVersion")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|version| version.trim().split('.').next()?.parse::<u32>().ok());
    if major.is_some_and(|major| major >= 14) {
        "persistent"
    } else {
        "ephemeral"
    }
}

pub(crate) fn permits_page_url(app: &tauri::AppHandle, url: &tauri::Url) -> bool {
    if !base_url_permitted(url) {
        return false;
    }
    if url.scheme() == "https" {
        return true;
    }
    !app.state::<crate::navigation::LoopbackOrigin>()
        .conflicts_with_server(url)
}

fn base_url_permitted(url: &tauri::Url) -> bool {
    if !url.username().is_empty() || url.password().is_some() || url.host_str().is_none() {
        return false;
    }
    url.scheme() == "https"
        || (url.scheme() == "http"
            && matches!(
                url.host_str(),
                Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
            ))
}

fn validated_url(app: &tauri::AppHandle, raw: &str) -> Result<tauri::Url, &'static str> {
    if raw.len() > 4096 {
        return Err("builtin_browser_invalid_url");
    }
    let url: tauri::Url = raw.parse().map_err(|_| "builtin_browser_invalid_url")?;
    permits_page_url(app, &url)
        .then_some(url)
        .ok_or("builtin_browser_invalid_url")
}

fn origin(raw: &str) -> Option<String> {
    let url: tauri::Url = raw.parse().ok()?;
    matches!(url.scheme(), "http" | "https").then(|| url.origin().ascii_serialization())
}

pub(crate) fn open(
    app: &tauri::AppHandle,
    session_id: &str,
    requested_url: Option<&str>,
) -> Result<BrowserState, &'static str> {
    if !safe_id(session_id) {
        return Err("builtin_browser_invalid_request");
    }
    let url = validated_url(app, requested_url.unwrap_or(DEFAULT_URL))?;
    let coordinator = app.state::<BrowserCoordinator>();
    let existing = {
        let mut state = coordinator
            .state
            .lock()
            .map_err(|_| "builtin_browser_unavailable")?;
        if state.fenced {
            return Err("builtin_browser_fenced");
        }
        if let Some(owner) = state.owner.as_ref() {
            if owner.session_id != session_id {
                return Err("builtin_browser_in_use");
            }
            true
        } else {
            let window_epoch = random_hex().map_err(|_| "builtin_browser_unavailable")?;
            let profile_mode = profile_mode();
            state.owner = Some(Owner {
                session_id: session_id.to_owned(),
                window_epoch: window_epoch.clone(),
                document_epoch: 0,
                url: url.to_string(),
                title: "Built-in Browser".into(),
                loading: true,
                can_go_back: false,
                can_go_forward: false,
                document_token: None,
                profile_mode,
            });
            state.revision += 1;
            false
        }
    };
    if existing {
        if let Some(window) = app.get_window(WINDOW_LABEL) {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        if requested_url.is_some()
            && app
                .get_webview(PAGE_LABEL)
                .is_some_and(|page| page.url().is_ok_and(|current| current != url))
        {
            app.get_webview(PAGE_LABEL)
                .ok_or("builtin_browser_not_open")?
                .navigate(url)
                .map_err(|_| "builtin_browser_unavailable")?;
        }
        return state_for(app, session_id);
    }
    if create_window(app, url).is_err() {
        if let Some(window) = app.get_window(WINDOW_LABEL) {
            let _ = window.destroy();
        } else {
            window_destroyed(app);
        }
        return Err("builtin_browser_unavailable");
    }
    state_for(app, session_id)
}

fn create_window(app: &tauri::AppHandle, url: tauri::Url) -> Result<(), String> {
    let app_for_build = app.clone();
    let (sender, receiver) = mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let result = (|| {
            let window = tauri::window::WindowBuilder::new(&app_for_build, WINDOW_LABEL)
                .title("Gajae Built-in Browser")
                .inner_size(1200.0, 800.0)
                .min_inner_size(640.0, 420.0)
                .visible(false)
                .build()?;
            let mut controls = tauri::webview::WebviewBuilder::new(
                CONTROLS_LABEL,
                tauri::WebviewUrl::App("builtin-browser.html".into()),
            );
            if profile_mode() == "persistent" {
                controls = controls.data_store_identifier(store_identifier(
                    &app_for_build,
                    StorePurpose::Controls,
                ));
            } else {
                controls = controls.incognito(true);
            }
            window.add_child(
                controls,
                tauri::LogicalPosition::new(0.0, 0.0),
                tauri::LogicalSize::new(1200.0, TOOLBAR_HEIGHT),
            )?;
            let handle = app_for_build.clone();
            let mut page =
                tauri::webview::WebviewBuilder::new(PAGE_LABEL, tauri::WebviewUrl::External(url))
                    .initialization_script(STRIP_TAURI_BRIDGE)
                    .on_page_load(move |_webview, payload| page_load(&handle, payload.event()))
                    .on_document_title_changed({
                        let handle = app_for_build.clone();
                        move |_webview, title| title_changed(&handle, title)
                    });
            if profile_mode() == "persistent" {
                page = page
                    .data_store_identifier(store_identifier(&app_for_build, StorePurpose::Page));
            } else {
                page = page.incognito(true);
            }
            window.add_child(
                page,
                tauri::LogicalPosition::new(0.0, TOOLBAR_HEIGHT),
                tauri::LogicalSize::new(1200.0, 800.0 - TOOLBAR_HEIGHT),
            )?;
            resize(&window);
            window.show()?;
            window.set_focus()?;
            Ok::<(), tauri::Error>(())
        })()
        .map_err(|error| error.to_string());
        let _ = sender.send(result);
    })
    .map_err(|error| error.to_string())?;
    receiver
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| "builtin browser creation timed out".to_owned())?
}

pub(crate) fn resize(window: &tauri::Window) {
    if window.label() != WINDOW_LABEL {
        return;
    }
    if let Some(controls) = window.get_webview(CONTROLS_LABEL) {
        let _ = controls.with_webview(|platform| {
            set_native_webview_frame(platform.inner(), true);
        });
    }
    if let Some(page) = window.get_webview(PAGE_LABEL) {
        let _ = page.with_webview(|platform| {
            set_native_webview_frame(platform.inner(), false);
        });
    }
}

fn content_frames(layout: NSRect, flipped: bool) -> (NSRect, NSRect) {
    let toolbar_height = TOOLBAR_HEIGHT.min(layout.size.height.max(0.0));
    let page_height = (layout.size.height - toolbar_height).max(0.0);
    let controls_y = if flipped {
        layout.origin.y
    } else {
        layout.origin.y + page_height
    };
    let page_y = if flipped {
        layout.origin.y + toolbar_height
    } else {
        layout.origin.y
    };
    (
        NSRect::new(
            NSPoint::new(layout.origin.x, controls_y),
            NSSize::new(layout.size.width, toolbar_height),
        ),
        NSRect::new(
            NSPoint::new(layout.origin.x, page_y),
            NSSize::new(layout.size.width, page_height),
        ),
    )
}

fn set_native_webview_frame(raw: *mut std::ffi::c_void, controls: bool) {
    if raw.is_null() {
        return;
    }
    // SAFETY: Tauri exposes the live child WKWebView pointer only within this
    // main-thread callback. Public AppKit conversion maps NSWindow's current
    // unobscured content layout into the actual parent view coordinates.
    unsafe {
        let webview = &*raw.cast::<WKWebView>();
        let Some(parent) = webview.superview() else {
            return;
        };
        let Some(window) = webview.window() else {
            return;
        };
        let layout = parent.convertRect_fromView(window.contentLayoutRect(), None);
        let (controls_frame, page_frame) = content_frames(layout, parent.isFlipped());
        webview.setFrame(if controls { controls_frame } else { page_frame });
    }
}

pub(crate) fn navigation_requested(app: &tauri::AppHandle, url: &tauri::Url) {
    let coordinator = app.state::<BrowserCoordinator>();
    let Ok(mut state) = coordinator.state.lock() else {
        return;
    };
    let Some(owner) = state.owner.as_mut() else {
        return;
    };
    advance_document(owner, url.to_string());
    state.revision += 1;
    drop(state);
    emit_state(app);
}

fn advance_document(owner: &mut Owner, next: String) {
    owner.document_epoch = owner.document_epoch.saturating_add(1);
    owner.document_token = None;
    owner.loading = true;
    owner.url = next;
}

fn page_load(app: &tauri::AppHandle, event: tauri::webview::PageLoadEvent) {
    let coordinator = app.state::<BrowserCoordinator>();
    if let Ok(mut state) = coordinator.state.lock() {
        if let Some(owner) = state.owner.as_mut() {
            if event == tauri::webview::PageLoadEvent::Started {
                owner.document_token = None;
            }
            owner.loading =
                event != tauri::webview::PageLoadEvent::Finished || owner.document_token.is_none();
            state.revision += 1;
        }
    }
    if event == tauri::webview::PageLoadEvent::Finished {
        install_document_identity(app);
        refresh_history(app);
    }
    emit_state(app);
}

fn install_document_identity(app: &tauri::AppHandle) {
    let Some(page) = app.get_webview(PAGE_LABEL) else {
        return;
    };
    let Some((window_epoch, document_epoch, token)) = app
        .state::<BrowserCoordinator>()
        .state
        .lock()
        .ok()
        .and_then(|state| {
            state.owner.as_ref().and_then(|owner| {
                random_hex()
                    .ok()
                    .map(|token| (owner.window_epoch.clone(), owner.document_epoch, token))
            })
        })
    else {
        return;
    };
    let handle = app.clone();
    let _ = page.with_webview(move |platform| {
        let raw = platform.inner();
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        if raw.is_null() {
            return;
        }
        let token_json = match serde_json::to_string(&token) {
            Ok(token) => token,
            Err(_) => return,
        };
        let script = format!(
            "(function(){{var current=globalThis.{DOCUMENT_TOKEN_PROPERTY};if(typeof current==='string'&&/^[a-f0-9]{{64}}$/.test(current))return current;Object.defineProperty(globalThis,'{DOCUMENT_TOKEN_PROPERTY}',{{value:{token_json},configurable:false,enumerable:false,writable:false}});return globalThis.{DOCUMENT_TOKEN_PROPERTY};}})()"
        );
        let callback_handle = handle.clone();
        let handler = block2::RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
            if !error.is_null() || value.is_null() {
                return;
            }
            // SAFETY: the installation script returns the actual isolated-world
            // token as an NSString, whether it created or reused the property.
            let actual = unsafe { (*value.cast::<NSString>()).to_string() };
            if actual.len() != 64 || !actual.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return;
            }
            let coordinator = callback_handle.state::<BrowserCoordinator>();
            if let Ok(mut state) = coordinator.state.lock() {
                if bind_document_identity(
                    &mut state,
                    &window_epoch,
                    document_epoch,
                    &actual,
                ) {
                    state.revision += 1;
                }
            }
            emit_state(&callback_handle);
        });
        // SAFETY: the callback runs on the WKWebView thread with a live typed
        // pointer. The named content world is isolated from page JavaScript.
        let native = unsafe { &*raw.cast::<WKWebView>() };
        let world = retained_content_world(mtm);
        unsafe {
            native.evaluateJavaScript_inFrame_inContentWorld_completionHandler(
                &NSString::from_str(&script),
                None,
                &world,
                Some(&handler),
            );
        }
    });
}

fn bind_document_identity(
    state: &mut Coordinator,
    window_epoch: &str,
    document_epoch: u64,
    actual_token: &str,
) -> bool {
    let Some(owner) = state.owner.as_mut() else {
        return false;
    };
    if owner.window_epoch != window_epoch || owner.document_epoch != document_epoch {
        return false;
    }
    if owner
        .document_token
        .as_deref()
        .is_some_and(|current| current != actual_token)
    {
        return false;
    }
    let changed = owner.document_token.as_deref() != Some(actual_token) || owner.loading;
    owner.document_token = Some(actual_token.to_owned());
    owner.loading = false;
    changed
}

fn title_changed(app: &tauri::AppHandle, title: String) {
    let coordinator = app.state::<BrowserCoordinator>();
    if let Ok(mut state) = coordinator.state.lock() {
        if let Some(owner) = state.owner.as_mut() {
            owner.title = title;
            state.revision += 1;
        }
    }
    emit_state(app);
}

pub(crate) fn window_destroyed(app: &tauri::AppHandle) {
    let coordinator = app.state::<BrowserCoordinator>();
    if let Ok(mut state) = coordinator.state.lock() {
        clear_destroyed_state(&mut state);
        coordinator.destroyed.notify_all();
    };
}

fn clear_destroyed_state(state: &mut Coordinator) {
    if state.owner.take().is_some() || !state.pending.is_empty() {
        state.pending.clear();
        state.revision += 1;
    }
}

fn close(app: &tauri::AppHandle, session_id: &str) -> Result<(), &'static str> {
    let Some(window_epoch) = request_window_destroy(app, session_id)? else {
        return Ok(());
    };
    let coordinator = app.state::<BrowserCoordinator>();
    let state = coordinator
        .state
        .lock()
        .map_err(|_| "builtin_browser_unavailable")?;
    let (state, _) = coordinator
        .destroyed
        .wait_timeout_while(state, Duration::from_secs(2), |state| {
            state
                .owner
                .as_ref()
                .is_some_and(|owner| owner.window_epoch == window_epoch)
        })
        .map_err(|_| "builtin_browser_unavailable")?;
    state
        .owner
        .as_ref()
        .is_none_or(|owner| owner.window_epoch != window_epoch)
        .then_some(())
        .ok_or("builtin_browser_close_unconfirmed")
}

fn request_window_destroy(
    app: &tauri::AppHandle,
    session_id: &str,
) -> Result<Option<String>, &'static str> {
    let coordinator = app.state::<BrowserCoordinator>();
    let window_epoch = {
        let state = coordinator
            .state
            .lock()
            .map_err(|_| "builtin_browser_unavailable")?;
        match state.owner.as_ref() {
            Some(owner) if owner.session_id == session_id => owner.window_epoch.clone(),
            Some(_) => return Err("builtin_browser_in_use"),
            None => return Ok(None),
        }
    };
    if let Some(window) = app.get_window(WINDOW_LABEL) {
        window
            .destroy()
            .map_err(|_| "builtin_browser_unavailable")?;
    } else {
        window_destroyed(app);
    }
    Ok(Some(window_epoch))
}

pub(crate) fn toolbar_control(
    app: &tauri::AppHandle,
    command: ToolbarCommand,
) -> Result<BrowserState, String> {
    let session_id = app
        .state::<BrowserCoordinator>()
        .state
        .lock()
        .map_err(|_| "builtin_browser_unavailable")?
        .owner
        .as_ref()
        .map(|owner| owner.session_id.clone())
        .ok_or("builtin_browser_not_open")?;
    match command {
        ToolbarCommand::State => {}
        ToolbarCommand::Navigate { url } => {
            ensure_unfenced(app)?;
            let url = validated_url(app, &url).map_err(str::to_owned)?;
            app.get_webview(PAGE_LABEL)
                .ok_or("builtin_browser_not_open")?
                .navigate(url)
                .map_err(|_| "builtin_browser_unavailable")?;
        }
        ToolbarCommand::Back => {
            ensure_unfenced(app)?;
            native_history_action(app, HistoryAction::Back).map_err(str::to_owned)?;
        }
        ToolbarCommand::Forward => {
            ensure_unfenced(app)?;
            native_history_action(app, HistoryAction::Forward).map_err(str::to_owned)?;
        }
        ToolbarCommand::Reload => {
            ensure_unfenced(app)?;
            app.get_webview(PAGE_LABEL)
                .ok_or("builtin_browser_not_open")?
                .reload()
                .map_err(|_| "builtin_browser_unavailable")?;
        }
        ToolbarCommand::Close => {
            request_window_destroy(app, &session_id).map_err(str::to_owned)?;
            return Ok(closed_state(&session_id));
        }
    }
    state_for(app, &session_id).map_err(str::to_owned)
}

fn ensure_unfenced(app: &tauri::AppHandle) -> Result<(), String> {
    let coordinator = app.state::<BrowserCoordinator>();
    let state = coordinator
        .state
        .lock()
        .map_err(|_| "builtin_browser_unavailable")?;
    (!state.fenced)
        .then_some(())
        .ok_or_else(|| "builtin_browser_fenced".to_owned())
}

fn verify_expected(
    app: &tauri::AppHandle,
    session_id: &str,
    expected: &ExpectedBinding,
) -> Result<(BrowserBinding, String, String), &'static str> {
    let coordinator = app.state::<BrowserCoordinator>();
    let state = coordinator
        .state
        .lock()
        .map_err(|_| "builtin_browser_unavailable")?;
    if state.fenced {
        return Err("builtin_browser_fenced");
    }
    let owner = state.owner.as_ref().ok_or("builtin_browser_not_open")?;
    let current = binding(owner);
    if owner.session_id != session_id
        || current.window_epoch != expected.window_epoch
        || current.document_epoch != expected.document_epoch
        || current.origin != expected.origin
    {
        return Err("builtin_browser_stale_document");
    }
    let token = owner
        .document_token
        .clone()
        .ok_or("builtin_browser_stale_document")?;
    Ok((current, owner.url.clone(), token))
}

fn command(
    app: &tauri::AppHandle,
    request_id: &str,
    session_id: &str,
    expected: &ExpectedBinding,
    command: BrowserCommand,
    timeout: Duration,
    cancelled: &AtomicBool,
) -> Result<serde_json::Value, &'static str> {
    if cancelled.load(Ordering::Acquire) {
        return Err("browser_cancelled");
    }
    verify_expected(app, session_id, expected)?;
    match command {
        BrowserCommand::Navigate { url } => {
            let url = validated_url(app, &url)?;
            app.get_webview(PAGE_LABEL)
                .ok_or("builtin_browser_not_open")?
                .navigate(url)
                .map_err(|_| "builtin_browser_unavailable")?;
            Ok(serde_json::json!({ "navigating": true }))
        }
        BrowserCommand::Back => {
            native_history_action(app, HistoryAction::Back)?;
            Ok(serde_json::json!({ "navigating": true }))
        }
        BrowserCommand::Forward => {
            native_history_action(app, HistoryAction::Forward)?;
            Ok(serde_json::json!({ "navigating": true }))
        }
        BrowserCommand::Reload => {
            app.get_webview(PAGE_LABEL)
                .ok_or("builtin_browser_not_open")?
                .reload()
                .map_err(|_| "builtin_browser_unavailable")?;
            Ok(serde_json::json!({ "reloading": true }))
        }
        BrowserCommand::Observe => evaluate(
            app,
            request_id,
            session_id,
            expected,
            OBSERVE_SCRIPT,
            timeout,
            cancelled,
        ),
        BrowserCommand::Extract { selector, format } => {
            if format
                .as_deref()
                .is_some_and(|value| value != "text" && value != "html")
            {
                return Err("builtin_browser_invalid_request");
            }
            if selector
                .as_ref()
                .is_some_and(|selector| selector.is_empty() || selector.len() > 4096)
            {
                return Err("builtin_browser_invalid_request");
            }
            let selector =
                serde_json::to_string(&selector).map_err(|_| "builtin_browser_invalid_request")?;
            let html = format.as_deref() == Some("html");
            evaluate(
                app,
                request_id,
                session_id,
                expected,
                &extract_script(&selector, html),
                timeout,
                cancelled,
            )
        }
        BrowserCommand::Click { selector } => {
            if selector.is_empty() || selector.len() > 4096 {
                return Err("builtin_browser_invalid_request");
            }
            let selector =
                serde_json::to_string(&selector).map_err(|_| "builtin_browser_invalid_request")?;
            evaluate(
                app,
                request_id,
                session_id,
                expected,
                &click_script(&selector),
                timeout,
                cancelled,
            )
        }
        BrowserCommand::Fill { selector, text } => {
            if selector.is_empty() || selector.len() > 4096 || text.len() > 64 * 1024 {
                return Err("builtin_browser_invalid_request");
            }
            let selector =
                serde_json::to_string(&selector).map_err(|_| "builtin_browser_invalid_request")?;
            let text =
                serde_json::to_string(&text).map_err(|_| "builtin_browser_invalid_request")?;
            evaluate(
                app,
                request_id,
                session_id,
                expected,
                &fill_script(&selector, &text),
                timeout,
                cancelled,
            )
        }
    }
}

fn evaluate(
    app: &tauri::AppHandle,
    request_id: &str,
    session_id: &str,
    expected: &ExpectedBinding,
    script: &str,
    timeout: Duration,
    cancelled: &AtomicBool,
) -> Result<serde_json::Value, &'static str> {
    let (current, expected_url, document_token) = verify_expected(app, session_id, expected)?;
    let webview = app
        .get_webview(PAGE_LABEL)
        .ok_or("builtin_browser_not_open")?;
    let coordinator = app.state::<BrowserCoordinator>();
    {
        let mut state = coordinator
            .state
            .lock()
            .map_err(|_| "builtin_browser_unavailable")?;
        state.pending.insert(request_id.to_owned(), false);
        state.revision += 1;
    }
    let (sender, receiver) = mpsc::sync_channel(1);
    let handle = app.clone();
    let request = request_id.to_owned();
    let session = session_id.to_owned();
    let expected_window = current.window_epoch;
    let expected_document = current.document_epoch;
    let expected_origin = current.origin;
    let guarded_script = guarded_script(script, &expected_url, &expected_origin, &document_token)?;
    let expected_for_dispatch = ExpectedBinding {
        window_epoch: expected_window.clone(),
        document_epoch: expected_document,
        origin: expected_origin.clone(),
    };
    let dispatched = webview.with_webview(move |platform| {
        // Recheck on the native webview thread immediately before enqueueing
        // evaluation. Navigation policy callbacks run on this same thread, so
        // a user navigation cannot interleave between this check and WebKit's
        // document-bound evaluateJavaScript call.
        if verify_expected(&handle, &session, &expected_for_dispatch).is_err() {
            finish_evaluation(&handle, &request);
            let _ = sender.send(Err("builtin_browser_stale_document"));
            return;
        }
        let raw_webview = platform.inner();
        if raw_webview.is_null() {
            finish_evaluation(&handle, &request);
            let _ = sender.send(Err("builtin_browser_unavailable"));
            return;
        }
        let callback_handle = handle.clone();
        let callback_request = request.clone();
        let callback_session = session.clone();
        let callback_window = expected_window.clone();
        let callback_origin = expected_origin.clone();
        let callback_sender = sender.clone();
        let handler = block2::RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
            let raw = if error.is_null() && !value.is_null() {
                // SAFETY: the guarded script always returns JSON.stringify,
                // so a successful Objective-C result is an NSString.
                unsafe { (*value.cast::<NSString>()).to_string() }
            } else {
                String::new()
            };
            let outcome = callback_outcome(
                &callback_handle,
                &callback_session,
                &callback_window,
                expected_document,
                callback_origin.as_deref(),
                raw,
            );
            finish_evaluation(&callback_handle, &callback_request);
            let _ = callback_sender.send(outcome);
        });
        // SAFETY: PlatformWebview::inner is the live WKWebView on macOS. The
        // typed reference and copied Objective-C block remain scoped to this
        // callback/evaluation.
        let native = unsafe { &*raw_webview.cast::<WKWebView>() };
        let Some(mtm) = MainThreadMarker::new() else {
            finish_evaluation(&handle, &request);
            let _ = sender.send(Err("builtin_browser_unavailable"));
            return;
        };
        let world = retained_content_world(mtm);
        unsafe {
            native.evaluateJavaScript_inFrame_inContentWorld_completionHandler(
                &NSString::from_str(&guarded_script),
                None,
                &world,
                Some(&handler),
            );
        }
    });
    if dispatched.is_err() {
        if let Ok(mut state) = coordinator.state.lock() {
            state.pending.remove(request_id);
            state.revision += 1;
        }
        return Err("builtin_browser_unavailable");
    }
    let deadline = Instant::now() + timeout;
    loop {
        if cancelled.load(Ordering::Acquire) {
            mark_pending_uncertain(&coordinator, request_id);
            return Err("browser_cancelled");
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            mark_pending_uncertain(&coordinator, request_id);
            return Err("builtin_browser_timeout");
        }
        match receiver.recv_timeout(remaining.min(Duration::from_millis(50))) {
            Ok(result) => return result,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                mark_pending_uncertain(&coordinator, request_id);
                return Err("builtin_browser_evaluation_failed");
            }
        }
    }
}

fn finish_evaluation(app: &tauri::AppHandle, request_id: &str) {
    if let Ok(mut state) = app.state::<BrowserCoordinator>().state.lock() {
        if state.pending.remove(request_id).is_some() {
            state.revision += 1;
        }
    }
}

fn mark_pending_uncertain(coordinator: &BrowserCoordinator, request_id: &str) {
    if let Ok(mut state) = coordinator.state.lock() {
        if let Some(uncertain) = state.pending.get_mut(request_id) {
            *uncertain = true;
            state.revision += 1;
        }
    }
}

fn callback_outcome(
    app: &tauri::AppHandle,
    session_id: &str,
    window_epoch: &str,
    document_epoch: u64,
    expected_origin: Option<&str>,
    raw: String,
) -> Result<serde_json::Value, &'static str> {
    let state = app.state::<BrowserCoordinator>();
    let state = state
        .state
        .lock()
        .map_err(|_| "builtin_browser_unavailable")?;
    let owner = state
        .owner
        .as_ref()
        .ok_or("builtin_browser_stale_document")?;
    if owner.session_id != session_id
        || owner.window_epoch != window_epoch
        || owner.document_epoch != document_epoch
        || origin(&owner.url).as_deref() != expected_origin
    {
        return Err("builtin_browser_stale_document");
    }
    if raw.len() > MAX_PREVIEW {
        return Err("builtin_browser_result_too_large");
    }
    let value: serde_json::Value =
        serde_json::from_str(&raw).map_err(|_| "builtin_browser_evaluation_failed")?;
    if value.get("ok") != Some(&serde_json::Value::Bool(true)) {
        let code = value
            .get("error")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("evaluation_failed");
        return Err(match code {
            "stale_document" => "builtin_browser_stale_document",
            "selector_not_found" => "builtin_browser_selector_not_found",
            "selector_not_unique" => "builtin_browser_selector_not_unique",
            "element_not_fillable" => "builtin_browser_element_not_fillable",
            _ => "builtin_browser_evaluation_failed",
        });
    }
    Ok(value
        .get("value")
        .cloned()
        .unwrap_or(serde_json::Value::Null))
}

pub(crate) fn fence(app: &tauri::AppHandle) -> Result<(), &'static str> {
    let coordinator = app.state::<BrowserCoordinator>();
    let mut state = coordinator
        .state
        .lock()
        .map_err(|_| "builtin_browser_unavailable")?;
    if !state.fenced {
        state.fenced = true;
        state.revision += 1;
    }
    Ok(())
}

pub(crate) fn release_fence(app: &tauri::AppHandle) {
    let coordinator = app.state::<BrowserCoordinator>();
    if let Ok(mut state) = coordinator.state.lock() {
        if state.fenced {
            state.fenced = false;
            state.revision += 1;
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_and_secrets_are_strict() {
        assert!(safe_id("session:a-1"));
        assert!(!safe_id(""));
        assert!(!safe_id("-bad"));
        assert!(!safe_id("bad/value"));
        assert!(equal_secret(&"a".repeat(64), &"a".repeat(64)));
        assert!(!equal_secret(&"a".repeat(64), &"b".repeat(64)));
    }

    #[test]
    fn browser_hmac_has_an_independent_wire_domain() {
        assert_eq!(
            proof(&"a".repeat(64), &"b".repeat(64), &"c".repeat(64)),
            "82bdd93c3dfdd860acaf99b2042583b493ee9dc4bda627bc1f10a4b2a8a2bb6f"
        );
    }

    #[test]
    fn qa_browser_stores_are_stable_isolated_and_distinct_from_production() {
        let first = std::path::Path::new("/private/tmp/browser-qa-a");
        let second = std::path::Path::new("/private/tmp/browser-qa-b");
        let first_page = store_identifier_for(Some(first), StorePurpose::Page);
        assert_eq!(
            first_page,
            store_identifier_for(Some(first), StorePurpose::Page)
        );
        assert_ne!(
            first_page,
            store_identifier_for(Some(second), StorePurpose::Page)
        );
        assert_ne!(first_page, store_identifier_for(None, StorePurpose::Page));
        assert_ne!(
            store_identifier_for(Some(first), StorePurpose::Controls),
            first_page
        );
    }

    #[test]
    fn activity_counts_windows_callbacks_and_uncertainty_exactly() {
        let mut state = Coordinator {
            epoch: "epoch".into(),
            revision: 7,
            ..Coordinator::default()
        };
        state.pending.insert("one".into(), false);
        state.pending.insert("two".into(), true);
        let activity = activity_value(&state);
        assert_eq!(activity["generation"], "epoch:7");
        assert_eq!(activity["running"], 2);
        assert_eq!(activity["retained"], 0);
        assert_eq!(activity["complete"], false);
        assert_eq!(
            activity["unknown"],
            serde_json::json!(["browser_callback_unconfirmed"])
        );
        assert_eq!(activity.as_object().unwrap().len(), 10);
    }

    #[test]
    fn confirmed_destroy_retires_old_owner_and_callbacks_before_reuse() {
        let mut state = Coordinator {
            owner: Some(Owner {
                session_id: "old".into(),
                window_epoch: "old-window".into(),
                document_epoch: 1,
                url: "https://example.com/".into(),
                title: String::new(),
                loading: false,
                can_go_back: false,
                can_go_forward: false,
                document_token: Some("old-token".into()),
                profile_mode: "persistent",
            }),
            ..Coordinator::default()
        };
        state.pending.insert("old-callback".into(), true);
        clear_destroyed_state(&mut state);
        assert!(state.owner.is_none());
        assert!(state.pending.is_empty());
        state.pending.insert("new-callback".into(), false);
        assert_eq!(state.pending.remove("old-callback"), None);
        assert!(state.pending.contains_key("new-callback"));
    }

    #[test]
    fn external_url_policy_rejects_credentials_schemes_and_nonlocal_cleartext() {
        let url = |raw: &str| raw.parse::<tauri::Url>().unwrap();
        assert!(base_url_permitted(&url("https://example.com/path")));
        assert!(base_url_permitted(&url("http://127.0.0.1:8080/")));
        assert!(base_url_permitted(&url("http://localhost:3000/")));
        assert!(base_url_permitted(&url("http://[::1]:9000/")));
        assert!(!base_url_permitted(&url("http://example.com/")));
        assert!(!base_url_permitted(&url(
            "https://user:secret@example.com/"
        )));
        assert!(!base_url_permitted(&url("file:///etc/passwd")));
        assert!(!base_url_permitted(&url("tauri://localhost/")));
    }

    #[test]
    fn only_the_local_controls_webview_has_a_browser_capability() {
        let capabilities = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
        let mut saw_controls = false;
        for entry in std::fs::read_dir(capabilities).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_none_or(|extension| extension != "json") {
                continue;
            }
            let value: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            let windows = value["windows"].as_array().cloned().unwrap_or_default();
            let webviews = value["webviews"].as_array().cloned().unwrap_or_default();
            assert!(!windows
                .iter()
                .any(|label| { label == WINDOW_LABEL || label == "*" || label == "builtin-*" }));
            assert!(!webviews
                .iter()
                .any(|label| { label == PAGE_LABEL || label == "*" || label == "builtin-*" }));
            let permissions = value["permissions"].as_array().cloned().unwrap_or_default();
            if permissions
                .iter()
                .any(|permission| permission == "allow-builtin-browser-control")
            {
                assert_eq!(value["identifier"], "builtin-browser-controls");
            }
            if value["identifier"] == "builtin-browser-controls" {
                saw_controls = true;
                assert!(windows.is_empty());
                assert_eq!(webviews, vec![serde_json::json!(CONTROLS_LABEL)]);
                assert_eq!(value["local"], true);
                assert!(value.get("remote").is_none());
                assert_eq!(
                    value["permissions"],
                    serde_json::json!([
                        "core:event:allow-listen",
                        "core:event:allow-unlisten",
                        "allow-builtin-browser-control"
                    ])
                );
            }
        }
        assert!(saw_controls);
    }

    #[test]
    fn closed_state_has_no_reusable_binding() {
        let state = closed_state("session");
        assert_eq!(state.active_tab_id, None);
        assert!(state.tabs.is_empty());
        assert_eq!(state.binding, None);
    }

    #[test]
    fn browser_state_is_single_tab_and_epoch_bound() {
        let owner = Owner {
            session_id: "session".into(),
            window_epoch: "window".into(),
            document_epoch: 3,
            url: "https://example.com/".into(),
            title: "Example".into(),
            loading: false,
            can_go_back: false,
            can_go_forward: false,
            document_token: Some("token".into()),
            profile_mode: "persistent",
        };
        let state = browser_state(&owner);
        assert_eq!(state.session_id, "session");
        assert_eq!(state.tabs.len(), 1);
        assert_eq!(state.binding.as_ref().unwrap().document_epoch, 3);
        assert_eq!(
            state.binding.as_ref().unwrap().origin.as_deref(),
            Some("https://example.com")
        );
    }

    #[test]
    fn finished_document_binds_actual_token_and_same_url_reload_retires_it() {
        let mut state = Coordinator {
            owner: Some(Owner {
                session_id: "session".into(),
                window_epoch: "window".into(),
                document_epoch: 4,
                url: "https://example.com/same".into(),
                title: String::new(),
                loading: true,
                can_go_back: false,
                can_go_forward: false,
                document_token: None,
                profile_mode: "persistent",
            }),
            ..Coordinator::default()
        };
        assert!(!bind_document_identity(
            &mut state,
            "window",
            3,
            &"a".repeat(64)
        ));
        assert!(bind_document_identity(
            &mut state,
            "window",
            4,
            &"a".repeat(64)
        ));
        assert!(!state.owner.as_ref().unwrap().loading);
        assert!(!bind_document_identity(
            &mut state,
            "window",
            4,
            &"a".repeat(64)
        ));
        advance_document(
            state.owner.as_mut().unwrap(),
            "https://example.com/same".into(),
        );
        assert_eq!(state.owner.as_ref().unwrap().document_epoch, 5);
        assert_eq!(state.owner.as_ref().unwrap().document_token, None);
        assert!(state.owner.as_ref().unwrap().loading);
        assert!(!bind_document_identity(
            &mut state,
            "window",
            4,
            &"a".repeat(64)
        ));
        assert!(bind_document_identity(
            &mut state,
            "window",
            5,
            &"b".repeat(64)
        ));
        assert_eq!(
            state.owner.as_ref().unwrap().document_token.as_deref(),
            Some("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
        );
    }

    #[test]
    fn native_content_frames_keep_toolbar_above_page_in_both_coordinate_systems() {
        let layout = NSRect::new(NSPoint::new(12.0, 28.0), NSSize::new(900.0, 700.0));
        let (controls, page) = content_frames(layout, false);
        assert_eq!(controls.origin.y, 672.0);
        assert_eq!(controls.size.height, 56.0);
        assert_eq!(page.origin.y, 28.0);
        assert_eq!(page.size.height, 644.0);
        assert_eq!(page.origin.y + page.size.height, controls.origin.y);

        let (controls, page) = content_frames(layout, true);
        assert_eq!(controls.origin.y, 28.0);
        assert_eq!(controls.size.height, 56.0);
        assert_eq!(page.origin.y, 84.0);
        assert_eq!(page.size.height, 644.0);
        assert_eq!(controls.origin.y + controls.size.height, page.origin.y);
    }

    #[test]
    fn stale_dispatch_and_large_dom_scripts_are_bounded_and_side_effect_safe() {
        let stale_click = guarded_script(
            &click_script("\"button\""),
            "https://approved.example/",
            &Some("https://approved.example".into()),
            "old-document",
        )
        .unwrap();
        let ambiguous_click = click_script("\"button\"");
        let ambiguous_fill = fill_script("\"input\"", "\"changed\"");
        let extract = extract_script("null", false);
        let fixture = format!(
            r#"
import {{ Window }} from 'happy-dom';
const window = new Window({{ url: 'https://example.com/' }});
Object.assign(globalThis, {{ document: window.document, location: window.location, CSS: window.CSS,
  HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement, Event: window.Event }});
let queried = 0;
const staleDocument = {{ querySelectorAll() {{ queried += 1; return []; }} }};
const liveDocument = globalThis.document;
globalThis.{token_property} = 'old-document';
globalThis.document = staleDocument;
Object.defineProperty(globalThis, 'location', {{ configurable: true, value: {{ href: 'https://changed.example/', origin: 'https://changed.example' }} }});
const stale = JSON.parse(eval({stale_click}));
if (stale.error !== 'stale_document' || queried !== 0) throw new Error('stale dispatch mutated the replacement page');
Object.defineProperty(globalThis, 'location', {{ configurable: true, value: {{ href: 'https://approved.example/', origin: 'https://approved.example' }} }});
globalThis.{token_property} = 'new-document';
const sameUrlReplacement = JSON.parse(eval({stale_click}));
if (sameUrlReplacement.error !== 'stale_document' || queried !== 0) throw new Error('same-URL replacement mutated the new document');
globalThis.document = liveDocument;
Object.defineProperty(globalThis, 'location', {{ configurable: true, value: window.location }});
document.body.textContent = '한'.repeat(20000) + '\"\\\\'.repeat(5000);
for (let i = 0; i < 250; i++) {{ const button = document.createElement('button'); button.textContent = '버튼 ' + i; document.body.append(button); }}
for (let i = 0; i < 2; i++) {{ const input = document.createElement('input'); input.value = 'original'; document.body.append(input); }}
const observed = eval({observe});
if (!observed.ok || !observed.value.truncated) throw new Error('large observation was not marked truncated');
if (Buffer.byteLength(JSON.stringify(observed.value), 'utf8') > 28672) throw new Error('observation exceeded its UTF-8 budget');
if (!observed.value.elements.length || observed.value.elements.some((item) => document.querySelectorAll(item.selector).length !== 1)) throw new Error('observation selectors are not unique');
let clicks = 0; for (const button of document.querySelectorAll('button')) button.addEventListener('click', () => clicks++);
const click = eval({ambiguous_click});
if (click.error !== 'selector_not_unique' || clicks !== 0) throw new Error('ambiguous click mutated a target');
const fill = eval({ambiguous_fill});
if (fill.error !== 'selector_not_unique' || Array.from(document.querySelectorAll('input')).some((input) => input.value !== 'original')) throw new Error('ambiguous fill mutated a target');
const extracted = eval({extract});
if (!extracted.ok || !extracted.value.truncated || Buffer.byteLength(JSON.stringify(extracted.value), 'utf8') > 30000) throw new Error('extract was not safely bounded');
"#,
            stale_click = serde_json::to_string(&stale_click).unwrap(),
            token_property = DOCUMENT_TOKEN_PROPERTY,
            observe = serde_json::to_string(OBSERVE_SCRIPT).unwrap(),
            ambiguous_click = serde_json::to_string(&ambiguous_click).unwrap(),
            ambiguous_fill = serde_json::to_string(&ambiguous_fill).unwrap(),
            extract = serde_json::to_string(&extract).unwrap(),
        );
        let output = std::process::Command::new("node")
            .args(["--input-type=module", "--eval", &fixture])
            .current_dir(
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .unwrap(),
            )
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "DOM fixture failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

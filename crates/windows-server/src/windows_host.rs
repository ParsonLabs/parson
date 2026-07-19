use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::{Mutex, OnceLock, mpsc};
use std::thread;

use tracing_subscriber::EnvFilter;
use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_ALREADY_EXISTS, GetLastError, HINSTANCE, HWND, LPARAM, LRESULT, POINT,
    WPARAM,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Threading::CreateMutexW;
use windows_sys::Win32::UI::Shell::{
    NIF_ICON, NIF_MESSAGE, NIF_SHOWTIP, NIF_TIP, NIM_ADD, NIM_DELETE, NOTIFYICONDATAW,
    Shell_NotifyIconW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CS_HREDRAW, CS_VREDRAW, CW_USEDEFAULT, CreatePopupMenu, CreateWindowExW,
    DefWindowProcW, DestroyMenu, DestroyWindow, DispatchMessageW, GetCursorPos, GetMessageW,
    IDI_APPLICATION, LoadIconW, MF_CHECKED, MF_DISABLED, MF_GRAYED, MF_SEPARATOR, MF_STRING, MSG,
    PostMessageW, PostQuitMessage, RegisterClassW, SetForegroundWindow, TPM_BOTTOMALIGN,
    TPM_LEFTALIGN, TPM_RETURNCMD, TrackPopupMenu, TranslateMessage, WM_APP, WM_COMMAND, WM_DESTROY,
    WM_LBUTTONUP, WM_RBUTTONUP, WNDCLASSW, WS_OVERLAPPED,
};
use winreg::RegKey;
use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};

const APP_NAME: &str = "Parson";
const RUN_VALUE_NAME: &str = "ParsonMusicServer";
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const WM_TRAY: u32 = WM_APP + 1;
const WM_SERVER_EVENT: u32 = WM_APP + 2;
const WM_UPDATE_EVENT: u32 = WM_APP + 3;
const TRAY_ID: u32 = 1;

const MENU_OPEN: usize = 1001;
const MENU_START: usize = 1002;
const MENU_STOP: usize = 1003;
const MENU_RESTART: usize = 1004;
const MENU_LOGS: usize = 1005;
const MENU_DATA: usize = 1006;
const MENU_AUTOSTART: usize = 1007;
const MENU_EXIT: usize = 1008;
const MENU_UPDATE: usize = 1009;

static WINDOW: AtomicIsize = AtomicIsize::new(0);
static COMMAND_TX: OnceLock<mpsc::Sender<ServerCommand>> = OnceLock::new();
static EVENT_RX: OnceLock<Mutex<mpsc::Receiver<ServerStatus>>> = OnceLock::new();
static UPDATE_RX: OnceLock<Mutex<mpsc::Receiver<UpdateEvent>>> = OnceLock::new();
static UPDATE_TX: OnceLock<mpsc::Sender<UpdateEvent>> = OnceLock::new();
static MODEL: OnceLock<Mutex<Model>> = OnceLock::new();

#[derive(Clone, Debug)]
enum ServerStatus {
    Starting,
    Running(u16),
    Stopping,
    Stopped,
    Failed(String),
}

#[derive(Clone, Debug)]
enum UpdateStatus {
    Idle,
    Checking,
    Downloading(String),
    Current,
    Failed,
}

#[derive(Debug)]
enum UpdateEvent {
    Checking,
    Downloading(String),
    Current,
    Ready { version: String, path: PathBuf },
    Failed(String),
}

#[derive(Debug)]
enum ServerCommand {
    Start,
    Stop,
    Restart,
    Exit,
    Exited(u64),
}

#[derive(Debug)]
struct Model {
    status: ServerStatus,
    update: UpdateStatus,
    open_when_ready: bool,
}

struct RunningServer {
    generation: u64,
    shutdown: tokio::sync::oneshot::Sender<()>,
    join: thread::JoinHandle<()>,
}

pub fn run(
    update_handshake: Option<PathBuf>,
    update_cleanup: Vec<PathBuf>,
) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = data_dir();
    std::fs::create_dir_all(data_dir.join("Logs"))?;
    configure_logging(&data_dir)?;

    let mutex_name = wide(&instance_mutex_name());
    let instance = unsafe { CreateMutexW(null(), 0, mutex_name.as_ptr()) };
    if instance.is_null() {
        return Err(std::io::Error::last_os_error().into());
    }
    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        open_url(default_url());
        unsafe { CloseHandle(instance) };
        return Ok(());
    }

    let background = std::env::args().any(|arg| arg == "--background");
    MODEL
        .set(Mutex::new(Model {
            status: ServerStatus::Stopped,
            update: UpdateStatus::Idle,
            open_when_ready: !background,
        }))
        .map_err(|_| "host model already initialized")?;

    let hwnd = create_window()?;
    WINDOW.store(hwnd as isize, Ordering::Release);
    add_tray_icon(hwnd)?;

    let (command_tx, command_rx) = mpsc::channel();
    let (event_tx, event_rx) = mpsc::channel();
    let (update_tx, update_rx) = mpsc::channel();
    COMMAND_TX
        .set(command_tx.clone())
        .map_err(|_| "server command channel already initialized")?;
    EVENT_RX
        .set(Mutex::new(event_rx))
        .map_err(|_| "server event channel already initialized")?;
    UPDATE_RX
        .set(Mutex::new(update_rx))
        .map_err(|_| "update event channel already initialized")?;
    UPDATE_TX
        .set(update_tx)
        .map_err(|_| "update sender already initialized")?;
    let worker = spawn_controller(command_rx, command_tx, event_tx);
    command("start");
    if let Some(handshake) = update_handshake {
        std::fs::write(&handshake, b"ready")?;
    }
    if !update_cleanup.is_empty() {
        crate::updater::schedule_cleanup(update_cleanup);
    }

    let mut message = unsafe { std::mem::zeroed::<MSG>() };
    while unsafe { GetMessageW(&mut message, null_mut(), 0, 0) } > 0 {
        unsafe {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }

    remove_tray_icon(hwnd);
    let _ = COMMAND_TX
        .get()
        .and_then(|tx| tx.send(ServerCommand::Exit).ok());
    let _ = worker.join();
    unsafe { CloseHandle(instance) };
    Ok(())
}

fn configure_logging(data_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let appender = tracing_appender::rolling::daily(data_dir.join("Logs"), "server.log");
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,lofty::flac::read=error")),
        )
        .with_ansi(false)
        .with_writer(appender)
        .try_init()
        .map_err(|error| std::io::Error::other(error.to_string()))?;
    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        "Parson for Windows host logging initialized"
    );
    Ok(())
}

fn spawn_controller(
    commands: mpsc::Receiver<ServerCommand>,
    command_tx: mpsc::Sender<ServerCommand>,
    events: mpsc::Sender<ServerStatus>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut running: Option<RunningServer> = None;
        let mut generation = 0_u64;
        while let Ok(command) = commands.recv() {
            match command {
                ServerCommand::Start if running.is_none() => {
                    generation += 1;
                    send_status(&events, ServerStatus::Starting);
                    running = Some(start_server(generation, command_tx.clone(), events.clone()));
                }
                ServerCommand::Stop => stop_server(&mut running, &events),
                ServerCommand::Restart => {
                    stop_server(&mut running, &events);
                    generation += 1;
                    send_status(&events, ServerStatus::Starting);
                    running = Some(start_server(generation, command_tx.clone(), events.clone()));
                }
                ServerCommand::Exited(exited_generation) => {
                    if running
                        .as_ref()
                        .is_some_and(|server| server.generation == exited_generation)
                        && let Some(server) = running.take()
                    {
                        let _ = server.join.join();
                    }
                }
                ServerCommand::Exit => {
                    stop_server(&mut running, &events);
                    break;
                }
                ServerCommand::Start => {}
            }
        }
    })
}

fn start_server(
    generation: u64,
    commands: mpsc::Sender<ServerCommand>,
    events: mpsc::Sender<ServerStatus>,
) -> RunningServer {
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
    let join = thread::spawn(move || {
        let runtime_events = events.clone();
        let result = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .map_err(std::io::Error::other)
            .and_then(|runtime| {
                let result = runtime.block_on(async move {
                    let (server, port) = parson_music::server::build_server_with_shutdown_timeout(
                        std::time::Duration::from_secs(5),
                    )
                    .await?;
                    let _advertisement = match parson_music::discovery::advertise(port) {
                        Ok(advertisement) => Some(advertisement),
                        Err(error) => {
                            if error == "the server is configured for this device only" {
                                tracing::info!(
                                    "local discovery is disabled for a loopback-only server"
                                );
                            } else {
                                tracing::warn!(%error, "local discovery is unavailable");
                            }
                            None
                        }
                    };
                    let handle = server.handle();
                    send_status(&runtime_events, ServerStatus::Running(port));
                    tokio::pin!(server);
                    tokio::select! {
                        result = &mut server => result,
                        _ = shutdown_rx => {
                            // Poll the server while graceful shutdown runs.
                            let graceful = tokio::spawn(handle.stop(true));
                            let result = server.await;
                            let _ = graceful.await;
                            result
                        }
                    }
                });
                parson_music::persistence::connection::mark_clean_shutdown();
                // Bound shutdown while blocking discovery work finishes.
                runtime.shutdown_timeout(std::time::Duration::from_secs(2));
                result
            });
        match result {
            Ok(()) => send_status(&events, ServerStatus::Stopped),
            Err(error) => {
                tracing::error!(%error, "Parson server stopped with an error");
                send_status(&events, ServerStatus::Failed(error.to_string()));
            }
        }
        let _ = commands.send(ServerCommand::Exited(generation));
    });
    RunningServer {
        generation,
        shutdown: shutdown_tx,
        join,
    }
}

fn stop_server(running: &mut Option<RunningServer>, events: &mpsc::Sender<ServerStatus>) {
    let Some(server) = running.take() else {
        return;
    };
    send_status(events, ServerStatus::Stopping);
    let _ = server.shutdown.send(());
    let _ = server.join.join();
}

fn send_status(events: &mpsc::Sender<ServerStatus>, status: ServerStatus) {
    let _ = events.send(status);
    let hwnd = WINDOW.load(Ordering::Acquire) as HWND;
    if !hwnd.is_null() {
        unsafe { PostMessageW(hwnd, WM_SERVER_EVENT, 0, 0) };
    }
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_SERVER_EVENT => {
            drain_server_events();
            0
        }
        WM_UPDATE_EVENT => {
            drain_update_events(hwnd);
            0
        }
        WM_TRAY if lparam as u32 == WM_LBUTTONUP => {
            open_current_url();
            0
        }
        WM_TRAY if lparam as u32 == WM_RBUTTONUP => {
            show_context_menu(hwnd);
            0
        }
        WM_COMMAND => {
            handle_menu_command(hwnd, wparam & 0xffff);
            0
        }
        WM_DESTROY => {
            unsafe { PostQuitMessage(0) };
            0
        }
        _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
    }
}

fn drain_server_events() {
    let Some(receiver) = EVENT_RX.get() else {
        return;
    };
    let Ok(receiver) = receiver.lock() else {
        return;
    };
    while let Ok(status) = receiver.try_recv() {
        tracing::info!(?status, "server host state changed");
        if let Some(model) = MODEL.get()
            && let Ok(mut model) = model.lock()
        {
            let should_open = matches!(status, ServerStatus::Running(_)) && model.open_when_ready;
            model.status = status;
            if should_open {
                model.open_when_ready = false;
                if let ServerStatus::Running(port) = model.status {
                    open_url(url_for_port(port));
                }
            }
        }
    }
    update_tooltip();
}

fn start_update_check() {
    let can_start = MODEL
        .get()
        .and_then(|model| model.lock().ok())
        .is_some_and(|model| {
            !matches!(
                model.update,
                UpdateStatus::Checking | UpdateStatus::Downloading(_)
            )
        });
    if !can_start {
        return;
    }
    let Some(events) = UPDATE_TX.get().cloned() else {
        return;
    };
    send_update_event(&events, UpdateEvent::Checking);
    thread::spawn(move || {
        let result = crate::updater::client().and_then(|client| {
            match crate::updater::check(&client, &crate::updater::manifest_url())? {
                crate::updater::UpdateCheck::Current => Ok(None),
                crate::updater::UpdateCheck::Available(manifest) => {
                    send_update_event(&events, UpdateEvent::Downloading(manifest.version.clone()));
                    let path =
                        crate::updater::download(&client, &manifest, &data_dir().join("Updates"))?;
                    Ok(Some((manifest.version, path)))
                }
            }
        });
        match result {
            Ok(None) => send_update_event(&events, UpdateEvent::Current),
            Ok(Some((version, path))) => {
                send_update_event(&events, UpdateEvent::Ready { version, path })
            }
            Err(error) => send_update_event(&events, UpdateEvent::Failed(error)),
        }
    });
}

fn send_update_event(events: &mpsc::Sender<UpdateEvent>, event: UpdateEvent) {
    let _ = events.send(event);
    let hwnd = WINDOW.load(Ordering::Acquire) as HWND;
    if !hwnd.is_null() {
        unsafe { PostMessageW(hwnd, WM_UPDATE_EVENT, 0, 0) };
    }
}

fn drain_update_events(hwnd: HWND) {
    let Some(receiver) = UPDATE_RX.get() else {
        return;
    };
    let Ok(receiver) = receiver.lock() else {
        return;
    };
    while let Ok(event) = receiver.try_recv() {
        tracing::info!(?event, "updater state changed");
        match event {
            UpdateEvent::Checking => set_update_status(UpdateStatus::Checking),
            UpdateEvent::Downloading(version) => {
                set_update_status(UpdateStatus::Downloading(version))
            }
            UpdateEvent::Current => {
                set_update_status(UpdateStatus::Current);
                show_information(
                    "Parson for Windows Updater",
                    &format!(
                        "Parson for Windows {} is already the latest version.",
                        crate::updater::CURRENT_VERSION
                    ),
                );
            }
            UpdateEvent::Failed(error) => {
                set_update_status(UpdateStatus::Failed);
                tracing::error!(%error, "update failed");
                show_message("Parson for Windows Updater", &error);
            }
            UpdateEvent::Ready { version, path } => {
                let target = std::env::current_exe();
                let result = target
                    .map_err(|error| format!("could not locate Parson for Windows: {error}"))
                    .and_then(|target| crate::updater::start_apply_helper(&path, &target));
                match result {
                    Ok(()) => {
                        tracing::info!(%version, "verified update is ready; stopping for install");
                        unsafe { DestroyWindow(hwnd) };
                    }
                    Err(error) => {
                        set_update_status(UpdateStatus::Failed);
                        show_message("Parson for Windows Updater", &error);
                    }
                }
            }
        }
    }
    update_tooltip();
}

fn set_update_status(status: UpdateStatus) {
    if let Some(model) = MODEL.get()
        && let Ok(mut model) = model.lock()
    {
        model.update = status;
    }
}

fn handle_menu_command(hwnd: HWND, command_id: usize) {
    match command_id {
        MENU_OPEN => open_current_url(),
        MENU_START => command("start"),
        MENU_STOP => command("stop"),
        MENU_RESTART => command("restart"),
        MENU_LOGS => open_path(data_dir().join("Logs")),
        MENU_DATA => open_path(data_dir()),
        MENU_AUTOSTART => {
            if let Err(error) = set_autostart(!autostart_enabled()) {
                tracing::error!(%error, "could not update start-with-Windows setting");
                show_message(
                    "Parson for Windows",
                    &format!("Could not update Start with Windows:\n{error}"),
                );
            }
        }
        MENU_UPDATE => start_update_check(),
        MENU_EXIT => unsafe {
            DestroyWindow(hwnd);
        },
        _ => {}
    }
}

fn command(name: &str) {
    let command = match name {
        "start" => ServerCommand::Start,
        "stop" => ServerCommand::Stop,
        "restart" => ServerCommand::Restart,
        _ => return,
    };
    if let Some(tx) = COMMAND_TX.get() {
        let _ = tx.send(command);
    }
}

fn create_window() -> Result<HWND, Box<dyn std::error::Error>> {
    let instance = unsafe { GetModuleHandleW(null()) };
    if instance.is_null() {
        return Err(std::io::Error::last_os_error().into());
    }
    let class_name = wide("ParsonServerTrayWindow");
    let mut icon = unsafe { LoadIconW(instance, integer_resource(1)) };
    if icon.is_null() {
        icon = unsafe { LoadIconW(null_mut(), IDI_APPLICATION) };
    }
    let class = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(window_proc),
        hInstance: instance as HINSTANCE,
        hIcon: icon,
        lpszClassName: class_name.as_ptr(),
        ..unsafe { std::mem::zeroed() }
    };
    if unsafe { RegisterClassW(&class) } == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let title = wide(APP_NAME);
    let hwnd = unsafe {
        CreateWindowExW(
            0,
            class_name.as_ptr(),
            title.as_ptr(),
            WS_OVERLAPPED,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            0,
            0,
            null_mut(),
            null_mut(),
            instance,
            null_mut::<c_void>(),
        )
    };
    if hwnd.is_null() {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(hwnd)
}

fn add_tray_icon(hwnd: HWND) -> Result<(), Box<dyn std::error::Error>> {
    let mut data = tray_data(hwnd);
    data.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP | NIF_SHOWTIP;
    data.uCallbackMessage = WM_TRAY;
    let instance = unsafe { GetModuleHandleW(null()) };
    data.hIcon = unsafe { LoadIconW(instance, integer_resource(1)) };
    if data.hIcon.is_null() {
        data.hIcon = unsafe { LoadIconW(null_mut(), IDI_APPLICATION) };
    }
    copy_wide(&mut data.szTip, APP_NAME);
    if unsafe { Shell_NotifyIconW(NIM_ADD, &data) } == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

fn remove_tray_icon(hwnd: HWND) {
    let data = tray_data(hwnd);
    unsafe { Shell_NotifyIconW(NIM_DELETE, &data) };
}

fn update_tooltip() {
    let hwnd = WINDOW.load(Ordering::Acquire) as HWND;
    if hwnd.is_null() {
        return;
    }
    let mut data = tray_data(hwnd);
    data.uFlags = NIF_TIP | NIF_SHOWTIP;
    copy_wide(&mut data.szTip, APP_NAME);
    unsafe { Shell_NotifyIconW(windows_sys::Win32::UI::Shell::NIM_MODIFY, &data) };
}

fn tray_data(hwnd: HWND) -> NOTIFYICONDATAW {
    NOTIFYICONDATAW {
        cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
        hWnd: hwnd,
        uID: TRAY_ID,
        ..unsafe { std::mem::zeroed() }
    }
}

fn show_context_menu(hwnd: HWND) {
    let status = MODEL
        .get()
        .and_then(|model| model.lock().ok())
        .map(|model| model.status.clone())
        .unwrap_or(ServerStatus::Stopped);
    let running = matches!(status, ServerStatus::Running(_));
    let transitioning = matches!(status, ServerStatus::Starting | ServerStatus::Stopping);
    let menu = unsafe { CreatePopupMenu() };
    if menu.is_null() {
        return;
    }
    append_menu(
        menu,
        MF_STRING | MF_DISABLED | MF_GRAYED,
        0,
        &status_label(&status),
    );
    unsafe { AppendMenuW(menu, MF_SEPARATOR, 0, null()) };
    append_menu(menu, item_flags(!running), MENU_OPEN, "Open Parson");
    append_menu(
        menu,
        item_flags(!running && !transitioning),
        MENU_START,
        "Start server",
    );
    append_menu(
        menu,
        item_flags(running && !transitioning),
        MENU_STOP,
        "Stop server",
    );
    append_menu(
        menu,
        item_flags(running && !transitioning),
        MENU_RESTART,
        "Restart server",
    );
    unsafe { AppendMenuW(menu, MF_SEPARATOR, 0, null()) };
    append_menu(menu, MF_STRING, MENU_DATA, "Open data folder");
    append_menu(menu, MF_STRING, MENU_LOGS, "Open logs");
    let autostart_flags = if autostart_enabled() {
        MF_STRING | MF_CHECKED
    } else {
        MF_STRING
    };
    append_menu(menu, autostart_flags, MENU_AUTOSTART, "Start with Windows");
    let (update_enabled, update_label) = MODEL
        .get()
        .and_then(|model| model.lock().ok())
        .map(|model| match &model.update {
            UpdateStatus::Checking => (false, "Checking for updates…".to_string()),
            UpdateStatus::Downloading(version) => (false, format!("Downloading update {version}…")),
            UpdateStatus::Current => (true, "Check and install updates (up to date)".to_string()),
            UpdateStatus::Failed => (true, "Retry update check".to_string()),
            UpdateStatus::Idle => (true, "Check and install updates".to_string()),
        })
        .unwrap_or((true, "Check and install updates".to_string()));
    append_menu(menu, item_flags(update_enabled), MENU_UPDATE, &update_label);
    unsafe { AppendMenuW(menu, MF_SEPARATOR, 0, null()) };
    append_menu(menu, MF_STRING, MENU_EXIT, "Exit");

    let mut point = POINT { x: 0, y: 0 };
    unsafe {
        GetCursorPos(&mut point);
        SetForegroundWindow(hwnd);
        let selected = TrackPopupMenu(
            menu,
            TPM_LEFTALIGN | TPM_BOTTOMALIGN | TPM_RETURNCMD,
            point.x,
            point.y,
            0,
            hwnd,
            null(),
        );
        if selected != 0 {
            PostMessageW(hwnd, WM_COMMAND, selected as usize, 0);
        }
        DestroyMenu(menu);
    }
}

fn append_menu(menu: *mut c_void, flags: u32, id: usize, label: &str) {
    let label = wide(label);
    unsafe { AppendMenuW(menu, flags, id, label.as_ptr()) };
}

fn item_flags(enabled: bool) -> u32 {
    if enabled {
        MF_STRING
    } else {
        MF_STRING | MF_DISABLED | MF_GRAYED
    }
}

fn status_label(status: &ServerStatus) -> String {
    match status {
        ServerStatus::Starting => "Parson — Starting…".to_string(),
        ServerStatus::Running(_) => APP_NAME.to_string(),
        ServerStatus::Stopping => "Parson — Stopping…".to_string(),
        ServerStatus::Stopped => "Parson — Stopped".to_string(),
        ServerStatus::Failed(error) => format!("Parson — Error: {error}"),
    }
}

fn open_current_url() {
    let url = MODEL
        .get()
        .and_then(|model| model.lock().ok())
        .and_then(|model| match model.status {
            ServerStatus::Running(port) => Some(url_for_port(port)),
            _ => None,
        })
        .unwrap_or_else(default_url);
    open_url(url);
}

fn open_url(url: String) {
    let _ = std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn();
}

fn open_path(path: PathBuf) {
    if let Err(error) = std::fs::create_dir_all(&path) {
        show_message(
            "Parson for Windows",
            &format!("Could not open folder:\n{error}"),
        );
        return;
    }
    let _ = std::process::Command::new("explorer.exe").arg(path).spawn();
}

fn default_url() -> String {
    let port = std::env::var("PARSON_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(1993);
    url_for_port(port)
}

fn url_for_port(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

fn data_dir() -> PathBuf {
    std::env::var_os("PARSON_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs::data_local_dir().map(|path| path.join("Parson")))
        .unwrap_or_else(|| PathBuf::from("Parson"))
}

fn instance_mutex_name() -> String {
    let identifier = std::env::var("PARSON_HOST_INSTANCE_ID")
        .ok()
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 64
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        });
    match identifier {
        Some(identifier) => format!("Local\\ParsonMusicServer.TrayHost.{identifier}"),
        None => "Local\\ParsonMusicServer.TrayHost".to_string(),
    }
}

fn autostart_enabled() -> bool {
    let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(RUN_KEY, KEY_READ)
    else {
        return false;
    };
    key.get_value::<String, _>(RUN_VALUE_NAME)
        .ok()
        .is_some_and(|value| value == autostart_command())
}

fn set_autostart(enabled: bool) -> std::io::Result<()> {
    let root = RegKey::predef(HKEY_CURRENT_USER);
    if enabled {
        let (key, _) = root.create_subkey(RUN_KEY)?;
        key.set_value(RUN_VALUE_NAME, &autostart_command())
    } else if let Ok(key) = root.open_subkey_with_flags(RUN_KEY, KEY_WRITE) {
        match key.delete_value(RUN_VALUE_NAME) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    } else {
        Ok(())
    }
}

fn autostart_command() -> String {
    let executable =
        std::env::current_exe().unwrap_or_else(|_| PathBuf::from("ParsonMusicServer.exe"));
    format!("\"{}\" --background", executable.display())
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

// Win32 encodes integer resource identifiers in pointer-shaped values.
#[allow(clippy::manual_dangling_ptr)]
fn integer_resource(identifier: u16) -> *const u16 {
    identifier as usize as *const u16
}

fn copy_wide<const N: usize>(target: &mut [u16; N], value: &str) {
    let value = wide(value);
    let length = value.len().min(N);
    target[..length].copy_from_slice(&value[..length]);
    target[N - 1] = 0;
}

fn show_message(title: &str, message: &str) {
    show_message_with_icon(
        title,
        message,
        windows_sys::Win32::UI::WindowsAndMessaging::MB_ICONERROR,
    );
}

fn show_information(title: &str, message: &str) {
    show_message_with_icon(
        title,
        message,
        windows_sys::Win32::UI::WindowsAndMessaging::MB_ICONINFORMATION,
    );
}

fn show_message_with_icon(title: &str, message: &str, icon: u32) {
    let title = wide(title);
    let message = wide(message);
    unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::MessageBoxW(
            null_mut(),
            message.as_ptr(),
            title.as_ptr(),
            windows_sys::Win32::UI::WindowsAndMessaging::MB_OK | icon,
        );
    }
}

pub fn show_fatal_error(message: &str) {
    show_message(APP_NAME, message);
}

#[cfg(test)]
mod tests {
    use super::{autostart_command, instance_mutex_name, url_for_port};

    #[test]
    fn loopback_url_uses_the_bound_port() {
        assert_eq!(url_for_port(1993), "http://127.0.0.1:1993");
    }

    #[test]
    fn autostart_command_is_quoted_and_backgrounded() {
        let command = autostart_command();
        assert!(command.starts_with('"'));
        assert!(command.ends_with("\" --background"));
    }

    #[test]
    fn default_instance_mutex_is_stable() {
        // Rust 2024 forbids safe process-environment mutation in these tests.
        if std::env::var_os("PARSON_HOST_INSTANCE_ID").is_none() {
            assert_eq!(instance_mutex_name(), "Local\\ParsonMusicServer.TrayHost");
        }
    }
}

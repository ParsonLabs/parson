#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

#[cfg(windows)]
mod windows_host;

#[cfg(windows)]
mod updater;

#[cfg(windows)]
fn main() {
    if let Err(error) = run_windows() {
        windows_host::show_fatal_error(&error.to_string());
        std::process::exit(1);
    }
}

#[cfg(windows)]
fn run_windows() -> Result<(), Box<dyn std::error::Error>> {
    let startup = updater::startup_arguments().map_err(std::io::Error::other)?;
    if let Some((target, parent_pid)) = startup.apply {
        return updater::apply_update(&target, parent_pid)
            .map_err(std::io::Error::other)
            .map_err(Into::into);
    }
    windows_host::run(startup.handshake, startup.cleanup)
}

#[cfg(not(windows))]
fn main() {
    eprintln!("The Parson for Windows tray host is available on Windows only.");
}

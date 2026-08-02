mod builtin_runtime;
mod builtins;
mod execution;
mod models;

use builtin_runtime::BuiltinRegistry;
use execution::ProcessRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ProcessRegistry::default())
        .manage(BuiltinRegistry::default())
        .invoke_handler(tauri::generate_handler![
            execution::detect_runtimes,
            execution::run_tool,
            execution::cancel_tool,
            builtin_runtime::run_builtin_tool,
            builtin_runtime::cancel_builtin,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tools Deck");
}

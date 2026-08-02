mod execution;
mod models;

use execution::ProcessRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ProcessRegistry::default())
        .invoke_handler(tauri::generate_handler![
            execution::detect_runtimes,
            execution::run_tool,
            execution::cancel_tool,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tools Deck");
}

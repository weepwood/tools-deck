use std::{
    fs,
    path::{Path, PathBuf},
    process::Stdio,
};

use tokio::process::Command;

const MAX_REPORT_BYTES: u64 = 5 * 1024 * 1024;
const READABLE_EXTENSIONS: &[&str] = &["csv", "md", "txt", "json", "log"];

#[tauri::command]
pub async fn open_artifact_path(path: String) -> Result<(), String> {
    let path = canonical_existing_path(&path)?;
    let mut command = open_command(&path)?;
    run_detached(&mut command, "打开产物").await
}

#[tauri::command]
pub async fn reveal_artifact_path(path: String) -> Result<(), String> {
    let path = canonical_existing_path(&path)?;
    let mut command = reveal_command(&path)?;
    run_detached(&mut command, "定位产物").await
}

#[tauri::command]
pub async fn read_artifact_text(path: String) -> Result<String, String> {
    let path = canonical_existing_path(&path)?;
    if !path.is_file() {
        return Err("只能读取文件类型的产物。".to_string());
    }

    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !READABLE_EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!("不支持读取 .{extension} 产物。"));
    }

    let metadata = fs::metadata(&path)
        .map_err(|error| format!("读取产物信息失败：{error}"))?;
    if metadata.len() > MAX_REPORT_BYTES {
        return Err("报告文件超过 5 MB，请使用系统应用打开。".to_string());
    }

    fs::read_to_string(&path).map_err(|error| format!("读取产物内容失败：{error}"))
}

fn canonical_existing_path(value: &str) -> Result<PathBuf, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("产物路径不能为空。".to_string());
    }

    let path = PathBuf::from(value);
    if !path.exists() {
        return Err(format!("产物不存在：{}", path.display()));
    }

    path.canonicalize()
        .map_err(|error| format!("解析产物路径失败：{error}"))
}

fn open_command(path: &Path) -> Result<Command, String> {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("cmd.exe");
        command.args(["/D", "/S", "/C", "start", ""]);
        command.arg(path);
        return Ok(command);
    }

    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("open");
        command.arg(path);
        return Ok(command);
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        return Ok(command);
    }

    #[allow(unreachable_code)]
    Err("当前平台不支持打开产物。".to_string())
}

fn reveal_command(path: &Path) -> Result<Command, String> {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("explorer.exe");
        if path.is_file() {
            command.arg("/select,").arg(path);
        } else {
            command.arg(path);
        }
        return Ok(command);
    }

    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("open");
        if path.is_file() {
            command.arg("-R").arg(path);
        } else {
            command.arg(path);
        }
        return Ok(command);
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let target = if path.is_file() {
            path.parent().unwrap_or(path)
        } else {
            path
        };
        let mut command = Command::new("xdg-open");
        command.arg(target);
        return Ok(command);
    }

    #[allow(unreachable_code)]
    Err("当前平台不支持定位产物。".to_string())
}

async fn run_detached(command: &mut Command, action: &str) -> Result<(), String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
        .spawn()
        .map_err(|error| format!("{action}失败：{error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readable_extension_list_is_restricted() {
        assert!(READABLE_EXTENSIONS.contains(&"csv"));
        assert!(!READABLE_EXTENSIONS.contains(&"exe"));
    }

    #[test]
    fn empty_path_is_rejected() {
        assert!(canonical_existing_path("   ").is_err());
    }
}

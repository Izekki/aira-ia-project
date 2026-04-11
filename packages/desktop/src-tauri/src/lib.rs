/// Aira desktop application entry point.
///
/// Reads the optional `AIRA_BACKEND_URL` environment variable so users can
/// point the desktop app at a backend running on a non-default address.
/// The value is injected into the webview as `window.__AIRA_BACKEND_URL__`
/// before any page script executes, giving the React client a chance to use
/// it when resolving the Socket.IO server URL.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let backend_url = std::env::var("AIRA_BACKEND_URL")
        .unwrap_or_else(|_| String::from("http://127.0.0.1:4000"));

    // Strip characters that could break the JS string literal.
    let safe_url: String = backend_url
        .chars()
        .filter(|&c| c != '\'' && c != '"' && c != '\n' && c != '\r' && c != '\\')
        .collect();

    let init_script = format!("window.__AIRA_BACKEND_URL__ = '{}';", safe_url);

    tauri::Builder::default()
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::default(),
            )
            .title("Aira")
            .inner_size(900.0, 700.0)
            .resizable(true)
            .initialization_script(&init_script)
            .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

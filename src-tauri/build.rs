use std::{env, fs, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=../package.json");

    let package_json =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("missing manifest directory"))
            .join("../package.json");
    let package = fs::read_to_string(&package_json)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", package_json.display()));
    let desktop_version = json_string_field(&package, "desktopVersion").unwrap_or_else(|| {
        panic!(
            "{} must contain a desktopVersion string",
            package_json.display()
        )
    });

    assert_eq!(
        desktop_version,
        env::var("CARGO_PKG_VERSION").expect("missing Cargo package version"),
        "src-tauri/Cargo.toml package.version must match package.json desktopVersion"
    );

    tauri_build::build()
}

fn json_string_field<'a>(json: &'a str, key: &str) -> Option<&'a str> {
    let key = format!("\"{key}\"");
    let (_, value) = json.split_once(&key)?;
    let value = value.trim_start().strip_prefix(':')?.trim_start();
    let value = value.strip_prefix('"')?;
    let end = value.find('"')?;
    Some(&value[..end])
}

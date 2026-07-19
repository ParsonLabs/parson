fn main() {
    println!("cargo:rerun-if-changed=app.rc");
    println!("cargo:rerun-if-changed=parson.ico");
    if std::env::var("TARGET").is_ok_and(|target| target.contains("windows")) {
        embed_resource::compile("app.rc", embed_resource::NONE)
            .manifest_required()
            .expect("compile Parson for Windows resources");
    }
}

# WinGet submission

The committed files are templates because WinGet requires the SHA-256 of an
already-published immutable installer and Parson has no GitHub release yet.

After publishing the signed `v1.0.0` installer, run on Linux/macOS/WSL:

```bash
./distribution/winget/generate.sh 1.0.0
```

An optional second argument overrides the installer URL and an optional third
argument sets the UTC release date (`YYYY-MM-DD`); otherwise the script uses the
standard GitHub asset URL and today's UTC date.

This downloads the release installer, computes its SHA-256, and writes the three
ready-to-copy manifests under:

```text
distribution/winget/generated/manifests/p/ParsonLabs/Parson/1.0.0/
```

On Windows, validate and test the generated directory:

```powershell
winget validate .\distribution\winget\generated\manifests\p\ParsonLabs\Parson\1.0.0
# In a winget-pkgs checkout:
powershell .\Tools\SandboxTest.ps1 <path-to-the-generated-version-directory>
```

Then copy that `p/ParsonLabs/Parson/1.0.0` tree into a fork of
`microsoft/winget-pkgs`, commit it, and open one PR. Reviewers require publicly
downloadable installers and will run installation tests.

The manifest declares the NSIS silent switch `/S`, per-user scope, and an
Apps & Features display version of `1.0.0`. Confirm these values against a clean
Windows install before submitting.

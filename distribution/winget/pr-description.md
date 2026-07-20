# WinGet PR

Suggested title:

```text
New package: ParsonLabs.Parson version 1.0.0
```

Suggested body:

```text
Adds the first stable Parson release. The manifest points to the immutable,
offline x64 NSIS installer published by the upstream project. Silent install
uses /S and was tested in Windows Sandbox before submission.
```

Do not open the PR until `winget validate` and the repository's
`Tools/SandboxTest.ps1` both pass against the generated manifest directory.

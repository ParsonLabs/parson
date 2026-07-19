# Security policy

## Supported versions

Security fixes are provided for the latest 1.0.x release.

## Deployment boundary

Plain HTTP and automatic discovery are intended for trusted local networks.
Use an HTTPS reverse proxy and set `PARSON_PUBLIC_URL` for internet access. A
remote first-account registration requires the setup code printed by the server;
localhost setup does not. Keep the `/Parson` data directory and server logs
private because they contain authentication material and the temporary setup
code.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories for this repository. Do not open a public issue with exploit details. Include affected versions, reproduction steps, impact, and any proposed mitigation. You should receive an acknowledgement within seven days.

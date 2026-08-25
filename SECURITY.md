# Security Policy

## Supported baseline

The current supported baseline is the checked-in runtime snapshot identified by
`tools/build-manifest.json`. It is designed for a compatible DSH installation;
it is not a standalone web service.

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could expose credentials,
research artifacts, local files, or remote code execution. Use GitHub's private
security advisory flow for this repository, or contact the maintainer through
the contact information on the GitHub profile. Include a minimal reproduction,
affected files or generation, impact, and any mitigations already tested.

## Operational boundaries

- Keep `LINEAR_API_KEY`, provider credentials, and local credential stores out
  of the repository. The Linear integration is optional.
- Treat web pages, PDFs, Linear content, and model output as untrusted input.
  The fetch provider limits protocol, URL length, response size, retries, and
  same-origin redirects; these controls do not make arbitrary remote content
  safe.
- `.research-agent/` can contain briefs, source excerpts, model transcripts,
  issue metadata, and generated research artifacts. It is intentionally ignored.
- Run external-research and Linear workflows only in environments where sending
  the relevant data to external services is authorized.
- Review model-provider and source-material terms before processing or
  redistributing research content.

# Trakt MCP

Servidor MCP que conecta Claude con la cuenta de Trakt.tv de Diego Medina.
Permite que Claude consulte historial, puntajes y watchlist para hacer
recomendaciones personalizadas sin repetir lo ya visto.

## Variantes

| Archivo | Uso |
|---|---|
| `server-stdio.js` | Local (Claude Code en la PC) — registrado en `~/.claude.json` |
| `server-remote.js` | Remoto (Render) — para Claude en iPhone, web y pestana Chat |

## Variables de entorno (server-remote.js)

- `TRAKT_CLIENT_ID` — Client ID de la app en trakt.tv/oauth/applications
- `TRAKT_CLIENT_SECRET` — Client Secret
- `TRAKT_TOKEN_JSON` — contenido del archivo `.trakt-mcp-token.json` (token OAuth)
- `MCP_SECRET` — clave secreta que protege el endpoint

## Endpoints

- `https://<host>/<MCP_SECRET>/mcp` — Streamable HTTP (usar este en Claude)
- `https://<host>/<MCP_SECRET>/sse` — SSE legacy
- `https://<host>/health` — health check

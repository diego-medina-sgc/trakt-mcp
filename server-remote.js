// Trakt MCP — servidor remoto (Render / cualquier host Node)
// Variables de entorno requeridas:
//   TRAKT_CLIENT_ID, TRAKT_CLIENT_SECRET  — credenciales de la app de Trakt
//   TRAKT_TOKEN_JSON                      — JSON del token OAuth (contenido de .trakt-mcp-token.json)
//   MCP_SECRET                            — clave secreta que protege el endpoint
//   PORT                                  — la asigna el host automaticamente

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import http from 'http';

const CLIENT_ID     = process.env.TRAKT_CLIENT_ID;
const CLIENT_SECRET = process.env.TRAKT_CLIENT_SECRET;
const MCP_SECRET    = process.env.MCP_SECRET;
const PORT          = process.env.PORT || 4237;
const BASE_URL      = 'https://api.trakt.tv';
const UA            = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) trakt-mcp/1.0';

if (!CLIENT_ID || !CLIENT_SECRET || !MCP_SECRET) {
  console.error('Faltan variables de entorno: TRAKT_CLIENT_ID, TRAKT_CLIENT_SECRET, MCP_SECRET');
  process.exit(1);
}

// ── Token en memoria (seed desde env, refresh automatico) ─────────────────────

let token = null;
try { token = JSON.parse(process.env.TRAKT_TOKEN_JSON || 'null'); }
catch { token = null; }

async function refreshIfNeeded() {
  if (!token) throw new Error('Sin token. Configurar TRAKT_TOKEN_JSON en las variables de entorno.');
  const expiresAt = (token.created_at + token.expires_in) * 1000;
  if (Date.now() < expiresAt - 7 * 24 * 3600 * 1000) return token;
  const res = await fetch(`${BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({
      refresh_token: token.refresh_token,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  if (res.ok) token = await res.json();
  return token;
}

// ── API helper ────────────────────────────────────────────────────────────────

async function traktGet(endpoint) {
  const t = await refreshIfNeeded();
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      'trakt-api-version': '2',
      'trakt-api-key': CLIENT_ID,
      'Authorization': `Bearer ${t.access_token}`,
    },
  });
  if (!res.ok) throw new Error(`Trakt API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtMovie(m, extra = {}) {
  return {
    title: m.title, year: m.year,
    ...(m.genres   ? { genres: m.genres }                   : {}),
    ...(m.overview ? { overview: m.overview.slice(0, 250) } : {}),
    ...(m.runtime  ? { runtime_min: m.runtime }             : {}),
    ...(m.rating   ? { trakt_score: m.rating }              : {}),
    ids: { imdb: m.ids?.imdb, trakt: m.ids?.trakt },
    ...extra,
  };
}

function fmtShow(s, extra = {}) {
  return {
    title: s.title, year: s.year,
    ...(s.genres   ? { genres: s.genres }                   : {}),
    ...(s.overview ? { overview: s.overview.slice(0, 250) } : {}),
    ...(s.network  ? { network: s.network }                 : {}),
    ...(s.status   ? { status: s.status }                   : {}),
    ...(s.rating   ? { trakt_score: s.rating }              : {}),
    ids: { imdb: s.ids?.imdb, trakt: s.ids?.trakt },
    ...extra,
  };
}

// ── Tool implementations ──────────────────────────────────────────────────────

async function getHistory(type, limit) {
  const results = [];
  const q = `?extended=full&limit=${limit}`;
  if (type === 'all' || type === 'movies') {
    const data = await traktGet(`/users/me/history/movies${q}`);
    const seen = new Set();
    for (const item of data) {
      if (seen.has(item.movie.ids.trakt)) continue;
      seen.add(item.movie.ids.trakt);
      results.push({ type: 'movie', watched_at: item.watched_at.slice(0, 10), ...fmtMovie(item.movie) });
    }
  }
  if (type === 'all' || type === 'shows') {
    const data = await traktGet(`/users/me/history/shows${q}`);
    const seen = new Set();
    for (const item of data) {
      if (seen.has(item.show.ids.trakt)) continue;
      seen.add(item.show.ids.trakt);
      results.push({ type: 'show', watched_at: item.watched_at.slice(0, 10), ...fmtShow(item.show) });
    }
  }
  return results;
}

async function getRatings(type) {
  const results = [];
  if (type === 'all' || type === 'movies') {
    const data = await traktGet('/users/me/ratings/movies?extended=full');
    for (const item of data)
      results.push({ type: 'movie', user_rating: item.rating, rated_at: item.rated_at.slice(0, 10), ...fmtMovie(item.movie) });
  }
  if (type === 'all' || type === 'shows') {
    const data = await traktGet('/users/me/ratings/shows?extended=full');
    for (const item of data)
      results.push({ type: 'show', user_rating: item.rating, rated_at: item.rated_at.slice(0, 10), ...fmtShow(item.show) });
  }
  return results.sort((a, b) => b.user_rating - a.user_rating);
}

async function getWatchlist(type) {
  const results = [];
  if (type === 'all' || type === 'movies') {
    const data = await traktGet('/users/me/watchlist/movies?extended=full');
    for (const item of data)
      results.push({ type: 'movie', listed_at: item.listed_at.slice(0, 10), ...fmtMovie(item.movie) });
  }
  if (type === 'all' || type === 'shows') {
    const data = await traktGet('/users/me/watchlist/shows?extended=full');
    for (const item of data)
      results.push({ type: 'show', listed_at: item.listed_at.slice(0, 10), ...fmtShow(item.show) });
  }
  return results;
}

async function searchTrakt(query, type) {
  const data = await traktGet(`/search/${type}?query=${encodeURIComponent(query)}&extended=full&limit=10`);
  return data.map(item => {
    const media = item.movie || item.show;
    const fmt   = item.type === 'movie' ? fmtMovie(media) : fmtShow(media);
    return { type: item.type, search_score: Math.round(item.score * 100) / 100, ...fmt };
  });
}

async function getTraktRecommendations(type) {
  const endpoint = type === 'shows' ? '/recommendations/shows' : '/recommendations/movies';
  const data = await traktGet(`${endpoint}?extended=full&limit=20`);
  return data.map(item => type === 'shows' ? fmtShow(item) : fmtMovie(item));
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'trakt_history',
    description: 'Historial de peliculas y/o series vistas en Trakt del usuario. Incluye titulos, generos, fecha. Usar para saber que ya vio y no repetir recomendaciones.',
    inputSchema: {
      type: 'object',
      properties: {
        type:  { type: 'string', enum: ['movies', 'shows', 'all'] },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'trakt_ratings',
    description: 'Calificaciones del usuario (1-10) ordenadas de mayor a menor. Incluye generos. Clave para entender gustos y preferencias.',
    inputSchema: {
      type: 'object',
      properties: { type: { type: 'string', enum: ['movies', 'shows', 'all'] } },
    },
  },
  {
    name: 'trakt_watchlist',
    description: 'Lista de peliculas/series que el usuario quiere ver. No recomendar lo que ya esta en watchlist.',
    inputSchema: {
      type: 'object',
      properties: { type: { type: 'string', enum: ['movies', 'shows', 'all'] } },
    },
  },
  {
    name: 'trakt_search',
    description: 'Busca una pelicula o serie en Trakt: generos, ano, sinopsis, score.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        type:  { type: 'string', enum: ['movie', 'show', 'movie,show'] },
      },
      required: ['query'],
    },
  },
  {
    name: 'trakt_recommendations',
    description: 'Recomendaciones personalizadas de Trakt basadas en el historial. Ya filtradas — no incluye lo visto.',
    inputSchema: {
      type: 'object',
      properties: { type: { type: 'string', enum: ['movies', 'shows'] } },
    },
  },
];

// ── MCP server factory ────────────────────────────────────────────────────────

function makeServer() {
  const srv = new Server(
    { name: 'trakt-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  srv.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  srv.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      let result;
      switch (name) {
        case 'trakt_history':         result = await getHistory(args?.type || 'all', args?.limit || 50); break;
        case 'trakt_ratings':         result = await getRatings(args?.type || 'all'); break;
        case 'trakt_watchlist':       result = await getWatchlist(args?.type || 'all'); break;
        case 'trakt_search':          result = await searchTrakt(args.query, args?.type || 'movie,show'); break;
        case 'trakt_recommendations': result = await getTraktRecommendations(args?.type || 'movies'); break;
        default: throw new Error(`Herramienta desconocida: ${name}`);
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  });

  return srv;
}

// ── HTTP server: /SECRET/mcp (streamable) + /SECRET/sse (SSE legacy) ──────────

const sseTransports = {};

const httpServer = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id, mcp-protocol-version');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health check (sin secreto) — Render lo usa para saber que el servicio vive
  if (url.pathname === '/' || url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  // Todo lo demas requiere el secreto como primer segmento del path
  const parts = url.pathname.split('/').filter(Boolean); // [secret, endpoint]
  if (parts[0] !== MCP_SECRET) {
    res.writeHead(404); res.end('Not found');
    return;
  }
  const endpoint = parts[1] || '';

  // Streamable HTTP (stateless) — endpoint moderno que usa Claude
  if (endpoint === 'mcp') {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const srv = makeServer();
    res.on('close', () => { transport.close(); srv.close(); });
    await srv.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  // SSE (legacy)
  if (endpoint === 'sse' && req.method === 'GET') {
    const transport = new SSEServerTransport(`/${MCP_SECRET}/messages`, res);
    sseTransports[transport.sessionId] = transport;
    res.on('close', () => delete sseTransports[transport.sessionId]);
    const srv = makeServer();
    await srv.connect(transport);
    return;
  }

  if (endpoint === 'messages' && req.method === 'POST') {
    const sessionId = url.searchParams.get('sessionId');
    const transport = sseTransports[sessionId];
    if (!transport) { res.writeHead(404); res.end('Session not found'); return; }
    await transport.handlePostMessage(req, res);
    return;
  }

  res.writeHead(404); res.end('Not found');
});

httpServer.listen(PORT, () => {
  console.log(`Trakt MCP remoto escuchando en puerto ${PORT}`);
});

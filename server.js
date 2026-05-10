const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const pty = require("node-pty");
const { WebSocketServer } = require("ws");
const cookieParser = require("cookie-parser");
const { getAuthUrl, acquireTokenByCode } = require("./auth/entra");
const { createSession, getSession, destroySession } = require("./auth/session");
const { generateWsToken, validateWsToken } = require("./auth/ws-token");
const { requireAuth, attachUser } = require("./middleware/auth");
const { findOrCreateUser, getUserById } = require("./services/users");
const { logAuditEvent } = require("./services/audit");
const { migrate } = require("./db/migrate");
const {
  listConnections,
  getConnection,
  createConnection,
  updateConnection,
  deleteConnection,
} = require("./services/connections");
const { listFolders, getFolder, createFolder, updateFolder, deleteFolder } = require("./services/folders");
const { getSettings, updateSettings } = require("./services/settings");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 30 * 60 * 1000;
const SESSION_BUFFER_LIMIT = 250000;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const vendorFiles = new Map([
  ["/vendor/xterm.css", path.join(ROOT, "node_modules", "@xterm", "xterm", "css", "xterm.css")],
  ["/vendor/xterm.js", path.join(ROOT, "node_modules", "@xterm", "xterm", "lib", "xterm.js")],
  [
    "/vendor/xterm-addon-fit.js",
    path.join(ROOT, "node_modules", "@xterm", "addon-fit", "lib", "addon-fit.js"),
  ],
]);

const publicFiles = new Map([
  ["/index.html", path.join(ROOT, "index.html")],
  ["/app.js", path.join(ROOT, "app.js")],
  ["/styles.css", path.join(ROOT, "styles.css")],
]);

// Helper to parse cookies
function parseCookies(cookieHeader) {
  const cookies = {};
  if (cookieHeader) {
    cookieHeader.split(";").forEach((cookie) => {
      const [name, ...rest] = cookie.split("=");
      cookies[name.trim()] = rest.join("=").trim();
    });
  }
  return cookies;
}

// Helper to parse JSON body
async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk.toString()));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  req.cookies = parseCookies(req.headers.cookie);

  // Health check endpoint
  if (requestUrl.pathname === "/health" && req.method === "GET") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("OK");
    return;
  }

  // Authentication routes
  if (requestUrl.pathname === "/auth/login" && req.method === "GET") {
    try {
      const state = crypto.randomBytes(16).toString("hex");
      const authUrl = await getAuthUrl(state);
      res.writeHead(302, { Location: authUrl });
      res.end();
    } catch (error) {
      console.error("Login error:", error);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Authentication failed" }));
    }
    return;
  }

  if (requestUrl.pathname === "/auth/callback" && req.method === "GET") {
    try {
      const code = requestUrl.searchParams.get("code");
      if (!code) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Missing authorization code" }));
        return;
      }

      const tokenResponse = await acquireTokenByCode(code);
      const entraProfile = {
        oid: tokenResponse.account.homeAccountId.split(".")[0],
        email: tokenResponse.account.username,
        name: tokenResponse.account.name,
      };

      const user = await findOrCreateUser(entraProfile);
      const sessionId = createSession(user);

      const cookieFlags = process.env.NODE_ENV === "production" ? "; Secure" : "";
      res.writeHead(302, {
        Location: "/",
        "Set-Cookie": `myssh_session=${sessionId}; HttpOnly; SameSite=Lax; Max-Age=86400; Path=/${cookieFlags}`,
      });
      res.end();

      await logAuditEvent({
        userId: user.id,
        action: "LOGIN",
        ipAddress: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
    } catch (error) {
      console.error("Callback error:", error);
      res.writeHead(500, { "content-type": "text/html" });
      res.end("<h1>Authentication failed</h1><p>Please try again.</p>");
    }
    return;
  }

  if (requestUrl.pathname === "/auth/logout" && req.method === "POST") {
    const sessionId = req.cookies.myssh_session;
    const session = getSession(sessionId);

    if (session) {
      await logAuditEvent({
        userId: session.userId,
        action: "LOGOUT",
        ipAddress: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      destroySession(sessionId);
    }

    const cookieFlags = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.writeHead(200, {
      "content-type": "application/json",
      "Set-Cookie": `myssh_session=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/${cookieFlags}`,
    });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  if (requestUrl.pathname === "/api/auth/status" && req.method === "GET") {
    const sessionId = req.cookies.myssh_session;
    const session = getSession(sessionId);

    if (!session) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        userId: session.userId,
        email: session.email,
        displayName: session.displayName,
      }),
    );
    return;
  }

  if (requestUrl.pathname === "/api/auth/ws-token" && req.method === "GET") {
    const sessionId = req.cookies.myssh_session;
    const session = getSession(sessionId);

    if (!session) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const token = generateWsToken(sessionId, session.userId);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ token }));
    return;
  }

  // Connections API
  if (requestUrl.pathname === "/api/connections" && req.method === "GET") {
    const sessionId = req.cookies.myssh_session;
    const session = getSession(sessionId);

    if (!session) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    try {
      const user = await getUserById(session.userId);
      const connections = await listConnections(session.userId, user);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(connections));
    } catch (error) {
      console.error("Error listing connections:", error);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to list connections" }));
    }
    return;
  }

  if (requestUrl.pathname === "/api/connections" && req.method === "POST") {
    const sessionId = req.cookies.myssh_session;
    const session = getSession(sessionId);

    if (!session) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    try {
      const connection = await parseBody(req);
      const user = await getUserById(session.userId);
      const connectionId = await createConnection(session.userId, connection, user);

      await logAuditEvent({
        userId: session.userId,
        action: "CREATE_CONNECTION",
        resourceType: "connection",
        resourceId: connectionId,
        ipAddress: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
        metadata: { name: connection.name, host: connection.host },
      });

      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: connectionId }));
    } catch (error) {
      console.error("Error creating connection:", error);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to create connection" }));
    }
    return;
  }

  if (requestUrl.pathname.startsWith("/api/connections/") && req.method === "PUT") {
    const sessionId = req.cookies.myssh_session;
    const session = getSession(sessionId);

    if (!session) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    try {
      const connectionId = requestUrl.pathname.split("/")[3];
      const connection = await parseBody(req);
      const user = await getUserById(session.userId);
      const success = await updateConnection(session.userId, connectionId, connection, user);

      if (!success) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Connection not found" }));
        return;
      }

      await logAuditEvent({
        userId: session.userId,
        action: "UPDATE_CONNECTION",
        resourceType: "connection",
        resourceId: connectionId,
        ipAddress: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
      });

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      console.error("Error updating connection:", error);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to update connection" }));
    }
    return;
  }

  if (requestUrl.pathname.startsWith("/api/connections/") && req.method === "DELETE") {
    const sessionId = req.cookies.myssh_session;
    const session = getSession(sessionId);

    if (!session) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    try {
      const connectionId = requestUrl.pathname.split("/")[3];
      const success = await deleteConnection(session.userId, connectionId);

      if (!success) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Connection not found" }));
        return;
      }

      await logAuditEvent({
        userId: session.userId,
        action: "DELETE_CONNECTION",
        resourceType: "connection",
        resourceId: connectionId,
        ipAddress: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
      });

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      console.error("Error deleting connection:", error);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to delete connection" }));
    }
    return;
  }

  // Folders API
  if (requestUrl.pathname === "/api/folders" && req.method === "GET") {
    const sessionId = req.cookies.myssh_session;
    const session = getSession(sessionId);

    if (!session) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    try {
      const folders = await listFolders(session.userId);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(folders));
    } catch (error) {
      console.error("Error listing folders:", error);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to list folders" }));
    }
    return;
  }

  if (requestUrl.pathname === "/api/folders" && req.method === "POST") {
    const sessionId = req.cookies.myssh_session;
    const session = getSession(sessionId);

    if (!session) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    try {
      const folder = await parseBody(req);
      const folderId = await createFolder(session.userId, folder);
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: folderId }));
    } catch (error) {
      console.error("Error creating folder:", error);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to create folder" }));
    }
    return;
  }

  if (requestUrl.pathname.startsWith("/api/folders/") && req.method === "PUT") {
    const sessionId = req.cookies.myssh_session;
    const session = getSession(sessionId);

    if (!session) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    try {
      const folderId = requestUrl.pathname.split("/")[3];
      const folder = await parseBody(req);
      const success = await updateFolder(session.userId, folderId, folder);

      if (!success) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Folder not found" }));
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      console.error("Error updating folder:", error);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to update folder" }));
    }
    return;
  }

  if (requestUrl.pathname.startsWith("/api/folders/") && req.method === "DELETE") {
    const sessionId = req.cookies.myssh_session;
    const session = getSession(sessionId);

    if (!session) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    try {
      const folderId = requestUrl.pathname.split("/")[3];
      const success = await deleteFolder(session.userId, folderId);

      if (!success) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Folder not found" }));
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      console.error("Error deleting folder:", error);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to delete folder" }));
    }
    return;
  }

  // Settings API
  if (requestUrl.pathname === "/api/settings" && req.method === "GET") {
    const sessionId = req.cookies.myssh_session;
    const session = getSession(sessionId);

    if (!session) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    try {
      const settings = await getSettings(session.userId);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(settings));
    } catch (error) {
      console.error("Error getting settings:", error);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to get settings" }));
    }
    return;
  }

  if (requestUrl.pathname === "/api/settings" && req.method === "PUT") {
    const sessionId = req.cookies.myssh_session;
    const session = getSession(sessionId);

    if (!session) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    try {
      const settings = await parseBody(req);
      await updateSettings(session.userId, settings);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      console.error("Error updating settings:", error);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to update settings" }));
    }
    return;
  }

  // Static file serving
  const filePath = resolveStaticPath(requestUrl.pathname);

  if (!filePath) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      res.writeHead(error.code === "ENOENT" ? 404 : 500, {
        "content-type": "text/plain; charset=utf-8",
      });
      res.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    res.writeHead(200, {
      "content-type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
    });
    res.end(contents);
  });
});

const wss = new WebSocketServer({ noServer: true });

// User-scoped SSH sessions: Map<userId, Map<sessionId, session>>
const userSessions = new Map();

/**
 * Gets user's session map
 * @param {string} userId - User UUID
 * @returns {Map} User's session map
 */
function getUserSessions(userId) {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, new Map());
  }
  return userSessions.get(userId);
}

server.on("upgrade", (req, socket, head) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  if (requestUrl.pathname !== "/ssh") {
    socket.destroy();
    return;
  }

  // Validate WebSocket token
  const token = requestUrl.searchParams.get("token");
  const tokenData = validateWsToken(token);

  if (!tokenData) {
    console.error("WebSocket upgrade denied: invalid or expired token");
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  // Attach user info to request for WebSocket handler
  req.user = tokenData;

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws, req) => {
  let session = null;
  const userId = req.user.userId; // From WebSocket token validation
  const userSessionsMap = getUserSessions(userId);

  ws.on("message", (rawMessage) => {
    const message = parseJson(rawMessage);
    if (!message) {
      send(ws, { type: "error", message: "Invalid terminal message." });
      return;
    }

    if (message.type === "connect") {
      if (session) {
        detachClient(session, ws);
      }
      session = startSsh(
        ws,
        message.connection,
        message.cols,
        message.rows,
        message.clientSessionId,
        userId,
      );
      if (session) {
        attachClient(session, ws);
      }
      return;
    }

    if (message.type === "attach") {
      if (session) {
        detachClient(session, ws);
      }
      // Only allow attaching to user's own sessions
      session = userSessionsMap.get(String(message.sessionId)) || null;
      if (!session) {
        send(ws, { type: "missing", sessionId: message.sessionId });
        return;
      }
      // Verify session belongs to this user
      if (session.userId !== userId) {
        send(ws, { type: "error", message: "Unauthorized access to session." });
        ws.close();
        return;
      }
      attachClient(session, ws, message.cols, message.rows);
      return;
    }

    if (message.type === "input" && session) {
      // Verify session still belongs to this user
      if (session.userId !== userId) {
        send(ws, { type: "error", message: "Unauthorized." });
        ws.close();
        return;
      }
      session.term.write(String(message.data || ""));
      return;
    }

    if (message.type === "resize" && session) {
      if (session.userId !== userId) {
        send(ws, { type: "error", message: "Unauthorized." });
        ws.close();
        return;
      }
      session.term.resize(safeDimension(message.cols, 80), safeDimension(message.rows, 24));
      return;
    }

    if (message.type === "disconnect" && session) {
      if (session.userId !== userId) {
        send(ws, { type: "error", message: "Unauthorized." });
        ws.close();
        return;
      }
      stopSession(session);
      userSessionsMap.delete(session.id);
      session = null;
      send(ws, { type: "status", message: "Disconnected.", connected: false });
    }
  });

  ws.on("close", () => {
    if (session) {
      detachClient(session, ws);
      session = null;
    }
  });
});

// Start server with database migration
async function startServer() {
  try {
    // Run database migrations
    await migrate();

    // Start HTTP server
    server.listen(PORT, HOST, () => {
      console.log(`MySSH running at ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();

function resolveStaticPath(pathname) {
  if (vendorFiles.has(pathname)) {
    return vendorFiles.get(pathname);
  }

  const normalized = pathname === "/" ? "/index.html" : pathname;
  return publicFiles.get(normalized) || null;
}

function startSsh(ws, connection, cols, rows, requestedSessionId, userId) {
  const validationError = validateConnection(connection);
  if (validationError) {
    send(ws, { type: "error", message: validationError });
    return null;
  }

  const id = createSessionId(requestedSessionId);
  const keyPath = writePrivateKey(connection.privateKeyContent);
  const args = buildSshArgs(connection, keyPath);
  let passphraseSent = false;
  const term = pty.spawn("ssh", args, {
    name: "xterm-256color",
    cols: safeDimension(cols, 80),
    rows: safeDimension(rows, 24),
    cwd: os.homedir(),
    env: process.env,
  });

  const session = {
    id,
    userId, // Store user ownership
    term,
    keyPath,
    connection: publicConnection(connection),
    clients: new Set(),
    buffer: "",
    connected: true,
    status: `Connected to ${connection.host}.`,
    cleanupTimer: null,
  };

  // Store in user-scoped map
  const userSessionsMap = getUserSessions(userId);
  userSessionsMap.set(id, session);

  // Audit log SSH connection
  logAuditEvent({
    userId,
    action: "SSH_CONNECT",
    resourceType: "session",
    resourceId: id,
    metadata: {
      host: connection.host,
      port: connection.port,
      username: connection.username,
      connectionName: connection.name,
    },
  }).catch((err) => console.error("Audit log error:", err));

  term.onData((data) => {
    appendSessionBuffer(session, data);
    broadcast(session, { type: "output", data });
    if (!passphraseSent && connection.privateKeyPassphrase && isPrivateKeyPassphrasePrompt(data)) {
      passphraseSent = true;
      term.write(`${connection.privateKeyPassphrase}\r`);
    }
  });

  term.onExit(({ exitCode }) => {
    removePrivateKey(keyPath);
    session.connected = false;
    session.status = `Disconnected${Number.isInteger(exitCode) ? ` with code ${exitCode}` : ""}.`;
    broadcast(session, { type: "exit", code: exitCode });
    scheduleSessionCleanup(session, userId);

    // Audit log SSH disconnection
    logAuditEvent({
      userId,
      action: "SSH_DISCONNECT",
      resourceType: "session",
      resourceId: id,
      metadata: {
        exitCode,
        host: connection.host,
        connectionName: connection.name,
      },
    }).catch((err) => console.error("Audit log error:", err));
  });

  return session;
}

function attachClient(session, ws, cols, rows) {
  clearTimeout(session.cleanupTimer);
  session.cleanupTimer = null;
  session.clients.add(ws);
  if (cols && rows && session.connected) {
    session.term.resize(safeDimension(cols, 80), safeDimension(rows, 24));
  }
  send(ws, {
    type: "attached",
    sessionId: session.id,
    connection: session.connection,
    buffer: session.buffer,
    connected: session.connected,
    status: session.status,
  });
}

function detachClient(session, ws) {
  session.clients.delete(ws);
  scheduleSessionCleanup(session, session.userId);
}

function scheduleSessionCleanup(session, userId) {
  if (session.clients.size > 0 || session.cleanupTimer) {
    return;
  }
  session.cleanupTimer = setTimeout(() => {
    stopSession(session);
    const userSessionsMap = getUserSessions(userId);
    userSessionsMap.delete(session.id);
  }, SESSION_TTL_MS);
}

function appendSessionBuffer(session, data) {
  session.buffer += data;
  if (session.buffer.length > SESSION_BUFFER_LIMIT) {
    session.buffer = session.buffer.slice(-SESSION_BUFFER_LIMIT);
  }
}

function broadcast(session, payload) {
  for (const client of session.clients) {
    send(client, payload);
  }
}

function publicConnection(connection) {
  return {
    id: connection.id || "",
    name: connection.name || connection.host,
    host: connection.host,
    port: Number(connection.port) || 22,
    username: connection.username || "",
  };
}

function createSessionId(requestedSessionId) {
  if (requestedSessionId && /^[A-Za-z0-9_-]{8,80}$/.test(String(requestedSessionId))) {
    return String(requestedSessionId);
  }
  return crypto.randomUUID();
}

function validateConnection(connection) {
  if (!connection || typeof connection !== "object") {
    return "Missing connection details.";
  }

  if (!connection.host || typeof connection.host !== "string") {
    return "Host is required.";
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(connection.host) || connection.host.startsWith("-")) {
    return "Host may only contain letters, numbers, dots, dashes, underscores, and colons.";
  }

  const port = Number(connection.port) || 22;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return "Port must be between 1 and 65535.";
  }

  if (connection.username && !/^[A-Za-z0-9._-]+$/.test(connection.username)) {
    return "Username may only contain letters, numbers, dots, dashes, and underscores.";
  }

  if (!connection.privateKeyContent || typeof connection.privateKeyContent !== "string") {
    return "Private key content is required.";
  }

  if (Buffer.byteLength(connection.privateKeyContent, "utf8") > 65536) {
    return "Private key content is too large.";
  }

  if (!/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(connection.privateKeyContent)) {
    return "Private key content must include a BEGIN PRIVATE KEY line.";
  }

  if (
    connection.privateKeyPassphrase &&
    Buffer.byteLength(String(connection.privateKeyPassphrase), "utf8") > 4096
  ) {
    return "Private key passphrase is too large.";
  }

  return null;
}

function buildSshArgs(connection, keyPath) {
  const args = [
    "-i",
    keyPath,
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-p",
    String(Number(connection.port) || 22),
  ];

  const destination = connection.username
    ? `${connection.username}@${connection.host}`
    : connection.host;
  args.push(destination);
  return args;
}

function writePrivateKey(privateKeyContent) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "myssh-key-"));
  const keyPath = path.join(directory, "id");
  const normalized = privateKeyContent.trim().replace(/\r\n/g, "\n");
  fs.writeFileSync(keyPath, `${normalized}\n`, { mode: 0o600 });
  fs.chmodSync(keyPath, 0o600);
  return keyPath;
}

function stopSession(session) {
  clearTimeout(session.cleanupTimer);
  if (session.connected) {
    session.term.kill();
  }
  removePrivateKey(session.keyPath);
}

function removePrivateKey(keyPath) {
  if (!keyPath) {
    return;
  }

  try {
    fs.rmSync(path.dirname(keyPath), { recursive: true, force: true });
  } catch {
    // Best effort cleanup for temporary key material.
  }
}

function parseJson(rawMessage) {
  try {
    return JSON.parse(rawMessage.toString());
  } catch {
    return null;
  }
}

function safeDimension(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(2, Math.min(500, Math.floor(number)));
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function isPrivateKeyPassphrasePrompt(data) {
  const text = String(data).toLowerCase();
  return text.includes("enter passphrase for key") || text.includes("bad passphrase, try again");
}

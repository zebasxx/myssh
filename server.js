const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const pty = require("node-pty");
const { WebSocketServer } = require("ws");

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

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
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
const sshSessions = new Map();

server.on("upgrade", (req, socket, head) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  if (requestUrl.pathname !== "/ssh") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws) => {
  let session = null;

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
      session = startSsh(ws, message.connection, message.cols, message.rows, message.clientSessionId);
      if (session) {
        attachClient(session, ws);
      }
      return;
    }

    if (message.type === "attach") {
      if (session) {
        detachClient(session, ws);
      }
      session = sshSessions.get(String(message.sessionId)) || null;
      if (!session) {
        send(ws, { type: "missing", sessionId: message.sessionId });
        return;
      }
      attachClient(session, ws, message.cols, message.rows);
      return;
    }

    if (message.type === "input" && session) {
      session.term.write(String(message.data || ""));
      return;
    }

    if (message.type === "resize" && session) {
      session.term.resize(safeDimension(message.cols, 80), safeDimension(message.rows, 24));
      return;
    }

    if (message.type === "disconnect" && session) {
      stopSession(session);
      sshSessions.delete(session.id);
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

server.listen(PORT, HOST, () => {
  console.log(`MySSH running at http://localhost:${PORT}`);
});

function resolveStaticPath(pathname) {
  if (vendorFiles.has(pathname)) {
    return vendorFiles.get(pathname);
  }

  const normalized = pathname === "/" ? "/index.html" : pathname;
  return publicFiles.get(normalized) || null;
}

function startSsh(ws, connection, cols, rows, requestedSessionId) {
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
    term,
    keyPath,
    connection: publicConnection(connection),
    clients: new Set(),
    buffer: "",
    connected: true,
    status: `Connected to ${connection.host}.`,
    cleanupTimer: null,
  };
  sshSessions.set(id, session);

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
    scheduleSessionCleanup(session);
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
  scheduleSessionCleanup(session);
}

function scheduleSessionCleanup(session) {
  if (session.clients.size > 0 || session.cleanupTimer) {
    return;
  }
  session.cleanupTimer = setTimeout(() => {
    stopSession(session);
    sshSessions.delete(session.id);
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

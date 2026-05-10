const STORAGE_KEY = "myssh.connections.v1";
const SETTINGS_KEY = "myssh.settings.v1";
const SESSION_STORAGE_KEY = "myssh.sessions.v1";

const defaultSettings = {
  autoCopySelection: false,
  rightClickPaste: false,
};

const defaultState = {
  selectedId: "conn-prod-api",
  items: [
    {
      id: "folder-production",
      type: "folder",
      name: "Production",
      parentId: null,
      collapsed: false,
    },
    {
      id: "conn-prod-api",
      type: "connection",
      name: "Production API",
      parentId: "folder-production",
      host: "api.example.com",
      port: 22,
      username: "ubuntu",
      privateKeyContent: "",
      privateKeyPassphrase: "",
      notes: "Primary API server.",
    },
    {
      id: "folder-staging",
      type: "folder",
      name: "Staging",
      parentId: null,
      collapsed: false,
    },
    {
      id: "conn-staging-web",
      type: "connection",
      name: "Staging Web",
      parentId: "folder-staging",
      host: "192.0.2.42",
      port: 2222,
      username: "deploy",
      privateKeyContent: "",
      privateKeyPassphrase: "",
      notes: "",
    },
  ],
};

const els = {
  treeRoot: document.querySelector("#treeRoot"),
  searchInput: document.querySelector("#searchInput"),
  settingsToggle: document.querySelector("#settingsToggle"),
  settingsBody: document.querySelector("#settingsBody"),
  autoCopySelectionInput: document.querySelector("#autoCopySelectionInput"),
  rightClickPasteInput: document.querySelector("#rightClickPasteInput"),
  settingsStatus: document.querySelector("#settingsStatus"),
  addFolderButton: document.querySelector("#addFolderButton"),
  addConnectionButton: document.querySelector("#addConnectionButton"),
  connectButton: document.querySelector("#connectButton"),
  editButton: document.querySelector("#editButton"),
  duplicateButton: document.querySelector("#duplicateButton"),
  duplicateNameSelect: document.querySelector("#duplicateNameSelect"),
  deleteButton: document.querySelector("#deleteButton"),
  selectionType: document.querySelector("#selectionType"),
  selectionTitle: document.querySelector("#selectionTitle"),
  selectionSubtitle: document.querySelector("#selectionSubtitle"),
  sessionTabs: document.querySelector("#sessionTabs"),
  terminalStack: document.querySelector("#terminalStack"),
  terminalEmpty: document.querySelector("#terminalEmpty"),
  editorPanel: document.querySelector("#editorPanel"),
  editorType: document.querySelector("#editorType"),
  editorTitle: document.querySelector("#editorTitle"),
  closeEditorButton: document.querySelector("#closeEditorButton"),
  connectionForm: document.querySelector("#connectionForm"),
  folderForm: document.querySelector("#folderForm"),
  folderNameInput: document.querySelector("#folderNameInput"),
  folderStatus: document.querySelector("#folderStatus"),
  nameInput: document.querySelector("#nameInput"),
  folderInput: document.querySelector("#folderInput"),
  hostInput: document.querySelector("#hostInput"),
  portInput: document.querySelector("#portInput"),
  userInput: document.querySelector("#userInput"),
  passphraseInput: document.querySelector("#passphraseInput"),
  keyInput: document.querySelector("#keyInput"),
  notesInput: document.querySelector("#notesInput"),
  saveStatus: document.querySelector("#saveStatus"),
  commandPanel: document.querySelector("#commandPanel"),
  commandPreview: document.querySelector("#commandPreview"),
  copyCommandButton: document.querySelector("#copyCommandButton"),
};

let state = loadState();
let settings = loadSettings();
const sessions = new Map();
let activeSessionId = null;
let draggedConnectionId = null;
let draggedSessionId = null;

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    return structuredClone(defaultState);
  }

  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed.items)) {
      throw new Error("Invalid saved data");
    }
    return parsed;
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadSettings() {
  const saved = localStorage.getItem(SETTINGS_KEY);
  if (!saved) {
    return structuredClone(defaultSettings);
  }

  try {
    return { ...defaultSettings, ...JSON.parse(saved) };
  } catch {
    return structuredClone(defaultSettings);
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function selectedItem() {
  return state.items.find((item) => item.id === state.selectedId) || null;
}

function getChildren(parentId) {
  return state.items
    .filter((item) => item.parentId === parentId)
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
}

function getFolderOptions() {
  return state.items
    .filter((item) => item.type === "folder")
    .sort((a, b) => a.name.localeCompare(b.name));
}

function folderPath(folder) {
  const names = [folder.name];
  let parent = state.items.find((item) => item.id === folder.parentId);
  while (parent) {
    names.unshift(parent.name);
    parent = state.items.find((item) => item.id === parent.parentId);
  }
  return names.join(" / ");
}

function matchesSearch(item, term) {
  if (!term) {
    return true;
  }
  const haystack = [item.name, item.host, item.username].filter(Boolean).join(" ").toLowerCase();
  if (haystack.includes(term)) {
    return true;
  }
  return item.type === "folder" && getChildren(item.id).some((child) => matchesSearch(child, term));
}

function renderTree() {
  const term = els.searchInput.value.trim().toLowerCase();
  els.treeRoot.innerHTML = "";
  els.treeRoot.classList.add("tree-root-drop");
  const roots = getChildren(null).filter((item) => matchesSearch(item, term));

  if (roots.length === 0) {
    const empty = document.createElement("li");
    empty.className = "tree-meta";
    empty.textContent = "No matching connections.";
    els.treeRoot.append(empty);
    return;
  }

  els.treeRoot.append(renderRootDropTarget());
  for (const item of roots) {
    els.treeRoot.append(renderTreeItem(item, term));
  }
}

function renderRootDropTarget() {
  const li = document.createElement("li");
  li.className = "tree-item";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "tree-row folder-drop-target root-drop-row";
  button.setAttribute("aria-label", "Move connection to no folder");
  button.addEventListener("dragover", handleRootDragOver);
  button.addEventListener("dragleave", handleRootDragLeave);
  button.addEventListener("drop", handleRootDrop);

  const icon = document.createElement("span");
  icon.className = "tree-icon";
  icon.textContent = "/";
  icon.setAttribute("aria-hidden", "true");

  const name = document.createElement("span");
  name.className = "tree-name";
  name.textContent = "No folder";

  const meta = document.createElement("span");
  meta.className = "tree-meta";
  meta.textContent = `${getChildren(null).filter((item) => item.type === "connection").length}`;

  button.append(icon, name, meta);
  li.append(button);
  return li;
}

function renderTreeItem(item, term) {
  const li = document.createElement("li");
  li.className = "tree-item";

  const button = document.createElement("button");
  button.type = "button";
  button.className = `tree-row${item.id === state.selectedId ? " selected" : ""}${item.type === "folder" ? " folder-drop-target" : ""}`;
  button.setAttribute("aria-label", `${item.type}: ${item.name}`);
  button.addEventListener("click", () => selectItem(item.id));

  if (item.type === "connection") {
    button.draggable = true;
    button.addEventListener("dblclick", () => connectConnection(item));
    button.addEventListener("dragstart", (event) => handleConnectionDragStart(event, item));
    button.addEventListener("dragend", handleConnectionDragEnd);
  }

  if (item.type === "folder") {
    button.addEventListener("dragover", (event) => handleFolderDragOver(event, item));
    button.addEventListener("dragleave", handleFolderDragLeave);
    button.addEventListener("drop", (event) => handleFolderDrop(event, item));
  }

  const icon = document.createElement("span");
  icon.className = "tree-icon";
  icon.textContent = item.type === "folder" ? (item.collapsed ? ">" : "v") : "$";
  icon.setAttribute("aria-hidden", "true");
  icon.addEventListener("click", (event) => {
    if (item.type !== "folder") {
      return;
    }
    event.stopPropagation();
    item.collapsed = !item.collapsed;
    saveState();
    render();
  });

  const name = document.createElement("span");
  name.className = "tree-name";
  name.textContent = item.name;

  const meta = document.createElement("span");
  meta.className = "tree-meta";
  meta.textContent = item.type === "connection" ? `${item.host}:${item.port || 22}` : `${getChildren(item.id).length}`;

  button.append(icon, name, meta);
  li.append(button);

  const children = getChildren(item.id).filter((child) => matchesSearch(child, term));
  if (item.type === "folder" && children.length > 0 && (!item.collapsed || term)) {
    const ul = document.createElement("ul");
    for (const child of children) {
      ul.append(renderTreeItem(child, term));
    }
    li.append(ul);
  }

  return li;
}

function handleConnectionDragStart(event, item) {
  draggedConnectionId = item.id;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", item.id);
  event.currentTarget.classList.add("dragging");
}

function handleConnectionDragEnd(event) {
  draggedConnectionId = null;
  event.currentTarget.classList.remove("dragging");
  clearDropTargets();
}

function handleFolderDragOver(event, folder) {
  if (!canMoveDraggedConnection(folder.id)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = "move";
  event.currentTarget.classList.add("drop-target-active");
}

function handleFolderDragLeave(event) {
  event.currentTarget.classList.remove("drop-target-active");
}

function handleFolderDrop(event, folder) {
  if (!canMoveDraggedConnection(folder.id)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  moveConnection(draggedConnectionId, folder.id);
}

function handleRootDragOver(event) {
  if (!canMoveDraggedConnection(null)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = "move";
  event.currentTarget.classList.add("drop-target-active");
}

function handleRootDragLeave(event) {
  event.currentTarget.classList.remove("drop-target-active");
}

function handleRootDrop(event) {
  if (!canMoveDraggedConnection(null)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  moveConnection(draggedConnectionId, null);
}

function canMoveDraggedConnection(parentId) {
  if (!draggedConnectionId) {
    return false;
  }
  const item = state.items.find((candidate) => candidate.id === draggedConnectionId);
  return Boolean(item && item.type === "connection" && item.parentId !== parentId);
}

function moveConnection(connectionId, parentId) {
  const item = state.items.find((candidate) => candidate.id === connectionId);
  if (!item || item.type !== "connection") {
    return;
  }
  item.parentId = parentId;
  draggedConnectionId = null;
  saveState();
  render();
}

function clearDropTargets() {
  document.querySelectorAll(".drop-target-active").forEach((element) => {
    element.classList.remove("drop-target-active");
  });
}

function renderFolderOptions() {
  els.folderInput.innerHTML = "";

  const rootOption = document.createElement("option");
  rootOption.value = "";
  rootOption.textContent = "No folder";
  els.folderInput.append(rootOption);

  for (const folder of getFolderOptions()) {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folderPath(folder);
    els.folderInput.append(option);
  }
}

function renderDetails() {
  const item = selectedItem();
  const hasSelection = Boolean(item);
  const isConnection = item?.type === "connection";
  const isFolder = item?.type === "folder";

  els.connectButton.classList.toggle("hidden", !isConnection);
  els.editButton.classList.toggle("hidden", !hasSelection);
  els.duplicateButton.classList.toggle("hidden", !isConnection);
  els.duplicateNameSelect.classList.add("hidden");
  els.deleteButton.classList.toggle("hidden", !hasSelection);

  if (!item) {
    els.selectionType.textContent = "Ready";
    els.selectionTitle.textContent = "No item selected";
    els.selectionSubtitle.textContent = "Create a folder or connection to begin.";
    return;
  }

  els.selectionType.textContent = item.type;
  els.selectionTitle.textContent = item.name || "Untitled";
  els.selectionSubtitle.textContent = isFolder
    ? `${getChildren(item.id).length} saved item${getChildren(item.id).length === 1 ? "" : "s"}`
    : connectionLabel(item);

  if (!els.editorPanel.classList.contains("hidden")) {
    populateEditor(item);
  }
}

function populateEditor(item) {
  const isConnection = item?.type === "connection";
  const isFolder = item?.type === "folder";

  els.editorType.textContent = item?.type || "Editor";
  els.editorTitle.textContent = isFolder ? "Edit folder" : "Edit connection";
  els.connectionForm.classList.toggle("hidden", !isConnection);
  els.commandPanel.classList.toggle("hidden", !isConnection);
  els.folderForm.classList.toggle("hidden", !isFolder);

  if (isFolder) {
    els.folderNameInput.value = item.name || "";
    return;
  }

  if (!isConnection) {
    return;
  }

  renderFolderOptions();
  els.nameInput.value = item.name || "";
  els.folderInput.value = item.parentId || "";
  els.hostInput.value = item.host || "";
  els.portInput.value = item.port || 22;
  els.userInput.value = item.username || "";
  els.passphraseInput.value = item.privateKeyPassphrase || "";
  els.keyInput.value = item.privateKeyContent || "";
  els.notesInput.value = item.notes || "";
  renderCommand(connectionDraftFromForm(item));
}

function connectionLabel(item) {
  const userPrefix = item.username ? `${item.username}@` : "";
  return `${userPrefix}${item.host || "host"}:${item.port || 22}`;
}

function buildSshCommand(item) {
  const port = item.port || 22;
  const userPrefix = item.username ? `${item.username}@` : "";
  const host = item.host || "example.com";
  return `ssh -i <embedded-key> -p ${port} ${userPrefix}${host}`;
}

function renderCommand(item = selectedItem()) {
  els.commandPreview.textContent = item?.type === "connection" || item?.host ? buildSshCommand(item) : "";
}

function normalizePrivateKey(value) {
  const normalized = value.trim().replace(/\r\n/g, "\n");
  return normalized ? `${normalized}\n` : "";
}

function connectionDraftFromForm(item = selectedItem()) {
  if (!item || item.type !== "connection") {
    return null;
  }

  return {
    id: item.id,
    type: "connection",
    name: els.nameInput.value.trim() || item.name || "Untitled connection",
    parentId: els.folderInput.value || null,
    host: els.hostInput.value.trim(),
    port: Number(els.portInput.value) || 22,
    username: els.userInput.value.trim(),
    privateKeyPassphrase: els.passphraseInput.value,
    privateKeyContent: normalizePrivateKey(els.keyInput.value),
  };
}

function connectionPayload(item) {
  return {
    id: item.id,
    name: item.name || "Untitled connection",
    host: item.host || "",
    port: Number(item.port) || 22,
    username: item.username || "",
    privateKeyPassphrase: item.privateKeyPassphrase || "",
    privateKeyContent: normalizePrivateKey(item.privateKeyContent || ""),
  };
}

function selectItem(id) {
  state.selectedId = id;
  els.saveStatus.textContent = "";
  els.folderStatus.textContent = "";
  saveState();
  render();
}

function addFolder() {
  const current = selectedItem();
  const folder = {
    id: createId("folder"),
    type: "folder",
    name: "New folder",
    parentId: current?.type === "folder" ? current.id : null,
    collapsed: false,
  };
  state.items.push(folder);
  selectItem(folder.id);
  openEditor();
  requestAnimationFrame(() => {
    els.folderNameInput.focus();
    els.folderNameInput.select();
  });
}

function addConnection() {
  const current = selectedItem();
  const parentId = current?.type === "folder" ? current.id : current?.parentId || null;
  const connection = {
    id: createId("conn"),
    type: "connection",
    name: "New connection",
    parentId,
    host: "",
    port: 22,
    username: "",
    privateKeyContent: "",
    privateKeyPassphrase: "",
    notes: "",
  };
  state.items.push(connection);
  selectItem(connection.id);
  openEditor();
  requestAnimationFrame(() => {
    els.nameInput.focus();
    els.nameInput.select();
  });
}

function duplicateConnection() {
  const item = selectedItem();
  if (!item || item.type !== "connection") {
    return;
  }

  renderDuplicateNameOptions(item);
}

function renderDuplicateNameOptions(item) {
  els.duplicateNameSelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose name...";
  els.duplicateNameSelect.append(placeholder);

  for (const option of duplicateNameOptions(item.name || "Connection")) {
    const optionEl = document.createElement("option");
    optionEl.value = option.name;
    optionEl.textContent = option.label;
    els.duplicateNameSelect.append(optionEl);
  }

  els.duplicateNameSelect.classList.remove("hidden");
  els.duplicateNameSelect.value = "";
  els.duplicateNameSelect.focus();
}

function duplicateNameOptions(name) {
  const options = [{ label: `${name} - copy`, name: `${name} - copy` }];
  const seen = new Set(options.map((option) => option.name));
  const matches = Array.from(name.matchAll(/\d+/g));

  for (const match of matches) {
    const rawNumber = match[0];
    const nextNumber = String(Number(rawNumber) + 1).padStart(rawNumber.length, "0");
    const nextName = `${name.slice(0, match.index)}${nextNumber}${name.slice(match.index + rawNumber.length)}`;
    if (seen.has(nextName)) {
      continue;
    }
    seen.add(nextName);
    options.push({
      label: `Increment ${rawNumber} -> ${nextNumber}: ${nextName}`,
      name: nextName,
    });
  }

  return options;
}

function duplicateConnectionWithName(name) {
  const item = selectedItem();
  if (!item || item.type !== "connection" || !name) {
    return;
  }

  const copy = {
    ...item,
    id: createId("conn"),
    name,
  };
  state.items.push(copy);
  els.duplicateNameSelect.classList.add("hidden");
  selectItem(copy.id);
  openEditor();
}

function deleteSelected() {
  const item = selectedItem();
  if (!item) {
    return;
  }

  const message =
    item.type === "folder"
      ? `Delete "${item.name}" and everything inside it?`
      : `Delete "${item.name}"?`;
  if (!confirm(message)) {
    return;
  }

  const idsToDelete = new Set([item.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of state.items) {
      if (candidate.parentId && idsToDelete.has(candidate.parentId) && !idsToDelete.has(candidate.id)) {
        idsToDelete.add(candidate.id);
        changed = true;
      }
    }
  }

  state.items = state.items.filter((candidate) => !idsToDelete.has(candidate.id));
  state.selectedId = state.items[0]?.id || null;
  closeEditor();
  saveState();
  render();
}

function openEditor() {
  const item = selectedItem();
  if (!item) {
    return;
  }
  els.editorPanel.classList.remove("hidden");
  populateEditor(item);
}

function closeEditor() {
  els.editorPanel.classList.add("hidden");
  els.saveStatus.textContent = "";
  els.folderStatus.textContent = "";
}

function saveConnection(event) {
  event.preventDefault();
  const item = selectedItem();
  if (!item || item.type !== "connection") {
    return;
  }

  item.name = els.nameInput.value.trim();
  item.parentId = els.folderInput.value || null;
  item.host = els.hostInput.value.trim();
  item.port = Number(els.portInput.value) || 22;
  item.username = els.userInput.value.trim();
  item.privateKeyPassphrase = els.passphraseInput.value;
  item.privateKeyContent = normalizePrivateKey(els.keyInput.value);
  delete item.privateKey;
  item.notes = els.notesInput.value.trim();
  els.saveStatus.textContent = "Saved.";
  saveState();
  render();
}

function saveFolder(event) {
  event.preventDefault();
  const item = selectedItem();
  if (!item || item.type !== "folder") {
    return;
  }

  item.name = els.folderNameInput.value.trim();
  els.folderStatus.textContent = "Saved.";
  saveState();
  render();
}

async function copyCommand() {
  const item = connectionDraftFromForm();
  if (!item) {
    return;
  }

  const command = buildSshCommand(item);
  try {
    await navigator.clipboard.writeText(command);
    els.saveStatus.textContent = "Command copied.";
  } catch {
    els.commandPreview.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(els.commandPreview);
    selection.removeAllRanges();
    selection.addRange(range);
    els.saveStatus.textContent = "Command selected.";
  }
}

function connectSelected() {
  const item = selectedItem();
  if (!item || item.type !== "connection") {
    return;
  }

  connectConnection(item);
}

function connectConnection(item) {
  if (!window.Terminal || !window.FitAddon) {
    return;
  }

  if (location.protocol === "file:") {
    return;
  }

  const connection = connectionPayload(item);
  const session = createSession(connection);
  activeSessionId = session.id;
  persistSessions();
  renderSessions();
  connectSession(session, "connect");
}

function createSession(connection, options = {}) {
  const id = options.id || createId("session");
  const panel = document.createElement("div");
  panel.className = "terminal-panel";
  panel.dataset.sessionId = id;
  els.terminalStack.append(panel);

  const terminal = new window.Terminal({
    cursorBlink: true,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    fontSize: 13,
    theme: {
      background: "#0f1720",
      foreground: "#dce7ef",
      cursor: "#ffffff",
      selectionBackground: "#37536b",
    },
  });
  const fitAddon = new window.FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(panel);
  terminal.writeln(options.initialLine || `Connecting to ${connectionLabel(connection)}...`);

  const session = {
    id,
    connection,
    terminal,
    fitAddon,
    panel,
    socket: null,
    connected: false,
    status: "Connecting",
  };

  terminal.onData((data) => {
    if (session.socket?.readyState === WebSocket.OPEN) {
      session.socket.send(JSON.stringify({ type: "input", data }));
    }
  });
  terminal.onSelectionChange(() => copyTerminalSelection(session));
  panel.addEventListener("contextmenu", (event) => pasteClipboardOnRightClick(event, session));

  sessions.set(id, session);
  requestAnimationFrame(() => fitSession(session));
  return session;
}

async function pasteClipboardOnRightClick(event, session) {
  if (!settings.rightClickPaste) {
    return;
  }

  event.preventDefault();
  session.terminal.focus();

  try {
    const text = await navigator.clipboard.readText();
    if (text && session.socket?.readyState === WebSocket.OPEN) {
      session.socket.send(JSON.stringify({ type: "input", data: text }));
      els.settingsStatus.textContent = "Clipboard pasted.";
    }
  } catch {
    els.settingsStatus.textContent = "Clipboard permission blocked paste.";
  }
}

async function copyTerminalSelection(session) {
  if (!settings.autoCopySelection) {
    return;
  }

  const selection = session.terminal.getSelection().trim();
  if (!selection || selection === session.lastCopiedSelection) {
    return;
  }

  try {
    await navigator.clipboard.writeText(selection);
    session.lastCopiedSelection = selection;
    els.settingsStatus.textContent = "Selection copied.";
  } catch {
    els.settingsStatus.textContent = "Clipboard permission blocked auto-copy.";
  }
}

function connectSession(session, mode = "connect") {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}/ssh`);
  session.socket = socket;

  socket.addEventListener("open", () => {
    if (mode === "attach") {
      socket.send(
        JSON.stringify({
          type: "attach",
          sessionId: session.id,
          cols: session.terminal.cols,
          rows: session.terminal.rows,
        }),
      );
      return;
    }

    socket.send(
      JSON.stringify({
        type: "connect",
        clientSessionId: session.id,
        connection: session.connection,
        cols: session.terminal.cols,
        rows: session.terminal.rows,
      }),
    );
  });

  socket.addEventListener("message", (event) => handleSessionMessage(session, event.data));
  socket.addEventListener("close", () => {
    if (session.socket === socket) {
      session.socket = null;
      session.connected = false;
      session.status = "Disconnected";
      renderSessions();
    }
  });
  socket.addEventListener("error", () => {
    session.terminal.writeln("\r\nUnable to connect to the local SSH server.");
    session.connected = false;
    session.status = "Error";
    renderSessions();
  });
}

function handleSessionMessage(session, data) {
  let payload;
  try {
    payload = JSON.parse(data);
  } catch {
    session.terminal.write(data);
    return;
  }

  if (payload.type === "attached") {
    session.connected = Boolean(payload.connected);
    session.status = payload.status || (payload.connected ? "Connected" : "Disconnected");
    if (payload.connection) {
      session.connection = payload.connection;
    }
    session.terminal.reset();
    if (payload.buffer) {
      session.terminal.write(payload.buffer);
    } else {
      session.terminal.writeln(session.status);
    }
    persistSessions();
    renderSessions();
  }
  if (payload.type === "missing") {
    const socket = session.socket;
    session.connected = false;
    session.status = "Unavailable";
    session.socket = null;
    session.terminal.writeln("\r\nThis SSH session is no longer available on the server.");
    socket?.close();
    persistSessions();
    renderSessions();
  }
  if (payload.type === "output") {
    session.terminal.write(payload.data);
  }
  if (payload.type === "status") {
    session.connected = Boolean(payload.connected);
    session.status = payload.connected ? "Connected" : "Disconnected";
    renderSessions();
  }
  if (payload.type === "error") {
    session.terminal.writeln(`\r\n${payload.message}`);
    session.connected = false;
    session.status = "Error";
    renderSessions();
  }
  if (payload.type === "exit") {
    session.terminal.writeln(`\r\nSession closed${Number.isInteger(payload.code) ? ` with code ${payload.code}` : ""}.`);
    session.connected = false;
    session.status = "Disconnected";
    session.socket = null;
    persistSessions();
    renderSessions();
  }
}

function renderSessions() {
  els.sessionTabs.innerHTML = "";
  const hasSessions = sessions.size > 0;
  els.terminalEmpty.classList.toggle("hidden", hasSessions);
  els.sessionTabs.classList.toggle("hidden", !hasSessions);
  els.terminalStack.classList.toggle("hidden", !hasSessions);

  for (const session of sessions.values()) {
    const tab = document.createElement("div");
    tab.className = `session-tab${session.id === activeSessionId ? " active" : ""}${session.connected ? "" : " disconnected"}`;
    tab.title = `${connectionLabel(session.connection)} - ${session.status}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(session.id === activeSessionId));
    tab.tabIndex = 0;
    tab.draggable = true;
    tab.dataset.sessionId = session.id;
    tab.addEventListener("click", () => activateSession(session.id));
    tab.addEventListener("dragstart", (event) => handleSessionDragStart(event, session.id));
    tab.addEventListener("dragover", (event) => handleSessionDragOver(event, session.id));
    tab.addEventListener("dragleave", handleSessionDragLeave);
    tab.addEventListener("drop", (event) => handleSessionDrop(event, session.id));
    tab.addEventListener("dragend", handleSessionDragEnd);
    tab.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activateSession(session.id);
      }
    });

    const title = document.createElement("span");
    title.className = "session-tab-title";
    title.textContent = session.connection.name;

    const close = document.createElement("button");
    close.type = "button";
    close.className = "session-tab-close";
    close.textContent = "x";
    close.setAttribute("aria-label", `Close ${session.connection.name}`);
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeSession(session.id);
    });

    tab.append(title, close);
    els.sessionTabs.append(tab);
    session.panel.classList.toggle("hidden", session.id !== activeSessionId);
  }

  fitActiveSession();
}

function handleSessionDragStart(event, sessionId) {
  draggedSessionId = sessionId;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", sessionId);
  event.currentTarget.classList.add("dragging");
}

function handleSessionDragOver(event, targetSessionId) {
  if (!draggedSessionId || draggedSessionId === targetSessionId) {
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  event.currentTarget.classList.add("drop-target-active");
}

function handleSessionDragLeave(event) {
  event.currentTarget.classList.remove("drop-target-active");
}

function handleSessionDrop(event, targetSessionId) {
  if (!draggedSessionId || draggedSessionId === targetSessionId) {
    return;
  }
  event.preventDefault();
  reorderSessions(draggedSessionId, targetSessionId);
  draggedSessionId = null;
}

function handleSessionDragEnd(event) {
  draggedSessionId = null;
  event.currentTarget.classList.remove("dragging");
  document.querySelectorAll(".session-tab.drop-target-active").forEach((element) => {
    element.classList.remove("drop-target-active");
  });
}

function reorderSessions(sourceSessionId, targetSessionId) {
  const ordered = Array.from(sessions.entries());
  const sourceIndex = ordered.findIndex(([id]) => id === sourceSessionId);
  const targetIndex = ordered.findIndex(([id]) => id === targetSessionId);
  if (sourceIndex < 0 || targetIndex < 0) {
    return;
  }

  const [source] = ordered.splice(sourceIndex, 1);
  ordered.splice(targetIndex, 0, source);
  sessions.clear();
  for (const [id, session] of ordered) {
    sessions.set(id, session);
  }
  persistSessions();
  renderSessions();
}

function activateSession(id) {
  if (!sessions.has(id)) {
    return;
  }
  activeSessionId = id;
  persistSessions();
  renderSessions();
  const session = sessions.get(id);
  if (session) {
    session.terminal.focus();
  }
}

function closeSession(id) {
  const session = sessions.get(id);
  if (!session) {
    return;
  }

  if (session.socket?.readyState === WebSocket.OPEN) {
    session.socket.send(JSON.stringify({ type: "disconnect" }));
    session.socket.close();
  }
  session.terminal.dispose();
  session.panel.remove();
  sessions.delete(id);

  if (activeSessionId === id) {
    activeSessionId = sessions.keys().next().value || null;
  }
  persistSessions();
  renderSessions();
}

function persistSessions() {
  const payload = {
    activeSessionId,
    items: Array.from(sessions.values()).map((session) => ({
      id: session.id,
      connection: session.connection,
    })),
  };
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
}

function restoreSessions() {
  const saved = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!saved || !window.Terminal || !window.FitAddon || location.protocol === "file:") {
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(saved);
  } catch {
    return;
  }

  if (!Array.isArray(parsed.items)) {
    return;
  }

  for (const savedSession of parsed.items) {
    if (!savedSession?.id || !savedSession.connection) {
      continue;
    }
    const session = createSession(savedSession.connection, {
      id: savedSession.id,
      initialLine: `Reattaching to ${connectionLabel(savedSession.connection)}...`,
    });
    connectSession(session, "attach");
  }

  activeSessionId = sessions.has(parsed.activeSessionId)
    ? parsed.activeSessionId
    : sessions.keys().next().value || null;
}

function fitSession(session) {
  session.fitAddon.fit();
  if (session.socket?.readyState === WebSocket.OPEN) {
    session.socket.send(
      JSON.stringify({
        type: "resize",
        cols: session.terminal.cols,
        rows: session.terminal.rows,
      }),
    );
  }
}

function fitActiveSession() {
  const session = sessions.get(activeSessionId);
  if (!session) {
    return;
  }
  requestAnimationFrame(() => fitSession(session));
}

function bindEvents() {
  els.searchInput.addEventListener("input", renderTree);
  els.settingsToggle.addEventListener("click", toggleSettings);
  els.autoCopySelectionInput.addEventListener("change", saveAutoCopySetting);
  els.rightClickPasteInput.addEventListener("change", saveRightClickPasteSetting);
  els.addFolderButton.addEventListener("click", addFolder);
  els.addConnectionButton.addEventListener("click", addConnection);
  els.connectButton.addEventListener("click", connectSelected);
  els.editButton.addEventListener("click", openEditor);
  els.closeEditorButton.addEventListener("click", closeEditor);
  els.duplicateButton.addEventListener("click", duplicateConnection);
  els.duplicateNameSelect.addEventListener("change", () => duplicateConnectionWithName(els.duplicateNameSelect.value));
  els.deleteButton.addEventListener("click", deleteSelected);
  els.connectionForm.addEventListener("submit", saveConnection);
  els.folderForm.addEventListener("submit", saveFolder);
  els.copyCommandButton.addEventListener("click", copyCommand);
  window.addEventListener("resize", fitActiveSession);

  for (const input of [els.nameInput, els.hostInput, els.portInput, els.userInput, els.passphraseInput, els.keyInput]) {
    input.addEventListener("input", () => {
      const draft = connectionDraftFromForm();
      if (!draft) {
        return;
      }
      els.editorTitle.textContent = draft.name || "Untitled connection";
      els.commandPreview.textContent = buildSshCommand(draft);
      els.saveStatus.textContent = "";
    });
  }
}

function render() {
  renderTree();
  renderDetails();
  renderSettings();
  renderSessions();
}

function toggleSettings() {
  const isHidden = els.settingsBody.classList.toggle("hidden");
  els.settingsToggle.setAttribute("aria-expanded", String(!isHidden));
}

function saveAutoCopySetting() {
  settings.autoCopySelection = els.autoCopySelectionInput.checked;
  els.settingsStatus.textContent = settings.autoCopySelection ? "Auto-copy enabled." : "Auto-copy disabled.";
  saveSettings();
}

function saveRightClickPasteSetting() {
  settings.rightClickPaste = els.rightClickPasteInput.checked;
  els.settingsStatus.textContent = settings.rightClickPaste ? "Right-click paste enabled." : "Right-click paste disabled.";
  saveSettings();
}

function renderSettings() {
  els.autoCopySelectionInput.checked = Boolean(settings.autoCopySelection);
  els.rightClickPasteInput.checked = Boolean(settings.rightClickPaste);
}

bindEvents();
restoreSessions();
render();

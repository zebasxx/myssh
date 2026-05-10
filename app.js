const STORAGE_KEY = "myssh.connections.v1";

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
      privateKey: "~/.ssh/prod_ed25519",
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
      privateKey: "~/.ssh/staging_ed25519",
      notes: "",
    },
  ],
};

const els = {
  treeRoot: document.querySelector("#treeRoot"),
  searchInput: document.querySelector("#searchInput"),
  addFolderButton: document.querySelector("#addFolderButton"),
  addConnectionButton: document.querySelector("#addConnectionButton"),
  duplicateButton: document.querySelector("#duplicateButton"),
  deleteButton: document.querySelector("#deleteButton"),
  selectionType: document.querySelector("#selectionType"),
  selectionTitle: document.querySelector("#selectionTitle"),
  selectionSubtitle: document.querySelector("#selectionSubtitle"),
  connectionForm: document.querySelector("#connectionForm"),
  folderEditor: document.querySelector("#folderEditor"),
  folderForm: document.querySelector("#folderForm"),
  folderNameInput: document.querySelector("#folderNameInput"),
  folderStatus: document.querySelector("#folderStatus"),
  editorArea: document.querySelector(".editor-area"),
  emptyState: document.querySelector("#emptyState"),
  nameInput: document.querySelector("#nameInput"),
  folderInput: document.querySelector("#folderInput"),
  hostInput: document.querySelector("#hostInput"),
  portInput: document.querySelector("#portInput"),
  userInput: document.querySelector("#userInput"),
  keyInput: document.querySelector("#keyInput"),
  notesInput: document.querySelector("#notesInput"),
  saveStatus: document.querySelector("#saveStatus"),
  commandPreview: document.querySelector("#commandPreview"),
  copyCommandButton: document.querySelector("#copyCommandButton"),
};

let state = loadState();

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
  const haystack = [item.name, item.host, item.username, item.privateKey].filter(Boolean).join(" ").toLowerCase();
  if (haystack.includes(term)) {
    return true;
  }
  return item.type === "folder" && getChildren(item.id).some((child) => matchesSearch(child, term));
}

function renderTree() {
  const term = els.searchInput.value.trim().toLowerCase();
  els.treeRoot.innerHTML = "";
  const roots = getChildren(null).filter((item) => matchesSearch(item, term));

  if (roots.length === 0) {
    const empty = document.createElement("li");
    empty.className = "tree-meta";
    empty.textContent = "No matching connections.";
    els.treeRoot.append(empty);
    return;
  }

  for (const item of roots) {
    els.treeRoot.append(renderTreeItem(item, term));
  }
}

function renderTreeItem(item, term) {
  const li = document.createElement("li");
  li.className = "tree-item";

  const button = document.createElement("button");
  button.type = "button";
  button.className = `tree-row${item.id === state.selectedId ? " selected" : ""}`;
  button.setAttribute("aria-label", `${item.type}: ${item.name}`);
  button.addEventListener("click", () => selectItem(item.id));

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
  els.emptyState.classList.toggle("hidden", hasSelection);
  els.editorArea.classList.toggle("hidden", !hasSelection || item?.type !== "connection");
  els.folderEditor.classList.toggle("hidden", !hasSelection || item?.type !== "folder");
  els.duplicateButton.classList.toggle("hidden", !hasSelection || item?.type !== "connection");
  els.deleteButton.classList.toggle("hidden", !hasSelection);

  if (!item) {
    els.selectionType.textContent = "Ready";
    els.selectionTitle.textContent = "No item selected";
    els.selectionSubtitle.textContent = "Create a folder or connection to begin.";
    return;
  }

  els.selectionType.textContent = item.type;
  els.selectionTitle.textContent = item.name;

  if (item.type === "folder") {
    els.selectionSubtitle.textContent = `${getChildren(item.id).length} saved item${getChildren(item.id).length === 1 ? "" : "s"}`;
    els.folderNameInput.value = item.name;
    return;
  }

  renderFolderOptions();
  els.selectionSubtitle.textContent = connectionLabel(item);
  els.nameInput.value = item.name || "";
  els.folderInput.value = item.parentId || "";
  els.hostInput.value = item.host || "";
  els.portInput.value = item.port || 22;
  els.userInput.value = item.username || "";
  els.keyInput.value = item.privateKey || "";
  els.notesInput.value = item.notes || "";
  renderCommand();
}

function connectionLabel(item) {
  const userPrefix = item.username ? `${item.username}@` : "";
  return `${userPrefix}${item.host || "host"}:${item.port || 22}`;
}

function buildSshCommand(item) {
  const port = item.port || 22;
  const userPrefix = item.username ? `${item.username}@` : "";
  const host = item.host || "example.com";
  const key = item.privateKey || "~/.ssh/id_ed25519";
  return `ssh -i ${shellQuote(key)} -p ${port} ${userPrefix}${host}`;
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./~:@=-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function renderCommand() {
  const item = selectedItem();
  els.commandPreview.textContent = item?.type === "connection" ? buildSshCommand(item) : "";
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
    privateKey: "~/.ssh/id_ed25519",
    notes: "",
  };
  state.items.push(connection);
  selectItem(connection.id);
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

  const copy = {
    ...item,
    id: createId("conn"),
    name: `${item.name} copy`,
  };
  state.items.push(copy);
  selectItem(copy.id);
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
  saveState();
  render();
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
  item.privateKey = els.keyInput.value.trim();
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
  const item = selectedItem();
  if (!item || item.type !== "connection") {
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

function bindEvents() {
  els.searchInput.addEventListener("input", renderTree);
  els.addFolderButton.addEventListener("click", addFolder);
  els.addConnectionButton.addEventListener("click", addConnection);
  els.duplicateButton.addEventListener("click", duplicateConnection);
  els.deleteButton.addEventListener("click", deleteSelected);
  els.connectionForm.addEventListener("submit", saveConnection);
  els.folderForm.addEventListener("submit", saveFolder);
  els.copyCommandButton.addEventListener("click", copyCommand);

  for (const input of [els.nameInput, els.hostInput, els.portInput, els.userInput, els.keyInput]) {
    input.addEventListener("input", () => {
      const item = selectedItem();
      if (!item || item.type !== "connection") {
        return;
      }
      const preview = {
        ...item,
        name: els.nameInput.value,
        host: els.hostInput.value,
        port: Number(els.portInput.value) || 22,
        username: els.userInput.value,
        privateKey: els.keyInput.value,
      };
      els.selectionTitle.textContent = preview.name || "Untitled connection";
      els.selectionSubtitle.textContent = connectionLabel(preview);
      els.commandPreview.textContent = buildSshCommand(preview);
      els.saveStatus.textContent = "";
    });
  }
}

function render() {
  renderTree();
  renderDetails();
}

bindEvents();
render();

# MySSH

A small local SSH connection manager. It stores folders and connection settings in browser `localStorage` and opens SSH sessions in an embedded terminal through a local Node server.

## Run

### Local Node

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

### Docker Compose

```bash
docker compose up --build
```

Then open `http://localhost:3000`.

Paste the full private key content into the connection editor. If the key is encrypted, you can also save its passphrase in the optional key passphrase field. The server writes the key to a temporary `0600` file inside the container only while the SSH session is starting, answers the key passphrase prompt when needed, and removes the temporary key when the session closes.

Connection data is stored in browser `localStorage`, including embedded keys and saved passphrases. Use this only on a trusted local machine and browser profile.

The compose setup uses a named volume at `/home/node/.ssh` so SSH can persist metadata such as `known_hosts`. It does not need access to private key files on the host.

New SSH host keys are accepted automatically with OpenSSH `StrictHostKeyChecking=accept-new`. Changed host keys still fail, as they should.

Open terminal tabs are restored after a browser refresh or after closing and reopening the browser while the Docker container is still running. Detached SSH sessions stay alive on the server for 30 minutes by default; restarting the container ends them.

## Features

- Folder tree for organizing SSH connections
- Connection editor with name, DNS/IP, port, username, embedded private key, and optional key passphrase
- SSH command preview with copy action
- Tabbed embedded terminals for multiple simultaneous SSH sessions
- Browser refresh reattaches to active SSH tabs while the server process is still running
- Setting to copy selected terminal text to the clipboard automatically
- Setting to paste clipboard text into the active terminal with right click
- Duplicate and delete actions
- Search across names, hosts, and usernames

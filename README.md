# MySSH

A multi-user enterprise SSH connection manager with Microsoft Entra ID (Azure AD) authentication. It securely stores encrypted SSH credentials in PostgreSQL and provides browser-based terminal access to SSH hosts.

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Microsoft Entra ID tenant
- HTTPS-enabled domain (for production)

### Setup

1. **Register Azure AD App** - See [docs/SETUP.md](docs/SETUP.md) for detailed instructions
2. **Configure environment** - Copy `.env.example` to `.env` and fill in your values
3. **Start services**:

```bash
docker compose up -d
```

4. **Access**: Navigate to your configured URL (e.g., `https://myssh.argostranslations.com`)
5. **Login**: Sign in with Microsoft

### Security

- **Private keys encrypted at rest** using AES-256-GCM with per-user derived keys
- **Microsoft Entra ID authentication** with session-based cookies
- **User isolation** - each user can only access their own connections
- **Audit logging** for compliance tracking
- **HTTPS required** in production

The compose setup uses:
- **PostgreSQL volume** for encrypted connection storage
- **SSH metadata volume** at `/home/node/.ssh` for `known_hosts` persistence
- **Named volumes** persist across container restarts

New SSH host keys are accepted automatically with OpenSSH `StrictHostKeyChecking=accept-new`. Changed host keys still fail, as they should.

Open terminal tabs are restored after a browser refresh while the server is still running. Detached SSH sessions stay alive for 30 minutes by default.

## Features

### Authentication & Security
- **Microsoft Entra ID (Azure AD) SSO** - Enterprise authentication
- **Encrypted storage** - Private keys encrypted at rest with AES-256-GCM
- **Per-user encryption keys** - Derived from user identity
- **User isolation** - Complete data separation between users
- **Audit logging** - Track all authentication and SSH connections
- **Session management** - Secure cookie-based sessions

### SSH Management
- **Folder tree** for organizing SSH connections
- **Connection editor** with host, port, username, private key, and passphrase
- **SSH command preview** with copy action
- **Tabbed terminals** for multiple simultaneous SSH sessions
- **Session persistence** - Reattach to active sessions after browser refresh
- **Auto-passphrase** - Encrypted passphrases auto-submitted to SSH
- **Search** across names, hosts, and usernames
- **Duplicate** connections with smart naming

### Terminal Features
- **xterm.js** - Full-featured browser terminal
- **Auto-copy selection** - Optional automatic clipboard copy
- **Right-click paste** - Optional clipboard paste on right-click
- **Responsive design** - Scales to browser window

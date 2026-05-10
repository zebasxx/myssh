# MySSH Setup Guide

## Prerequisites

- Docker and Docker Compose
- Microsoft Entra ID (Azure AD) tenant access
- Domain with HTTPS configured (e.g., myssh.argostranslations.com)

---

## Step 1: Register Application in Microsoft Entra ID

### 1.1 Create App Registration

1. **Go to Azure Portal**: https://portal.azure.com
2. **Navigate to**: Microsoft Entra ID → App registrations
3. **Click**: "New registration"

### 1.2 Configure Basic Settings

- **Name**: `MySSH` (or your preferred name)
- **Supported account types**: 
  - Select: "Accounts in this organizational directory only (Single tenant)"
- **Redirect URI**:
  - Platform: **Web**
  - URI: `https://myssh.argostranslations.com/auth/callback`
- **Click**: "Register"

### 1.3 Copy Application Details

After registration, you'll see the Overview page. **Copy these values** (you'll need them for the `.env` file):

- **Application (client) ID** → This is your `ENTRA_CLIENT_ID`
- **Directory (tenant) ID** → This is your `ENTRA_TENANT_ID`

### 1.4 Create Client Secret

1. In the left menu, go to: **Certificates & secrets**
2. Click: **New client secret**
3. **Description**: `MySSH Production`
4. **Expires**: Choose duration (recommend 24 months)
5. Click: **Add**
6. **⚠️ IMPORTANT**: Copy the **Value** immediately - it won't be shown again
   - This is your `ENTRA_CLIENT_SECRET`

### 1.5 Verify API Permissions

1. In the left menu, go to: **API permissions**
2. Verify these permissions are present (should be added automatically):
   - Microsoft Graph → Delegated permissions:
     - ✅ `User.Read`
     - ✅ `profile`
     - ✅ `email`
     - ✅ `openid`

If not present, click "Add a permission" → Microsoft Graph → Delegated permissions, and add them.

---

## Step 2: Configure Environment Variables

### 2.1 Create `.env` File

Copy the example file:

```bash
cd /home/seb/Code/GitHub/myssh
cp .env.example .env
```

### 2.2 Edit `.env` with Your Values

Open `.env` and fill in your values:

```bash
# PostgreSQL Database Configuration
POSTGRES_PASSWORD=YourSecurePasswordHere123!

# Microsoft Entra ID (Azure AD) Configuration
ENTRA_CLIENT_ID=your-client-id-from-azure
ENTRA_CLIENT_SECRET=your-client-secret-from-azure
ENTRA_TENANT_ID=your-tenant-id-from-azure
ENTRA_REDIRECT_URI=https://myssh.argostranslations.com/auth/callback

# Session Management
# Generate with: openssl rand -hex 32
SESSION_SECRET=generate-random-secret-here

# Application Configuration
BASE_URL=https://myssh.argostranslations.com
NODE_ENV=production
```

### 2.3 Generate Session Secret

Generate a secure random session secret:

```bash
openssl rand -hex 32
```

Copy the output and use it for `SESSION_SECRET` in your `.env` file.

---

## Step 3: Configure Company Proxy

Since you're using `https://myssh.argostranslations.com` with a company proxy forwarding to port 3000:

### 3.1 Proxy Configuration

Configure your proxy to:
- **Public URL**: `https://myssh.argostranslations.com`
- **Backend**: `http://localhost:3000` (or your server IP)
- **Headers to forward**:
  - `X-Forwarded-For` (client IP)
  - `X-Forwarded-Proto` (https)
  - `Host`

### 3.2 Example (Nginx)

If using Nginx:

```nginx
server {
    listen 443 ssl;
    server_name myssh.argostranslations.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

---

## Step 4: Deploy with Docker Compose

### 4.1 Start Services

```bash
docker-compose up -d
```

This will:
- Start PostgreSQL database
- Run database migrations automatically
- Start MySSH application server

### 4.2 Check Logs

```bash
# View all logs
docker-compose logs -f

# View only MySSH logs
docker-compose logs -f myssh

# View only PostgreSQL logs
docker-compose logs -f postgres
```

### 4.3 Verify Health

```bash
curl http://localhost:3000/health
# Should return: OK
```

---

## Step 5: Access the Application

1. **Open browser**: Navigate to `https://myssh.argostranslations.com`
2. **Login**: Click "Sign in with Microsoft"
3. **Authenticate**: Login with your Microsoft account
4. **First login**: Your user account will be automatically created

---

## Troubleshooting

### Issue: "Redirect URI mismatch"

**Cause**: The redirect URI in Azure doesn't match your configured URI.

**Solution**:
1. Verify `ENTRA_REDIRECT_URI` in `.env` matches exactly what's in Azure
2. In Azure Portal → App registrations → Authentication → Redirect URIs
3. Ensure `https://myssh.argostranslations.com/auth/callback` is listed

### Issue: "AADSTS50011: The reply url specified in the request does not match"

**Cause**: Same as above.

**Solution**: Check for trailing slashes, http vs https, exact domain match.

### Issue: Database connection failed

**Cause**: PostgreSQL not ready or wrong credentials.

**Solution**:
```bash
# Check PostgreSQL is running
docker-compose ps

# Check PostgreSQL logs
docker-compose logs postgres

# Verify password in .env matches docker-compose.yml
```

### Issue: "Authentication failed" after login

**Cause**: Possibly invalid client secret or configuration.

**Solution**:
1. Check MySSH logs: `docker-compose logs myssh`
2. Verify all Entra ID values in `.env`
3. Regenerate client secret in Azure if expired

### Issue: WebSocket connection fails

**Cause**: Proxy not configured for WebSocket upgrade.

**Solution**:
- Ensure proxy forwards `Upgrade` and `Connection` headers
- Check proxy logs for WebSocket upgrade requests

---

## Security Considerations

### Production Checklist

- ✅ **HTTPS only** - Never use HTTP in production
- ✅ **Secure session secret** - Use strong random value (32+ chars)
- ✅ **Strong database password** - Use complex password
- ✅ **Firewall rules** - Only expose port 3000 to proxy, not public
- ✅ **Backup database** - Regular PostgreSQL backups
- ✅ **Monitor logs** - Check audit logs regularly
- ✅ **Update dependencies** - Keep Docker images and npm packages updated

### Backup Database

```bash
# Create backup
docker-compose exec postgres pg_dump -U myssh myssh > backup_$(date +%Y%m%d).sql

# Restore backup
docker-compose exec -T postgres psql -U myssh myssh < backup_20260510.sql
```

---

## User Management

### View Users

```bash
docker-compose exec postgres psql -U myssh -d myssh -c "SELECT email, display_name, last_login_at FROM users;"
```

### View Audit Logs

```bash
docker-compose exec postgres psql -U myssh -d myssh -c "SELECT action, email, created_at FROM audit_logs JOIN users ON audit_logs.user_id = users.id ORDER BY created_at DESC LIMIT 20;"
```

---

## Maintenance

### Update Application

```bash
# Pull latest code
git pull

# Rebuild and restart
docker-compose down
docker-compose up --build -d
```

### View Database Size

```bash
docker-compose exec postgres psql -U myssh -d myssh -c "SELECT pg_size_pretty(pg_database_size('myssh'));"
```

### Clean Old Audit Logs (older than 90 days)

```bash
docker-compose exec postgres psql -U myssh -d myssh -c "DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '90 days';"
```

---

## Support

For issues or questions:
- Check logs: `docker-compose logs -f`
- Review audit logs in database
- Verify Azure AD configuration
- Check firewall/proxy settings

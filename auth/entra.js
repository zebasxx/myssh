const msal = require("@azure/msal-node");

const msalConfig = {
  auth: {
    clientId: process.env.ENTRA_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}`,
    clientSecret: process.env.ENTRA_CLIENT_SECRET,
  },
  system: {
    loggerOptions: {
      loggerCallback(loglevel, message) {
        if (process.env.NODE_ENV !== "production") {
          console.log(message);
        }
      },
      piiLoggingEnabled: false,
      logLevel: process.env.NODE_ENV === "production" ? msal.LogLevel.Warning : msal.LogLevel.Info,
    },
  },
};

const confidentialClient = new msal.ConfidentialClientApplication(msalConfig);

/**
 * Generates authorization URL for OAuth flow
 * @param {string} state - Random state parameter for CSRF protection
 * @returns {Promise<string>} Authorization URL
 */
async function getAuthUrl(state) {
  const authCodeUrlParameters = {
    scopes: ["user.read", "profile", "email", "openid"],
    redirectUri: process.env.ENTRA_REDIRECT_URI,
    state,
  };
  return confidentialClient.getAuthCodeUrl(authCodeUrlParameters);
}

/**
 * Exchanges authorization code for access token and user info
 * @param {string} code - Authorization code from callback
 * @returns {Promise<Object>} Token response with account info
 */
async function acquireTokenByCode(code) {
  const tokenRequest = {
    code,
    scopes: ["user.read", "profile", "email", "openid"],
    redirectUri: process.env.ENTRA_REDIRECT_URI,
  };
  return confidentialClient.acquireTokenByCode(tokenRequest);
}

module.exports = { getAuthUrl, acquireTokenByCode };

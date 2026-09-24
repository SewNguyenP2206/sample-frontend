const responseBody = document.querySelector('#response-body code');
const responseTitle = document.querySelector('#response-title');
const statusBadge = document.querySelector('#status-badge');
const responseMeta = document.querySelector('#response-meta');

const cognitoConfig = window.COGNITO_CONFIG || {};
const API_BASE_URL = 'https://api.sewtech.site';
const getProductForm = document.querySelector('#get-product-form');
const createProductForm = document.querySelector('#create-product-form');
const updateProductForm = document.querySelector('#update-product-form');
const deleteProductForm = document.querySelector('#delete-product-form');
const authStatusEl = document.querySelector('#auth-status');
const loginButton = document.querySelector('#login-button');
const logoutButton = document.querySelector('#logout-button');

// ---------------------------------------------------------------------------
// Token storage helpers
// ---------------------------------------------------------------------------
// Tokens are kept in sessionStorage (cleared automatically when the tab is
// closed) so they survive full page reloads but are NOT wiped right after
// being obtained. This is what actually lets the app "use" the token to
// call the API instead of just showing it once and losing it.

const STORAGE_KEYS = {
  access: 'cognito_access_token',
  id: 'cognito_id_token',
  refresh: 'cognito_refresh_token',
  expiresAt: 'cognito_expires_at',
  state: 'cognito_oauth_state',
  verifier: 'cognito_pkce_verifier'
};

function saveTokens(tokens) {
  if (tokens.access_token) sessionStorage.setItem(STORAGE_KEYS.access, tokens.access_token);
  if (tokens.id_token) sessionStorage.setItem(STORAGE_KEYS.id, tokens.id_token);
  if (tokens.refresh_token) sessionStorage.setItem(STORAGE_KEYS.refresh, tokens.refresh_token);
  if (tokens.expires_in) {
    const expiresAt = Date.now() + Number(tokens.expires_in) * 1000;
    sessionStorage.setItem(STORAGE_KEYS.expiresAt, String(expiresAt));
  }
}

function getStoredTokens() {
  return {
    access_token: sessionStorage.getItem(STORAGE_KEYS.access) || '',
    id_token: sessionStorage.getItem(STORAGE_KEYS.id) || '',
    refresh_token: sessionStorage.getItem(STORAGE_KEYS.refresh) || '',
    expiresAt: Number(sessionStorage.getItem(STORAGE_KEYS.expiresAt) || 0)
  };
}

function clearTokens() {
  Object.values(STORAGE_KEYS).forEach((key) => sessionStorage.removeItem(key));
}

function isAuthenticated() {
  const { access_token } = getStoredTokens();
  return Boolean(access_token);
}

function isAccessTokenExpired() {
  const { expiresAt } = getStoredTokens();
  if (!expiresAt) return false;
  // Refresh a little bit early (30s buffer).
  return Date.now() > expiresAt - 30000;
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function encodeBase64Url(bytes) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function generatePkcePair() {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = encodeBase64Url(verifierBytes);
  const challengeBytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  );
  const challenge = encodeBase64Url(challengeBytes);

  return { verifier, challenge };
}

function buildAuthorizeUrl(state, codeChallenge) {
  const domain = (cognitoConfig.domain || '').replace(/\/$/, '');
  const clientId = cognitoConfig.clientId || cognitoConfig.client_id || '';
  const redirectUri = cognitoConfig.redirectUri || `${window.location.origin}/callback`;
  const scope = cognitoConfig.scope || 'openid email phone profile';

  // Cognito Hosted UI authorize endpoint (works for both classic Hosted UI
  // and the newer Managed Login).
  const authorizeUrl = new URL(`${domain}/oauth2/authorize`);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', scope);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  return authorizeUrl.toString();
}

function buildLogoutUrl() {
  const domain = (cognitoConfig.domain || '').replace(/\/$/, '');
  const clientId = cognitoConfig.clientId || cognitoConfig.client_id || '';
  const logoutUri = cognitoConfig.logoutUri || window.location.origin;

  const logoutUrl = new URL(`${domain}/logout`);
  logoutUrl.searchParams.set('client_id', clientId);
  logoutUrl.searchParams.set('logout_uri', logoutUri);

  return logoutUrl.toString();
}

async function exchangeCodeForTokens(code, codeVerifier) {
  const tokenEndpoint = `${(cognitoConfig.domain || '').replace(/\/$/, '')}/oauth2/token`;
  const clientId = cognitoConfig.clientId || cognitoConfig.client_id || '';
  const redirectUri = cognitoConfig.redirectUri || `${window.location.origin}/callback`;

  if (!codeVerifier) {
    throw new Error('Missing PKCE code verifier for token exchange.');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier
  });

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  const rawBody = await response.text();

  if (!response.ok) {
    throw new Error(rawBody || `Cognito token exchange failed (${response.status})`);
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error(`Invalid token response from Cognito: ${rawBody}`);
  }
}

async function refreshAccessToken() {
  const { refresh_token } = getStoredTokens();
  if (!refresh_token) return false;

  const tokenEndpoint = `${(cognitoConfig.domain || '').replace(/\/$/, '')}/oauth2/token`;
  const clientId = cognitoConfig.clientId || cognitoConfig.client_id || '';

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token
  });

  try {
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    if (!response.ok) return false;

    const tokens = await response.json();
    // Cognito does not always return a new refresh_token; keep the old one.
    saveTokens({ ...tokens, refresh_token: tokens.refresh_token || refresh_token });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Auth UI
// ---------------------------------------------------------------------------

function updateAuthUI() {
  if (isAuthenticated()) {
    authStatusEl.textContent = 'SIGNED IN';
    authStatusEl.className = 'auth-status signed-in';
    loginButton.hidden = true;
    logoutButton.hidden = false;
  } else {
    authStatusEl.textContent = 'SIGNED OUT';
    authStatusEl.className = 'auth-status';
    loginButton.hidden = false;
    logoutButton.hidden = true;
  }
}

async function startLogin() {
  const state = crypto.getRandomValues(new Uint8Array(16))
    .reduce((acc, byte) => acc + byte.toString(16).padStart(2, '0'), '');
  const { verifier, challenge } = await generatePkcePair();

  sessionStorage.setItem(STORAGE_KEYS.state, state);
  sessionStorage.setItem(STORAGE_KEYS.verifier, verifier);

  window.location.assign(buildAuthorizeUrl(state, challenge));
}

function logout() {
  clearTokens();
  window.location.assign(buildLogoutUrl());
}

async function handleAuthCallback(callbackCode, callbackState) {
  const storedState = sessionStorage.getItem(STORAGE_KEYS.state);
  const codeVerifier = sessionStorage.getItem(STORAGE_KEYS.verifier);

  if (!storedState || !callbackState || storedState !== callbackState) {
    throw new Error('Invalid Cognito callback state. Please try logging in again.');
  }

  const tokens = await exchangeCodeForTokens(callbackCode, codeVerifier);
  saveTokens(tokens);

  sessionStorage.removeItem(STORAGE_KEYS.state);
  sessionStorage.removeItem(STORAGE_KEYS.verifier);

  // Strip the ?code=...&state=... query params from the URL.
  window.history.replaceState({}, '', window.location.pathname);
}

async function initializeAuthentication() {
  const callbackParams = new URLSearchParams(window.location.search);
  const callbackCode = callbackParams.get('code');
  const callbackError = callbackParams.get('error');
  const callbackState = callbackParams.get('state');

  try {
    if (callbackError) {
      throw new Error(callbackError);
    }

    if (callbackCode) {
      await handleAuthCallback(callbackCode, callbackState);
    }
  } catch (error) {
    responseTitle.textContent = 'Cognito callback error';
    responseBody.className = '';
    responseBody.textContent = `// Failed to process Cognito callback\n// error: ${error.message}`;
    showMeta('ERROR', '--', 'oauth');
    statusBadge.className = 'status-badge error';
    statusBadge.textContent = 'ERROR';
  }

  updateAuthUI();
}

// ---------------------------------------------------------------------------
// Response panel rendering
// ---------------------------------------------------------------------------

function showMeta(status, duration, type) {
  responseMeta.innerHTML = `<span>STATUS <b>${status}</b></span><span>TIME <b>${duration} ms</b></span><span>TYPE <b>${type}</b></span>`;
}

function formatBody(rawBody) {
  if (!rawBody) {
    return '// Empty response body';
  }

  try {
    return JSON.stringify(JSON.parse(rawBody), null, 2);
  } catch {
    return rawBody;
  }
}

function setLoadingState(method, path) {
  statusBadge.className = 'status-badge';
  statusBadge.textContent = 'WAITING';
  responseTitle.textContent = `Calling ${method} ${path}...`;
  responseBody.className = 'loading';
  responseBody.textContent = `// ${method} ${path}\n// Waiting for response...`;
  showMeta('--', '--', '--');
}

function setResponseState(ok, status, title, rawBody, type, duration) {
  const body = formatBody(rawBody);
  statusBadge.className = `status-badge ${ok ? 'success' : 'error'}`;
  statusBadge.textContent = ok ? 'OK' : 'ERROR';
  responseTitle.textContent = title;
  responseBody.className = '';
  responseBody.textContent = body;
  showMeta(`${status}`, duration, type);
}

// ---------------------------------------------------------------------------
// API calls (now with the Cognito access token attached)
// ---------------------------------------------------------------------------

function buildApiUrl(path) {
  if (!path) return API_BASE_URL;

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return new URL(path.replace(/^\/+/, ''), `${API_BASE_URL}/`).toString();
}

async function callApi({ method, path, body, successTitle }, isRetry = false) {
  const startedAt = performance.now();
  setLoadingState(method, path);

  // Proactively refresh the access token if it is about to expire.
  if (isAuthenticated() && isAccessTokenExpired() && !isRetry) {
    await refreshAccessToken();
  }

  try {
    const options = { method, headers: {} };

    if (body !== undefined && body !== null) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    const { access_token } = getStoredTokens();
    if (access_token) {
      options.headers['Authorization'] = `Bearer ${access_token}`;
    }

    const response = await fetch(buildApiUrl(path), options);

    // If the token was rejected, try refreshing once and retry the call.
    if (response.status === 401 && !isRetry) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        return callApi({ method, path, body, successTitle }, true);
      }
    }

    const duration = Math.round(performance.now() - startedAt);
    const type = response.headers.get('content-type')?.split(';')[0] || 'unknown';
    const rawBody = await response.text();

    setResponseState(
      response.ok,
      `${response.status} ${response.statusText}`,
      response.ok ? (successTitle || 'Request succeeded') : 'Request returned an error',
      rawBody,
      type,
      duration
    );

    return { ok: response.ok, status: response.status, data: rawBody };
  } catch (error) {
    const duration = Math.round(performance.now() - startedAt);
    statusBadge.className = 'status-badge error';
    statusBadge.textContent = 'FAILED';
    responseTitle.textContent = 'Could not reach backend';
    responseBody.className = '';
    responseBody.textContent = `// ${error.message}\n// Check that the backend server is running and the gateway can proxy requests.`;
    showMeta('NETWORK', duration, 'fetch error');
    return { ok: false, status: 'NETWORK', data: null };
  }
}

async function loadProducts() {
  await callApi({ method: 'GET', path: '/api/products', successTitle: 'Loaded all products' });
}

async function getProductById(event) {
  event.preventDefault();
  const id = document.querySelector('#product-id-read').value.trim();

  if (!id) {
    statusBadge.className = 'status-badge error';
    statusBadge.textContent = 'MISSING';
    responseTitle.textContent = 'Product ID is required';
    responseBody.className = '';
    responseBody.textContent = '// Enter a product id to fetch details.';
    showMeta('INPUT', '--', '--');
    return;
  }

  await callApi({ method: 'GET', path: `/api/products/${id}`, successTitle: `Loaded product ${id}` });
}

async function createProduct(event) {
  event.preventDefault();

  const payload = {
    name: document.querySelector('#create-name').value.trim(),
    price: Number(document.querySelector('#create-price').value),
    stock: Number(document.querySelector('#create-stock').value),
    description: document.querySelector('#create-description').value.trim()
  };

  await callApi({ method: 'POST', path: '/api/products', body: payload, successTitle: 'Product created' });
}

async function updateProduct(event) {
  event.preventDefault();

  const id = document.querySelector('#update-id').value.trim();
  const payload = {
    name: document.querySelector('#update-name').value.trim(),
    price: Number(document.querySelector('#update-price').value),
    stock: Number(document.querySelector('#update-stock').value),
    description: document.querySelector('#update-description').value.trim()
  };

  await callApi({ method: 'PUT', path: `/api/products/${id}`, body: payload, successTitle: `Product ${id} updated` });
}

async function deleteProduct(event) {
  event.preventDefault();
  const id = document.querySelector('#delete-id').value.trim();

  if (!id) {
    statusBadge.className = 'status-badge error';
    statusBadge.textContent = 'MISSING';
    responseTitle.textContent = 'Product ID is required';
    responseBody.className = '';
    responseBody.textContent = '// Enter a product id to delete.';
    showMeta('INPUT', '--', '--');
    return;
  }

  await callApi({ method: 'DELETE', path: `/api/products/${id}`, successTitle: `Product ${id} deleted` });
}

async function checkHealth() {
  await callApi({ method: 'GET', path: '/health', successTitle: 'Gateway health check passed' });
}

document.querySelector('#load-products').addEventListener('click', loadProducts);
document.querySelector('#health-check').addEventListener('click', checkHealth);
getProductForm.addEventListener('submit', getProductById);
createProductForm.addEventListener('submit', createProduct);
updateProductForm.addEventListener('submit', updateProduct);
deleteProductForm.addEventListener('submit', deleteProduct);
loginButton.addEventListener('click', startLogin);
logoutButton.addEventListener('click', logout);

initializeAuthentication();
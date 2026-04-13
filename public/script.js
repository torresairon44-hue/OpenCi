// ═══════════════════════════════════════════════════════════════════
// OpenCI - Frontend Application Logic
// ═══════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────
// STATE MANAGEMENT
// ───────────────────────────────────────────────────────────────────
let currentConversationId = null;
let currentUserName = 'User';
let currentUserRole = 'Identifying...';
let currentUserLocation = 'Searching...';
let isLoading = false;
let autoScroll = true;
let isLoggedIn = false;
let currentUserId = null; // Set after successful Lark login
let currentUserLarkAvatarUrl = null;
let currentUserCustomAvatarUrl = null;
let currentUserAvatarSource = 'default';
let pendingProfilePhotoFile = null;
let pendingProfilePhotoPreviewUrl = null;
let anonymousHistory = [];
let pendingSuggestedPrompt = false;
let pendingImages = [];
const LANDING_STATE_FADE_MS = 280;
const DEFAULT_CHAT_TITLE = 'OpenCI Help Desk';
const LOCATION_CACHE_KEY = 'lastKnownLocationPayload';
const LOCATION_CACHE_TTL_MS = 2 * 60 * 1000;
const LOCATION_REFRESH_COOLDOWN_MS = 1500;
const MANUAL_PRECISE_ACCURACY_METERS = 80;
const MANUAL_PRECISION_WAIT_MS = 5000;
const USER_AVATAR_LARK_KEY = 'userAvatarLarkUrl';
const USER_AVATAR_CUSTOM_KEY = 'userAvatarCustomUrl';
const USER_AVATAR_SOURCE_KEY = 'userAvatarSource';
let aiServiceHardBlocked = false;
let aiServiceBlockReason = '';
let sessionHeartbeatTimer = null;
let sessionHeartbeatBootstrapTimer = null;
let locationWatchId = null; // For continuous GPS tracking
let lastSyncedLocationPayload = null; // Track last synced location to avoid redundant updates
let shouldResetLocationOnNextSync = false;
let locationRefreshInFlight = false;
let activeLocationRequestId = 0;
let lastManualLocationRefreshAtMs = 0;
let queuedManualRefresh = false;
let queuedManualRefreshTimer = null;
let manualPrecisionDeadlineMs = 0;
let manualPrecisionTimeoutTimer = null;
let lastSessionSyncAtMs = 0;

// ───────────────────────────────────────────────────────────────────
// DOM ELEMENTS
// ───────────────────────────────────────────────────────────────────
const messagesContainer = document.getElementById('messagesContainer');
const messagesWrapper = document.getElementById('messagesWrapper');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const messageForm = document.getElementById('messageForm');
const attachImageBtn = document.getElementById('attachImageBtn');
const attachMenu = document.getElementById('attachMenu');
const addFilesBtn = document.getElementById('addFilesBtn');
const imageInput = document.getElementById('imageInput');
const imagePreview = document.getElementById('imagePreview');
const imagePreviewThumb = document.getElementById('imagePreviewThumb');
const imagePreviewName = document.getElementById('imagePreviewName');
const removeImageBtn = document.getElementById('removeImageBtn');
const conversationsList = document.getElementById('conversationsList');
const newChatBtn = document.getElementById('newChatBtn');
const hamburgerToggle = document.getElementById('hamburgerToggle');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
const sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn');
const sidebarExpandBtn = document.getElementById('sidebarExpandBtn');
const settingsModal = document.getElementById('settingsModal');
const larkLoginModal = document.getElementById('larkLoginModal');
const larkLoginBackdrop = document.getElementById('larkLoginBackdrop');
const larkLoginContinueBtn = document.getElementById('larkLoginContinueBtn');
const authRejectOverlay = document.getElementById('authRejectOverlay');
const authRejectBackBtn = document.getElementById('authRejectBackBtn');
const profileName = document.getElementById('profileName');
const profileRole = document.getElementById('profileRole');
const profileLocation = document.getElementById('profileLocation');
const adminDashboardProfileItem = document.getElementById('adminDashboardProfileItem');
const adminDashboardProfileLink = document.getElementById('adminDashboardProfileLink');
const reloadLocationBtn = document.getElementById('reloadLocationBtn');
const chatTitle = document.getElementById('chatTitle');
const chatSubtitle = document.getElementById('chatSubtitle');
const profileToggleBtn = document.getElementById('profileToggleBtn');
const profileContent = document.getElementById('profileContent');
const userName = document.getElementById('userName');
const userEmail = document.getElementById('userEmail');
const themeSelect = document.getElementById('themeSelect');
const autoScrollCheck = document.getElementById('autoScrollCheck');
const notificationsCheck = document.getElementById('notificationsCheck');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const clearConversationsBtn = document.getElementById('clearConversationsBtn');
const exportDataBtn = document.getElementById('exportDataBtn');
const requestAdminAccessBtn = document.getElementById('requestAdminAccessBtn');
const modalOverlay = document.getElementById('modalOverlay');
const settingsBtn = document.getElementById('settingsBtn');
const accountMenu = document.getElementById('accountMenu');
const accountMenuTrigger = document.getElementById('accountMenuTrigger');
const accountMenuDrawer = document.getElementById('accountMenuDrawer');
const accountMenuChevron = document.getElementById('accountMenuChevron');
const accountMenuName = document.getElementById('accountMenuName');
const accountMenuSubtitle = document.getElementById('accountMenuSubtitle');
const accountMenuAvatarImg = document.getElementById('accountMenuAvatarImg');
const accountDashboardLink = document.getElementById('accountDashboardLink');
const accountRequestAdminBtn = document.getElementById('accountRequestAdminBtn');
const accountSettingsBtn = document.getElementById('accountSettingsBtn');
const accountLogoutBtn = document.getElementById('accountLogoutBtn');
const sidebarProfileAvatarImg = document.getElementById('sidebarProfileAvatarImg');
const sidebarProfileAvatarFallback = document.getElementById('sidebarProfileAvatarFallback');
const sidebarProfileAvatarSource = document.getElementById('sidebarProfileAvatarSource');
const settingsProfileAvatarImg = document.getElementById('settingsProfileAvatarImg');
const settingsProfileAvatarFallback = document.getElementById('settingsProfileAvatarFallback');
const profilePhotoInput = document.getElementById('profilePhotoInput');
const uploadProfilePhotoBtn = document.getElementById('uploadProfilePhotoBtn');
const removeProfilePhotoBtn = document.getElementById('removeProfilePhotoBtn');
const profilePhotoHelpText = document.getElementById('profilePhotoHelpText');

function setVisibleChatTitle(title) {
  if (!chatTitle) return;
  if (isLoggedIn) {
    chatTitle.textContent = DEFAULT_CHAT_TITLE;
    return;
  }

  chatTitle.textContent = title && title.trim() ? title : DEFAULT_CHAT_TITLE;
}

function setComposerEnabled(enabled) {
  messageInput.disabled = !enabled;
  sendBtn.disabled = !enabled;
  if (attachImageBtn) {
    attachImageBtn.disabled = !enabled;
  }
}

function openLarkLoginModal() {
  if (!larkLoginModal) return;
  larkLoginModal.removeAttribute('hidden');
}

function closeLarkLoginModal() {
  if (!larkLoginModal) return;
  larkLoginModal.setAttribute('hidden', '');
}

function showAuthRejectOverlay() {
  if (!authRejectOverlay) return;
  closeLarkLoginModal();
  authRejectOverlay.removeAttribute('hidden');
}

function hideAuthRejectOverlay() {
  if (!authRejectOverlay) return;
  authRejectOverlay.setAttribute('hidden', '');
}

async function buildHttpError(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch (_err) {
    payload = null;
  }

  const details = payload?.error || payload?.message || (Array.isArray(payload?.errors) && payload.errors[0]?.msg) || '';
  const error = new Error(`HTTP error! status: ${response.status}${details ? ` - ${details}` : ''}`);
  error.status = response.status;
  error.code = payload?.error || null;
  error.provider = payload?.provider || null;
  error.details = details;
  error.pauseDuration = Number(payload?.pauseDuration || 0);
  error.remainingSeconds = Number(payload?.remainingSeconds || 0);
  error.requiresCaptcha = payload?.requiresCaptcha === true;
  return error;
}

function activateAIServiceBlock(details) {
  aiServiceHardBlocked = true;
  aiServiceBlockReason = details || 'AI provider quota/rate limit reached. Chat is temporarily unavailable.';
  setComposerEnabled(false);
  showFriendlyError('AI service limit reached', aiServiceBlockReason);
}

const PROFILE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const PROFILE_PHOTO_ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function normalizeAvatarUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.startsWith('/')) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch (_error) {
    return null;
  }
  return null;
}

function getEffectiveUserAvatarUrl() {
  return normalizeAvatarUrl(currentUserLarkAvatarUrl) || null;
}

function getAvatarSourceLabel() {
  if (currentUserAvatarSource === 'lark') return 'Lark profile photo';
  return 'Default profile image';
}

function persistAvatarState() {
  if (currentUserLarkAvatarUrl) {
    localStorage.setItem(USER_AVATAR_LARK_KEY, currentUserLarkAvatarUrl);
  } else {
    localStorage.removeItem(USER_AVATAR_LARK_KEY);
  }

  localStorage.removeItem(USER_AVATAR_CUSTOM_KEY);

  localStorage.setItem(USER_AVATAR_SOURCE_KEY, currentUserAvatarSource || 'default');
}

function clearStoredAvatarState() {
  localStorage.removeItem(USER_AVATAR_LARK_KEY);
  localStorage.removeItem(USER_AVATAR_CUSTOM_KEY);
  localStorage.removeItem(USER_AVATAR_SOURCE_KEY);
}

function loadAvatarStateFromStorage() {
  currentUserLarkAvatarUrl = normalizeAvatarUrl(localStorage.getItem(USER_AVATAR_LARK_KEY));
  currentUserCustomAvatarUrl = null;
  const source = String(localStorage.getItem(USER_AVATAR_SOURCE_KEY) || 'default').toLowerCase();
  currentUserAvatarSource = source === 'lark' ? 'lark' : 'default';
}

function applyAvatarPayload(avatarPayload) {
  currentUserLarkAvatarUrl = normalizeAvatarUrl(avatarPayload?.larkUrl);
  currentUserCustomAvatarUrl = null;

  const source = String(avatarPayload?.source || '').toLowerCase();
  if (source === 'lark') {
    currentUserAvatarSource = source;
  } else if (currentUserLarkAvatarUrl) {
    currentUserAvatarSource = 'lark';
  } else {
    currentUserAvatarSource = 'default';
  }

  persistAvatarState();
}

function revokePendingProfilePhotoPreview() {
  if (pendingProfilePhotoPreviewUrl) {
    URL.revokeObjectURL(pendingProfilePhotoPreviewUrl);
  }
  pendingProfilePhotoPreviewUrl = null;
}

function setProfilePhotoHelpText(message) {
  if (!profilePhotoHelpText) return;
  profilePhotoHelpText.textContent = message;
}

function renderUserAvatarUI() {
  const effectiveAvatarUrl = pendingProfilePhotoPreviewUrl || getEffectiveUserAvatarUrl();

  if (sidebarProfileAvatarImg && sidebarProfileAvatarFallback) {
    if (effectiveAvatarUrl) {
      sidebarProfileAvatarImg.src = effectiveAvatarUrl;
      sidebarProfileAvatarImg.hidden = false;
      sidebarProfileAvatarFallback.hidden = true;
      sidebarProfileAvatarImg.onerror = () => {
        sidebarProfileAvatarImg.hidden = true;
        sidebarProfileAvatarFallback.hidden = false;
      };
    } else {
      sidebarProfileAvatarImg.hidden = true;
      sidebarProfileAvatarFallback.hidden = false;
    }
  }

  if (sidebarProfileAvatarSource) {
    sidebarProfileAvatarSource.textContent = getAvatarSourceLabel();
  }

  if (settingsProfileAvatarImg && settingsProfileAvatarFallback) {
    if (effectiveAvatarUrl) {
      settingsProfileAvatarImg.src = effectiveAvatarUrl;
      settingsProfileAvatarImg.hidden = false;
      settingsProfileAvatarFallback.hidden = true;
      settingsProfileAvatarImg.onerror = () => {
        settingsProfileAvatarImg.hidden = true;
        settingsProfileAvatarFallback.hidden = false;
      };
    } else {
      settingsProfileAvatarImg.hidden = true;
      settingsProfileAvatarFallback.hidden = false;
    }
  }

  if (uploadProfilePhotoBtn) {
    uploadProfilePhotoBtn.disabled = true;
  }

  if (removeProfilePhotoBtn) {
    removeProfilePhotoBtn.disabled = true;
  }

  if (!isLoggedIn) {
    setProfilePhotoHelpText('Log in with Lark to use your Lark profile photo.');
  } else {
    setProfilePhotoHelpText('Profile photo is locked to your Lark account and cannot be changed here.');
  }
}

// ───────────────────────────────────────────────────────────────────
// INITIALIZATION
// ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  console.log('✅ OpenCI Frontend Loaded');

  // Load settings from localStorage
  loadSettings();

  // Check if the user is already logged in (JWT cookie via /api/auth/me)
  await checkAuthSession();

  // Load CAPTCHA provider configuration.
  await loadCaptchaConfig();

  // Initialize event listeners
  setupEventListeners();

  // Get user location
  getUserLocation();

  // Enable message input
  messageInput.disabled = false;
  sendBtn.disabled = false;

  // Restore rate limit state (countdown/CAPTCHA) if page was reloaded mid-pause
  restoreRateLimitState();

  // Check for auth errors in the URL (redirected from Lark callback)
  const urlParams = new URLSearchParams(window.location.search);
  const authError = urlParams.get('error');
  if (authError === 'unauthorized_role' || authError === 'auth_failed') {
    showAuthRejectOverlay();
    window.history.replaceState({}, '', '/');
  }

  if (authRejectBackBtn) {
    authRejectBackBtn.addEventListener('click', () => {
      hideAuthRejectOverlay();
      startNewChat();
    });
  }

  // Always start a fresh new chat on page load
  await startNewChat();

  // Sidebar starts open on desktop landing page.
  if (window.innerWidth > 768) {
    sidebar.classList.remove('desktop-collapsed');
    localStorage.setItem('sidebarCollapsed', 'false');
  }
});

// ───────────────────────────────────────────────────────────────────
// AUTH SESSION CHECK
// ───────────────────────────────────────────────────────────────────
async function checkAuthSession() {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'include' });
    if (!response.ok) return;
    const data = await response.json();
    if (data.loggedIn) {
      isLoggedIn = true;
      currentUserId = data.userId;
      shouldResetLocationOnNextSync = true;
      lastSyncedLocationPayload = null;
      locationHistory.length = 0;
      localStorage.removeItem(LOCATION_CACHE_KEY);
      currentUserName = data.name || 'User';
      currentUserRole = data.role
        ? data.role.charAt(0).toUpperCase() + data.role.slice(1)
        : 'Unknown';
      localStorage.setItem('userName', currentUserName);
      localStorage.setItem('userRole', currentUserRole);
      if (data.email) {
        localStorage.setItem('userEmail', data.email);
      }
      applyAvatarPayload(data.avatar || null);
      updateRoleSelectionPermissions(Boolean(data.canSelectAdmin));
      updateAuthButtons(true);
      updateProfileUI();
      startSessionHeartbeat();

      // If role is unknown, show role selection modal
      if (!data.role || data.role === 'unknown') {
        showRoleSelectionModal();
      }
    } else {
      isLoggedIn = false;
      currentUserId = null;
      shouldResetLocationOnNextSync = false;
      lastSyncedLocationPayload = null;
      locationHistory.length = 0;
      currentUserRole = 'Identifying...';
      currentUserLarkAvatarUrl = null;
      currentUserCustomAvatarUrl = null;
      currentUserAvatarSource = 'default';
      pendingProfilePhotoFile = null;
      revokePendingProfilePhotoPreview();
      clearStoredAvatarState();
      updateRoleSelectionPermissions(false);
      updateAuthButtons(false);
      updateProfileUI();
      stopSessionHeartbeat();
    }
  } catch (e) {
    console.warn('Auth session check failed:', e);
    isLoggedIn = false;
    currentUserId = null;
    shouldResetLocationOnNextSync = false;
    lastSyncedLocationPayload = null;
    locationHistory.length = 0;
    currentUserRole = 'Identifying...';
    currentUserLarkAvatarUrl = null;
    currentUserCustomAvatarUrl = null;
    currentUserAvatarSource = 'default';
    pendingProfilePhotoFile = null;
    revokePendingProfilePhotoPreview();
    clearStoredAvatarState();
    updateRoleSelectionPermissions(false);
    updateAuthButtons(false);
    updateProfileUI();
    stopSessionHeartbeat();
  }
}

function updateRoleSelectionPermissions(canSelectAdmin) {
  const selectAdminBtn = document.getElementById('selectAdminBtn');
  if (!selectAdminBtn) return;
  const roleButtons = selectAdminBtn.parentElement;
  let adminRoleTextHint = document.getElementById('adminRoleTextHint');

  if (canSelectAdmin) {
    selectAdminBtn.style.display = 'flex';
    selectAdminBtn.disabled = false;
    selectAdminBtn.title = 'Select Admin role';
    selectAdminBtn.classList.remove('role-btn-disabled');
    if (adminRoleTextHint) {
      adminRoleTextHint.remove();
    }
  } else {
    selectAdminBtn.style.display = 'none';
    selectAdminBtn.disabled = true;
    selectAdminBtn.classList.add('role-btn-disabled');
    if (!adminRoleTextHint && roleButtons) {
      adminRoleTextHint = document.createElement('span');
      adminRoleTextHint.id = 'adminRoleTextHint';
      adminRoleTextHint.className = 'role-static-text';
      adminRoleTextHint.textContent = 'Admin';
      roleButtons.insertBefore(adminRoleTextHint, roleButtons.firstChild);
    }
  }
}

function showRoleSelectionModal() {
  const roleModal = document.getElementById('roleModal');
  if (roleModal) roleModal.classList.add('active');
}

function hideRoleSelectionModal() {
  const roleModal = document.getElementById('roleModal');
  if (roleModal) roleModal.classList.remove('active');
}

async function selectRole(role) {
  try {
    const response = await fetch('/api/auth/set-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ role }),
    });
    if (!response.ok) {
      let errorMessage = 'Failed to set role';
      try {
        const payload = await response.json();
        if (payload?.error) errorMessage = payload.error;
      } catch (_err) {
        // Ignore parse errors and keep default message.
      }
      throw new Error(errorMessage);
    }
    const data = await response.json();
    currentUserRole = data.role.charAt(0).toUpperCase() + data.role.slice(1);
    localStorage.setItem('userRole', currentUserRole);
    updateProfileUI();
    hideRoleSelectionModal();
    getUserLocation();
  } catch (e) {
    console.error('Error setting role:', e);
    alert(e instanceof Error ? e.message : 'Failed to set role. Please try again.');
  }
}

async function requestAdminAccess() {
  if (!isLoggedIn) {
    alert('Please login first before sending an admin access request.');
    return;
  }

  const reason = window.prompt('Enter reason for requesting Admin access:');
  if (!reason || reason.trim().length < 8) {
    alert('Please provide at least 8 characters for your reason.');
    return;
  }

  try {
    const response = await fetch('/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        requestType: 'role_elevation_admin',
        reason: reason.trim(),
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || 'Failed to submit request');
    }

    alert('Admin access request submitted successfully.');
  } catch (error) {
    alert(error instanceof Error ? error.message : 'Failed to submit admin access request.');
  }
}

function updateAuthButtons(loggedIn) {
  if (loginBtn) loginBtn.style.display = loggedIn ? 'none' : 'inline-flex';
  if (logoutBtn) logoutBtn.style.display = 'none';
  if (accountLogoutBtn) {
    accountLogoutBtn.hidden = !loggedIn;
  }
}

function setAccountMenuOpen(isOpen) {
  if (!accountMenuDrawer || !accountMenuTrigger) return;
  const open = Boolean(isOpen);
  if (open) {
    accountMenuDrawer.removeAttribute('hidden');
  } else {
    accountMenuDrawer.setAttribute('hidden', '');
  }
  accountMenuTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (accountMenuChevron) {
    accountMenuChevron.classList.toggle('is-open', open);
  }
}

function toggleAccountMenuFromEvent(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (!accountMenuDrawer) return;
  const isCurrentlyOpen = !accountMenuDrawer.hasAttribute('hidden');
  setAccountMenuOpen(!isCurrentlyOpen);
}
// ───────────────────────────────────────────────────────────────────
// EVENT LISTENERS
// ───────────────────────────────────────────────────────────────────
function setupEventListeners() {
  // Message form submission
  messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage();
  });

  // Enter key to send
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
      e.preventDefault();
      sendMessage();
    }
  });

  messageInput.addEventListener('input', () => {
    toggleLandingStateExit(messageInput.value.trim().length > 0);
  });

  messageInput.addEventListener('paste', handleMessagePaste);

  if (attachImageBtn && imageInput) {
    attachImageBtn.addEventListener('click', () => {
      if (isLoading || messageInput.disabled) return;
      toggleAttachMenu();
    });

    if (addFilesBtn) {
      addFilesBtn.addEventListener('click', () => {
        closeAttachMenu();
        imageInput.click();
      });
    }

    imageInput.addEventListener('change', (e) => {
      const target = e.target;
      const files = target && target.files ? Array.from(target.files) : [];
      if (!files.length) return;
      addPendingImages(files);
      imageInput.value = '';
    });
  }

  document.addEventListener('click', (event) => {
    if (!attachMenu || attachMenu.hidden) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('#attachImageBtn') || target.closest('#attachMenu')) return;
    closeAttachMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeAttachMenu();
  });

  if (removeImageBtn) {
    removeImageBtn.addEventListener('click', clearPendingImage);
  }

  // New chat button
  newChatBtn.addEventListener('click', startNewChat);

  // Hamburger menu (mobile)
  hamburgerToggle.addEventListener('click', toggleSidebar);
  sidebarOverlay.addEventListener('click', closeSidebar);
  sidebarCloseBtn.addEventListener('click', closeSidebar);

  // Desktop sidebar collapse/expand
  if (sidebarCollapseBtn) {
    sidebarCollapseBtn.addEventListener('click', collapseDesktopSidebar);
  }
  if (sidebarExpandBtn) {
    sidebarExpandBtn.addEventListener('click', expandDesktopSidebar);
  }

  // Profile toggle
  profileToggleBtn.addEventListener('click', toggleProfileContent);

  // Reload location
  reloadLocationBtn.addEventListener('click', () => {
    const now = Date.now();
    const triggerManualRefresh = () => {
      lastManualLocationRefreshAtMs = Date.now();
      currentUserLocation = 'Searching...';
      updateProfileUI();
      getUserLocation({ manualRefresh: true });
    };

    const queueManualRefreshAfter = (waitMs) => {
      queuedManualRefresh = true;
      currentUserLocation = 'Refresh queued...';
      updateProfileUI();
      if (queuedManualRefreshTimer) {
        window.clearTimeout(queuedManualRefreshTimer);
      }
      queuedManualRefreshTimer = window.setTimeout(() => {
        queuedManualRefreshTimer = null;
        if (!queuedManualRefresh || locationRefreshInFlight) {
          return;
        }
        queuedManualRefresh = false;
        triggerManualRefresh();
      }, Math.max(0, waitMs));
    };

    if (locationRefreshInFlight) {
      queueManualRefreshAfter(LOCATION_REFRESH_COOLDOWN_MS);
      return;
    }

    if ((now - lastManualLocationRefreshAtMs) < LOCATION_REFRESH_COOLDOWN_MS) {
      queueManualRefreshAfter(LOCATION_REFRESH_COOLDOWN_MS - (now - lastManualLocationRefreshAtMs) + 20);
      return;
    }

    queuedManualRefresh = false;
    if (queuedManualRefreshTimer) {
      window.clearTimeout(queuedManualRefreshTimer);
      queuedManualRefreshTimer = null;
    }
    triggerManualRefresh();
  });

  if (accountDashboardLink) {
    accountDashboardLink.addEventListener('click', (event) => {
      const normalizedRole = (currentUserRole || '').trim().toLowerCase();
      if (!isLoggedIn || normalizedRole !== 'admin') {
        event.preventDefault();
      }
    });
  }

  // Auth buttons
  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      openLarkLoginModal();
    });
  }

  if (larkLoginContinueBtn) {
    larkLoginContinueBtn.addEventListener('click', () => {
      window.location.href = '/api/auth/lark';
    });
  }

  if (larkLoginBackdrop) {
    larkLoginBackdrop.addEventListener('click', () => {
      closeLarkLoginModal();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && larkLoginModal && !larkLoginModal.hasAttribute('hidden')) {
      closeLarkLoginModal();
    }
  });

  const handleLogout = async () => {
    setAccountMenuOpen(false);
    stopLocationWatch();
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {
      console.warn('Logout request failed:', e);
    }
    isLoggedIn = false;
    currentUserId = null;
    currentUserName = 'User';
    currentUserRole = 'Identifying...';
    currentUserLarkAvatarUrl = null;
    currentUserCustomAvatarUrl = null;
    currentUserAvatarSource = 'default';
    pendingProfilePhotoFile = null;
    revokePendingProfilePhotoPreview();
    localStorage.removeItem('userName');
    localStorage.removeItem('userRole');
    clearStoredAvatarState();
    updateAuthButtons(false);
    updateProfileUI();
    stopSessionHeartbeat();
    lastSyncedLocationPayload = null;
    shouldResetLocationOnNextSync = false;
    locationHistory.length = 0;
    localStorage.removeItem(LOCATION_CACHE_KEY);
    await startNewChat();
  };

  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }

  if (accountLogoutBtn) {
    accountLogoutBtn.addEventListener('click', handleLogout);
  }

  window.addEventListener('pagehide', () => {
    stopSessionOnExit();
  });

  window.addEventListener('beforeunload', () => {
    stopSessionOnExit();
  });

  // Role selection buttons
  const selectAdminBtn = document.getElementById('selectAdminBtn');
  const selectFieldmanBtn = document.getElementById('selectFieldmanBtn');
  if (selectAdminBtn) {
    selectAdminBtn.addEventListener('click', () => selectRole('admin'));
  }
  if (selectFieldmanBtn) {
    selectFieldmanBtn.addEventListener('click', () => selectRole('fieldman'));
  }

  // Settings — open/close
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      setAccountMenuOpen(false);
      openSettings();
    });
  }
  if (accountSettingsBtn) {
    accountSettingsBtn.addEventListener('click', () => {
      setAccountMenuOpen(false);
      openSettings();
    });
  }
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettings();
  });
  if (modalOverlay) {
    modalOverlay.addEventListener('click', closeSettings);
  }
  closeSettingsBtn.addEventListener('click', closeSettings);

  // Save Settings
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', saveSettings);
  }

  if (uploadProfilePhotoBtn && profilePhotoInput) {
    uploadProfilePhotoBtn.addEventListener('click', () => {
      showFriendlyError('Lark-only profile photo', 'Profile photo is locked to your Lark account and cannot be changed.');
    });

    profilePhotoInput.addEventListener('change', (event) => {
      const input = event.target;
      pendingProfilePhotoFile = null;
      revokePendingProfilePhotoPreview();
      profilePhotoInput.value = '';
      renderUserAvatarUI();
    });
  }

  if (removeProfilePhotoBtn) {
    removeProfilePhotoBtn.addEventListener('click', async () => {
      showFriendlyError('Lark-only profile photo', 'Profile photo is locked to your Lark account and cannot be changed.');
    });
  }

  // Clear All Conversations
  if (clearConversationsBtn) {
    clearConversationsBtn.addEventListener('click', clearAllConversations);
  }

  // Export Conversations
  if (exportDataBtn) {
    exportDataBtn.addEventListener('click', exportConversations);
  }

  if (requestAdminAccessBtn) {
    requestAdminAccessBtn.addEventListener('click', requestAdminAccess);
  }
  if (accountRequestAdminBtn) {
    accountRequestAdminBtn.addEventListener('click', async () => {
      setAccountMenuOpen(false);
      await requestAdminAccess();
    });
  }

  if (accountMenuTrigger) {
    accountMenuTrigger.addEventListener('click', toggleAccountMenuFromEvent);
  }

  document.addEventListener('click', (event) => {
    if (!accountMenu || !accountMenuDrawer || accountMenuDrawer.hidden) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('#accountMenu')) {
      setAccountMenuOpen(false);
    }
  });

  // Theme select
  if (themeSelect) {
    themeSelect.addEventListener('change', (e) => {
      const theme = e.target.value;
      if (theme === 'auto') {
        localStorage.removeItem('theme');
        applySystemTheme();
      } else {
        localStorage.setItem('theme', theme);
        applyTheme(theme);
      }
    });
  }

  // Sidebar mascot → toggle theme on click
  const sidebarMascot = document.getElementById('sidebarMascot');
  if (sidebarMascot) {
    sidebarMascot.addEventListener('click', () => {
      const current = document.body.getAttribute('data-theme') || 'light';
      const next = current === 'dark' ? 'light' : 'dark';

      // Mascot pulse animation
      sidebarMascot.classList.add('theme-toggling');
      sidebarMascot.addEventListener('animationend', () => {
        sidebarMascot.classList.remove('theme-toggling');
      }, { once: true });

      // Enable smooth transition, apply theme, then remove transition class
      document.body.classList.add('theme-transitioning');
      localStorage.setItem('theme', next);
      requestAnimationFrame(() => {
        applyTheme(next);
        updateThemeSelect(next);
      });

      setTimeout(() => {
        document.body.classList.remove('theme-transitioning');
      }, 240);
    });
  }

  // Auto-scroll checkbox
  if (autoScrollCheck) {
    autoScrollCheck.addEventListener('change', (e) => {
      autoScroll = e.target.checked;
      localStorage.setItem('autoScroll', autoScroll);
    });
  }

  // Notifications checkbox
  if (notificationsCheck) {
    notificationsCheck.addEventListener('change', async (e) => {
      if (e.target.checked) {
        if (!('Notification' in window)) {
          alert('This browser does not support notifications.');
          e.target.checked = false;
          return;
        }
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          localStorage.setItem('notifications', 'true');
        } else {
          e.target.checked = false;
          localStorage.setItem('notifications', 'false');
          if (permission === 'denied') {
            alert('Notifications are blocked by your browser. Please enable them in your browser settings.');
          }
        }
      } else {
        localStorage.setItem('notifications', 'false');
      }
    });
  }

  // Auto theme — follow OS changes live
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!localStorage.getItem('theme')) {
        applySystemTheme();
      }
    });
  }

}

function toggleAttachMenu() {
  if (!attachMenu) {
    if (imageInput) imageInput.click();
    return;
  }

  const isOpen = !attachMenu.hidden;
  attachMenu.hidden = isOpen;
}

function closeAttachMenu() {
  if (attachMenu) {
    attachMenu.hidden = true;
  }
}

const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PENDING_IMAGES = 3;

function handleMessagePaste(event) {
  if (isLoading) return;
  const clipboardItems = event.clipboardData && event.clipboardData.items
    ? Array.from(event.clipboardData.items)
    : [];
  if (!clipboardItems.length) return;

  const imageFiles = clipboardItems
    .filter((item) => item.type && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file) => !!file);
  if (!imageFiles.length) return;

  event.preventDefault();
  addPendingImages(imageFiles);
}

function canAddPendingImage(file) {
  if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
    showFriendlyError('Unsupported image type', 'Allowed types: PNG, JPEG, WEBP');
    return false;
  }

  if (file.size > MAX_IMAGE_BYTES) {
    showFriendlyError('Image is too large', 'Maximum size is 5MB.');
    return false;
  }

  if (pendingImages.length >= MAX_PENDING_IMAGES) {
    showFriendlyError('Too many images', `Maximum is ${MAX_PENDING_IMAGES} images per message.`);
    return false;
  }

  return true;
}

function addPendingImages(files) {
  let addedCount = 0;
  for (const file of files) {
    if (!canAddPendingImage(file)) continue;
    pendingImages.push({
      file,
      previewUrl: URL.createObjectURL(file),
    });
    addedCount += 1;
    if (pendingImages.length >= MAX_PENDING_IMAGES) break;
  }

  if (!addedCount && files.length > 0 && pendingImages.length >= MAX_PENDING_IMAGES) {
    showFriendlyError('Image limit reached', `You can only send up to ${MAX_PENDING_IMAGES} images.`);
  }

  renderPendingImage();
}

function clearPendingImage() {
  for (const pendingImage of pendingImages) {
    if (pendingImage.previewUrl) {
      URL.revokeObjectURL(pendingImage.previewUrl);
    }
  }
  pendingImages = [];
  renderPendingImage();
}

function renderPendingImage() {
  if (!imagePreview || !imagePreviewThumb || !imagePreviewName) return;
  if (removeImageBtn) removeImageBtn.hidden = true;

  let galleryEl = imagePreview.querySelector('.image-preview__gallery');
  if (!galleryEl) {
    galleryEl = document.createElement('div');
    galleryEl.className = 'image-preview__gallery';
    imagePreview.insertBefore(galleryEl, imagePreviewName);
  }

  if (!pendingImages.length) {
    imagePreview.hidden = true;
    imagePreview.classList.remove('image-preview--tiles');
    imagePreviewThumb.removeAttribute('src');
    imagePreviewThumb.hidden = false;
    imagePreviewName.textContent = '';
    imagePreviewName.hidden = false;
    galleryEl.innerHTML = '';
    galleryEl.hidden = true;
    return;
  }

  imagePreview.hidden = false;

  imagePreview.classList.add('image-preview--tiles');
  imagePreviewThumb.hidden = true;
  imagePreviewThumb.removeAttribute('src');
  imagePreviewName.hidden = true;
  imagePreviewName.textContent = '';
  galleryEl.hidden = false;
  galleryEl.innerHTML = '';

  pendingImages.slice(0, MAX_PENDING_IMAGES).forEach((pendingImage, index) => {
    const tileEl = document.createElement('div');
    tileEl.className = 'image-preview__tile';

    const thumbEl = document.createElement('img');
    thumbEl.className = 'image-preview__tile-thumb';
    thumbEl.alt = `Selected image ${index + 1}`;
    thumbEl.src = pendingImage.previewUrl;
    tileEl.appendChild(thumbEl);

    const removeTileBtn = document.createElement('button');
    removeTileBtn.type = 'button';
    removeTileBtn.className = 'image-preview__tile-remove';
    removeTileBtn.setAttribute('aria-label', `Remove image ${index + 1}`);
    removeTileBtn.textContent = '×';
    removeTileBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (pendingImages[index] && pendingImages[index].previewUrl) {
        URL.revokeObjectURL(pendingImages[index].previewUrl);
      }
      pendingImages.splice(index, 1);
      renderPendingImage();
    });
    tileEl.appendChild(removeTileBtn);

    galleryEl.appendChild(tileEl);
  });
}

// ───────────────────────────────────────────────────────────────────
// CHAT FUNCTIONS
// ───────────────────────────────────────────────────────────────────
async function sendMessage() {
  const content = messageInput.value.trim();
  const imagesToSend = pendingImages.slice(0, MAX_PENDING_IMAGES);
  const transportContent = content || (imagesToSend.length > 0 ? '__IMAGE_ONLY__' : '');
  const imageToPreview = imagesToSend.length ? imagesToSend[0] : null;
  const localImagePreviewUrl = imageToPreview ? URL.createObjectURL(imageToPreview.file) : null;

  if ((!content && imagesToSend.length === 0) || isLoading || !currentConversationId) {
    return;
  }

  if (aiServiceHardBlocked) {
    showFriendlyError('AI service limit reached', aiServiceBlockReason || 'AI provider limit is active. Please try again later.');
    return;
  }

  // Check frontend rate limit
  if (!checkRateLimit()) {
    return; // Rate limited — countdown/CAPTCHA flow handles UI
  }

  await fadeOutLandingState();

  isLoading = true;
  messageInput.disabled = true;
  sendBtn.disabled = true;

  try {
    // Add user message to UI immediately
    const uiAttachments = imagesToSend.map((img, index) => ({
      name: img.file.name,
      mimeType: img.file.type,
      size: img.file.size,
      previewUrl: index === 0 && localImagePreviewUrl ? localImagePreviewUrl : URL.createObjectURL(img.file),
    }));
    addMessageToUI('user', content, uiAttachments);
    messageInput.value = '';

    // Show typing indicator after user message so order stays correct
    showTypingIndicator();

    let data;
    if (!isLoggedIn) {
      // Anonymous: call no-persistence endpoint with local history
      anonymousHistory.push({ role: 'user', content });
      let response;
      if (imagesToSend.length > 0) {
        const formData = new FormData();
        formData.append('content', transportContent);
        formData.append('history', JSON.stringify(anonymousHistory.slice(0, -1)));
        formData.append('fromSuggestedPrompt', String(pendingSuggestedPrompt));
        for (const image of imagesToSend) {
          formData.append('images', image.file, image.file.name);
        }

        response = await fetch('/api/chat/anonymous', {
          method: 'POST',
          headers: {
            'x-chat-content': transportContent,
            'x-chat-history': JSON.stringify(anonymousHistory.slice(0, -1)),
            'x-chat-suggested-prompt': String(pendingSuggestedPrompt),
          },
          body: formData,
        });
      } else {
        response = await fetch('/api/chat/anonymous', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: transportContent, history: anonymousHistory.slice(0, -1), fromSuggestedPrompt: pendingSuggestedPrompt }),
        });
      }
      pendingSuggestedPrompt = false;
      if (!response.ok) {
        throw await buildHttpError(response);
      }
      data = await response.json();
      anonymousHistory.push({ role: 'assistant', content: data.aiMessage.content });

      // Update sidebar name if AI detected the anonymous user's name
      if (data.detectedName) {
        currentUserName = data.detectedName;
        localStorage.setItem('userName', currentUserName);
        updateProfileUI();
      }
      // Update sidebar role if detected from anonymous user's message
      if (data.detectedRole) {
        currentUserRole = data.detectedRole.charAt(0).toUpperCase() + data.detectedRole.slice(1);
        localStorage.setItem('userRole', currentUserRole);
        updateProfileUI();
      }
    } else {
      // Logged-in: call persistent endpoint
      let response;
      if (imagesToSend.length > 0) {
        const formData = new FormData();
        formData.append('content', transportContent);
        for (const image of imagesToSend) {
          formData.append('images', image.file, image.file.name);
        }

        response = await fetch(`/api/conversations/${currentConversationId}/messages`, {
          method: 'POST',
          headers: {
            'x-chat-content': transportContent,
          },
          body: formData,
        });
      } else {
        response = await fetch(`/api/conversations/${currentConversationId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: transportContent }),
        });
      }
      if (!response.ok) {
        throw await buildHttpError(response);
      }
      data = await response.json();
    }

    // Add AI response to UI
    hideTypingIndicator();
    if (data.aiMessage) {
      addMessageToUI('assistant', data.aiMessage.content);
      if (imagesToSend.length > 0) {
        clearPendingImage();
      }
    }

    if (isLoggedIn) {
      // Update profile name if backend detected the user's name
      if (data.detectedName) {
        currentUserName = data.detectedName;
        localStorage.setItem('userName', currentUserName);
        if (userName) userName.value = currentUserName;
        updateProfileUI();
      }
      // Update conversation title if problem was detected
      if (data.updatedTitle) {
        setVisibleChatTitle(data.updatedTitle);
      }
      // Refresh sidebar conversation list
      await loadConversations();
    }

  } catch (error) {
    hideTypingIndicator();
    console.error('Error sending message:', error);
    if (error?.code === 'ai_provider_limit_reached' || (error?.status === 503 && /quota|limit/i.test(error?.message || ''))) {
      activateAIServiceBlock(error?.details || `Provider: ${error?.provider || 'unknown'}`);
      return;
    }
    // Check if it's a rate limit error from backend
    if ((typeof error?.status === 'number' && error.status === 429) || (error.message && error.message.includes('429'))) {
      const backendPause = Number(error?.remainingSeconds || error?.pauseDuration || 0);
      const pauseSeconds = Number.isFinite(backendPause) && backendPause > 0
        ? Math.ceil(backendPause)
        : RATE_LIMIT_PAUSE_SEC;
      const requiresCaptcha = error?.requiresCaptcha !== false;
      startRateLimitPause(pauseSeconds, requiresCaptcha);
    } else {
      showFriendlyError('Failed to send message', error.toString());
    }
  } finally {
    isLoading = false;
    if (!aiServiceHardBlocked) {
      setComposerEnabled(true);
      messageInput.focus();
    }
  }
}

function showTypingIndicator() {
  const existingIndicator = document.getElementById('typing-indicator');
  if (existingIndicator) return;

  const messageEl = document.createElement('div');
  messageEl.className = 'message message-assistant';
  messageEl.id = 'typing-indicator';

  const avatarEl = document.createElement('img');
  avatarEl.className = 'message-avatar';
  avatarEl.src = 'assets/branding/headai.png';
  avatarEl.alt = 'OpenCI';

  const indicatorEl = document.createElement('div');
  indicatorEl.className = 'typing-indicator';
  indicatorEl.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';

  messageEl.appendChild(avatarEl);
  messageEl.appendChild(indicatorEl);
  messagesContainer.appendChild(messageEl);
  if (autoScroll) {
    messagesWrapper.scrollTop = messagesWrapper.scrollHeight;
  }
}

function hideTypingIndicator() {
  const indicator = document.getElementById('typing-indicator');
  if (indicator) indicator.remove();
}

const AI_TYPING_INTERVAL_MS = 12;

function animateAssistantMessage(contentEl, fullText) {
  const text = fullText || '';
  if (!text) {
    contentEl.textContent = '';
    return;
  }

  let cursor = 0;
  let timer = null;
  let done = false;

  const finishTyping = () => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    contentEl.textContent = text;
    contentEl.removeEventListener('click', finishTyping);
    if (autoScroll) {
      messagesWrapper.scrollTop = messagesWrapper.scrollHeight;
    }
  };

  contentEl.addEventListener('click', finishTyping);

  const step = () => {
    if (done) return;
    cursor += 1;
    contentEl.textContent = text.slice(0, cursor);

    if (autoScroll) {
      messagesWrapper.scrollTop = messagesWrapper.scrollHeight;
    }

    if (cursor >= text.length) {
      finishTyping();
      return;
    }

    timer = setTimeout(step, AI_TYPING_INTERVAL_MS);
  };

  step();
}

function addMessageToUI(role, content, attachmentsInput = []) {
  const rawMessageText = typeof content === 'string' ? content : String(content || '');
  const messageText = role === 'assistant'
    ? formatAssistantDisplayText(rawMessageText)
    : rawMessageText;
  const hasMessageText = messageText.trim().length > 0;
  const attachments = Array.isArray(attachmentsInput)
    ? attachmentsInput.filter((item) => item && item.name)
    : (attachmentsInput && attachmentsInput.name ? [attachmentsInput] : []);

  const messageEl = document.createElement('div');
  messageEl.className = `message message-${role}`;

  // Create avatar
  const avatarEl = document.createElement('img');
  avatarEl.className = 'message-avatar';

  if (role === 'assistant') {
    avatarEl.src = 'assets/branding/headai.png';
    avatarEl.alt = 'OpenCI';
  } else {
    const effectiveUserAvatar = getEffectiveUserAvatarUrl();
    if (effectiveUserAvatar) {
      avatarEl.src = effectiveUserAvatar;
      avatarEl.alt = `${currentUserName || 'User'} profile photo`;
      avatarEl.classList.add('message-avatar--photo');
    } else {
      // Fallback avatar for anonymous or no-photo users.
      const userIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
        <circle cx="16" cy="16" r="16" fill="#22c55e"/>
        <circle cx="16" cy="10" r="4" fill="white"/>
        <path d="M 8 24 Q 8 18 16 18 Q 24 18 24 24" fill="white"/>
      </svg>`;
      avatarEl.src = 'data:image/svg+xml,' + encodeURIComponent(userIconSvg);
      avatarEl.alt = 'User';
    }
  }

  // Create message wrapper
  const wrapperEl = document.createElement('div');
  wrapperEl.className = 'message-wrapper';

  // Create header with sender name and timestamp
  const headerEl = document.createElement('div');
  headerEl.className = 'message-header';

  const senderEl = document.createElement('span');
  senderEl.className = 'message-sender';
  senderEl.textContent = role === 'assistant' ? 'OpenCI' : 'You';

  const timestampEl = document.createElement('span');
  timestampEl.className = 'message-timestamp';
  timestampEl.textContent = 'Just now';

  headerEl.appendChild(senderEl);
  headerEl.appendChild(timestampEl);

  // Create message content
  const contentEl = document.createElement('div');
  contentEl.className = 'message-content';
  if (role === 'assistant' && isLoading && hasMessageText) {
    animateAssistantMessage(contentEl, messageText);
  } else {
    contentEl.textContent = messageText;
  }

  wrapperEl.appendChild(headerEl);

  if (attachments.length > 0) {
    const attachmentsListEl = document.createElement('div');
    attachmentsListEl.className = 'message-attachments';

    attachments.forEach((attachment) => {
      const attachmentEl = document.createElement('div');
      attachmentEl.className = 'message-attachment';

      if (attachment.previewUrl) {
        const thumbEl = document.createElement('img');
        thumbEl.className = 'message-attachment__thumb';
        thumbEl.alt = attachment.name;
        thumbEl.src = attachment.previewUrl;
        if (String(attachment.previewUrl).startsWith('blob:')) {
          thumbEl.addEventListener('load', () => URL.revokeObjectURL(attachment.previewUrl), { once: true });
        }
        attachmentEl.appendChild(thumbEl);
      } else {
        const iconEl = document.createElement('i');
        iconEl.className = 'fas fa-image message-attachment__icon';
        attachmentEl.appendChild(iconEl);
      }

      const detailsEl = document.createElement('div');
      detailsEl.className = 'message-attachment__details';

      const nameEl = document.createElement('span');
      nameEl.className = 'message-attachment__name';
      nameEl.textContent = attachment.name;
      detailsEl.appendChild(nameEl);

      if (attachment.size) {
        const sizeEl = document.createElement('span');
        sizeEl.className = 'message-attachment__meta';
        sizeEl.textContent = `${Math.max(1, Math.round(attachment.size / 1024))} KB`;
        detailsEl.appendChild(sizeEl);
      }

      attachmentEl.appendChild(detailsEl);
      attachmentsListEl.appendChild(attachmentEl);
    });

    // Keep attachments above the text bubble so images are immediately visible.
    wrapperEl.appendChild(attachmentsListEl);
  }

  if (hasMessageText) {
    wrapperEl.appendChild(contentEl);
  }

  // Add to message in correct order based on role
  if (role === 'assistant') {
    // Assistant: avatar on LEFT, wrapper on RIGHT
    messageEl.appendChild(avatarEl);
    messageEl.appendChild(wrapperEl);
  } else {
    // User: wrapper on LEFT, avatar on RIGHT
    messageEl.appendChild(wrapperEl);
    messageEl.appendChild(avatarEl);
  }

  messagesContainer.appendChild(messageEl);

  // Fire browser notification for assistant replies when page is not visible
  if (role === 'assistant' && document.hidden &&
    localStorage.getItem('notifications') === 'true' &&
    Notification.permission === 'granted') {
    new Notification('OpenCI', {
      body: messageText.length > 100 ? messageText.substring(0, 97) + '...' : messageText,
      icon: 'assets/branding/headai.png'
    });
  }

  if (autoScroll) {
    messagesWrapper.scrollTop = messagesWrapper.scrollHeight;
  }
}

function formatAssistantDisplayText(text) {
  let output = String(text || '').replace(/\r\n/g, '\n');

  const looksLikeEnumeratedList =
    /\b(list|admins?|fieldm[ae]n|users?|steps?|modules?)\b/i.test(output) && /\d+\.\s/.test(output);

  if (looksLikeEnumeratedList) {
    output = output.replace(/:\s*(\d+\.\s)/g, ':\n$1');
    output = output.replace(/\s+(?=\d+\.\s)/g, '\n');
  }

  // Normalize role separators for cleaner rendering.
  output = output.replace(/\s*-\s*(Admin|Fieldman|User)\b/g, ' - $1');

  return output;
}

// ───────────────────────────────────────────────────────────────────
// SUGGESTED PROMPTS
// ───────────────────────────────────────────────────────────────────
const SUGGESTED_PROMPTS = {
  anonymous: [
    'What services does OpenCI offer?',
    'How do I request a Credit Investigation?',
    'What is the process for sending a Demand Letter?',
    'How does Skip Tracing and Collection work?',
    'How can I contact OpenCI or get started?',
  ],
  admin: [
    'How do I assign a fieldman to a new case?',
    'Show the summary of completed cases this month',
    'What is the turnaround time for Credit Investigations?',
    'How do I generate and send a Demand Letter?',
    'What are the admin guidelines for TeleCI?',
  ],
  fieldman: [
    'What are my assigned cases for today?',
    'How do I submit a Credit Investigation report?',
    'What is the SLA for Skip Tracing tasks?',
    'How do I update the status of my current case?',
    'What documents do I need for a field verification?',
  ],
};

const SHOWCASE_CARD_ITEMS = [
  {
    imageSrc: 'assets/showcase/1.jpg',
    fileType: 'PNG',
    category: 'Credit Investigation',
    title: 'OpenCI Preview 01',
    caption: 'Drop your first showcase screenshot in public/assets/showcase/1.jpg.',
  },
  {
    imageSrc: 'assets/showcase/2.jpg',
    fileType: 'PNG',
    category: 'Skips and Collect',
    title: 'OpenCI Preview 02',
    caption: 'Drop your second showcase screenshot in public/assets/showcase/2.jpg.',
  },
  {
    imageSrc: 'assets/showcase/3.jpg',
    fileType: 'PNG',
    category: 'Demand Letter',
    title: 'OpenCI Preview 03',
    caption: 'Drop your third showcase screenshot in public/assets/showcase/3.jpg.',
  },
  {
    imageSrc: 'assets/showcase/4.jpg',
    fileType: 'PNG',
    category: 'TeleCI',
    title: 'OpenCI Preview 04',
    caption: 'Drop your fourth showcase screenshot in public/assets/showcase/4.jpg.',
  },
  {
    imageSrc: 'assets/showcase/5.jpg',
    fileType: 'PNG',
    category: 'OpenCI Files',
    title: 'OpenCI Preview 05',
    caption: 'Drop your fifth showcase screenshot in public/assets/showcase/5.jpg.',
  },
];

const SHOWCASE_CARD_LOOP_SECONDS = 15;

function getLandingStatePanels() {
  return ['showcaseCarousel', 'suggestedPrompts']
    .map((id) => document.getElementById(id))
    .filter(Boolean);
}

function toggleLandingStateExit(isExiting) {
  getLandingStatePanels().forEach((panel) => {
    panel.classList.toggle('is-exiting', isExiting);
  });
}

async function fadeOutLandingState() {
  const panels = getLandingStatePanels();
  if (!panels.length) return;

  panels.forEach((panel) => panel.classList.add('is-exiting'));
  await new Promise((resolve) => setTimeout(resolve, LANDING_STATE_FADE_MS));

  removeSuggestedPrompts();
  removeShowcaseCarousel();
}

function getSuggestedPrompts() {
  if (!isLoggedIn) return SUGGESTED_PROMPTS.anonymous;
  const role = (currentUserRole || '').toLowerCase();
  if (role === 'admin') return SUGGESTED_PROMPTS.admin;
  if (role === 'fieldman') return SUGGESTED_PROMPTS.fieldman;
  // Fallback for unknown role — use anonymous set
  return SUGGESTED_PROMPTS.anonymous;
}

function renderSuggestedPrompts() {
  const prompts = getSuggestedPrompts();

  const container = document.createElement('div');
  container.className = 'suggested-prompts';
  container.id = 'suggestedPrompts';

  const header = document.createElement('p');
  header.className = 'suggested-prompts-header';
  header.textContent = isLoggedIn ? 'Try asking...' : 'Ano ang pangalan mo?';
  container.appendChild(header);

  const chipsWrapper = document.createElement('div');
  chipsWrapper.className = 'suggested-prompts-chips';

  prompts.forEach((text) => {
    const chip = document.createElement('button');
    chip.className = 'prompt-chip';
    chip.type = 'button';
    chip.textContent = text;
    chip.addEventListener('click', () => handlePromptClick(text));
    chipsWrapper.appendChild(chip);
  });

  container.appendChild(chipsWrapper);
  messagesContainer.appendChild(container);
}

function renderShowcaseCarousel() {
  if (!messagesContainer || document.getElementById('showcaseCarousel')) return;

  messagesContainer.classList.add('messages-container--showcase');

  const sectionEl = document.createElement('section');
  sectionEl.className = 'showcase-carousel';
  sectionEl.id = 'showcaseCarousel';

  const viewportEl = document.createElement('div');
  viewportEl.className = 'showcase-carousel__viewport';

  const trackEl = document.createElement('div');
  trackEl.className = 'showcase-carousel__track';

  const perCardDelay = SHOWCASE_CARD_LOOP_SECONDS / SHOWCASE_CARD_ITEMS.length;

  SHOWCASE_CARD_ITEMS.forEach((item, index) => {
    const cardEl = document.createElement('article');
    cardEl.className = 'showcase-card showcase-card--placeholder';
    cardEl.style.animationDuration = `${SHOWCASE_CARD_LOOP_SECONDS}s`;
    cardEl.style.animationDelay = `${-(index * perCardDelay)}s`;

    const surfaceEl = document.createElement('div');
    surfaceEl.className = 'showcase-card__surface';

    const mediaEl = document.createElement('div');
    mediaEl.className = 'showcase-card__media';

    const placeholderEl = document.createElement('div');
    placeholderEl.className = 'showcase-card__placeholder';

    const imageEl = document.createElement('img');
    imageEl.className = 'showcase-card__image showcase-card__image--hidden';
    imageEl.alt = item.title;
    imageEl.loading = 'eager';
    imageEl.decoding = 'async';

    const revealImage = () => {
      cardEl.classList.remove('showcase-card--placeholder');
      imageEl.classList.remove('showcase-card__image--hidden');
    };

    const hideImage = () => {
      cardEl.classList.add('showcase-card--placeholder');
      imageEl.classList.add('showcase-card__image--hidden');
    };

    imageEl.addEventListener('load', revealImage);
    imageEl.addEventListener('error', hideImage);

    imageEl.src = item.imageSrc.startsWith('/') ? item.imageSrc : `/${item.imageSrc}`;

    if (imageEl.complete && imageEl.naturalWidth > 0) {
      revealImage();
    }

    mediaEl.appendChild(placeholderEl);
    mediaEl.appendChild(imageEl);

    surfaceEl.appendChild(mediaEl);
    cardEl.appendChild(surfaceEl);
    trackEl.appendChild(cardEl);
  });

  viewportEl.appendChild(trackEl);
  sectionEl.appendChild(viewportEl);
  messagesContainer.appendChild(sectionEl);
}

function removeShowcaseCarousel() {
  const showcaseEl = document.getElementById('showcaseCarousel');
  if (showcaseEl) showcaseEl.remove();
  if (messagesContainer) {
    messagesContainer.classList.remove('messages-container--showcase');
  }
}

function renderLandingState() {
  if (!messagesContainer) return;
  messagesContainer.innerHTML = '';
  renderShowcaseCarousel();
  renderSuggestedPrompts();
  toggleLandingStateExit(false);
}

function removeSuggestedPrompts() {
  const panel = document.getElementById('suggestedPrompts');
  if (panel) panel.remove();
}

function handlePromptClick(text) {
  if (isLoading || !currentConversationId) return;
  if (!isLoggedIn) pendingSuggestedPrompt = true;
  messageInput.value = text;
  toggleLandingStateExit(true);
  sendMessage();
}

async function startNewChat() {
  anonymousHistory = [];
  clearPendingImage();

  try {
    if (isLoggedIn) {
      // Logged-in: create conversation in backend
      const response = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      currentConversationId = data.conversationId;
    } else {
      // Anonymous: ephemeral session, no backend storage
      currentConversationId = 'anonymous-' + Date.now();
    }

    // Reset profile state for new conversation
    if (!isLoggedIn) {
      currentUserName = 'Identifying...';
      currentUserRole = 'Identifying...';
      localStorage.setItem('userName', currentUserName);
      localStorage.setItem('userRole', currentUserRole);
    }

    // Clear messages and show the landing state
    renderLandingState();

    setVisibleChatTitle(DEFAULT_CHAT_TITLE);
    updateProfileUI();
    await loadConversations();

  } catch (error) {
    console.error('Error creating new conversation:', error);
  }
}

async function loadConversations() {
  if (!isLoggedIn) {
    if (conversationsList) {
      conversationsList.innerHTML = '<p class="no-chats-message">Log in to save your conversations.</p>';
    }
    return;
  }

  try {
    const response = await fetch('/api/conversations');

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const conversations = await response.json();

    if (!conversationsList) return;

    conversationsList.innerHTML = '';

    if (conversations.length === 0) {
      conversationsList.innerHTML = '<p class="no-chats-message">No sessions found.</p>';
      return;
    }

    conversations.forEach(conv => {
      const item = document.createElement('div');
      item.className = 'conversation-item';
      if (currentConversationId === conv.id) {
        item.classList.add('active');
      }

      const safeCurrentTitle = conv.title && conv.title.trim() ? conv.title.trim() : DEFAULT_CHAT_TITLE;
      const displayTitle = escapeHtml(safeCurrentTitle);

      item.innerHTML = `
        <div class="conversation-title">${displayTitle}</div>
        <div class="conversation-actions">
          <button class="conversation-edit-btn" title="Rename">
            <i class="fas fa-pen"></i>
          </button>
          <button class="conversation-delete-btn" title="Delete">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      `;

      item.addEventListener('click', (e) => {
        if (item.classList.contains('is-editing')) return;
        // Only load conversation if delete or edit button was not clicked
        if (!e.target.closest('.conversation-delete-btn') && !e.target.closest('.conversation-edit-btn')) {
          loadConversation(conv.id);
        }
      });

      // Add proper event listener for edit button
      const editBtn = item.querySelector('.conversation-edit-btn');
      if (editBtn) {
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          startInlineConversationTitleEdit(item, conv.id, safeCurrentTitle);
        });
      }

      // Add proper event listener for delete button
      const deleteBtn = item.querySelector('.conversation-delete-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteConversation(conv.id, item);
        });
      }

      conversationsList.appendChild(item);
    });

    return conversations;
  } catch (error) {
    console.error('Error loading conversations:', error);
    return [];
  }
}

async function loadConversation(conversationId) {
  try {
    const response = await fetch(`/api/conversations/${conversationId}`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const conversation = await response.json();
    currentConversationId = conversation.id;

    // Restore role and name from DB for this conversation
    if (conversation.userRole && conversation.userRole !== 'unknown') {
      currentUserRole = conversation.userRole.charAt(0).toUpperCase() + conversation.userRole.slice(1);
      localStorage.setItem('userRole', currentUserRole);
    }
    if (conversation.userName) {
      currentUserName = conversation.userName;
      localStorage.setItem('userName', currentUserName);
      if (userName) userName.value = currentUserName;
    }
    updateProfileUI();
    messagesContainer.innerHTML = '';

    // Add messages
    if (conversation.messages && conversation.messages.length > 0) {
      messagesContainer.classList.remove('messages-container--showcase');
      conversation.messages.forEach(msg => {
        const attachmentList = Array.isArray(msg.attachments) && msg.attachments.length > 0
          ? msg.attachments
          : (msg.attachment_name ? [{
            name: msg.attachment_name,
            mimeType: msg.attachment_mime,
            size: msg.attachment_size,
          }] : []);

        const attachmentPayload = attachmentList.map((item) => ({
          name: item.name,
          mimeType: item.mimeType,
          size: Number(item.size || 0),
        }));

        addMessageToUI(msg.role, msg.content || '', attachmentPayload);
      });
    } else {
      renderLandingState();
    }

    setVisibleChatTitle(conversation.title);
    closeSidebar();
    loadConversations();

  } catch (error) {
    console.error('Error loading conversation:', error);
  }
}

async function fetchConversationDetails(conversationId) {
  try {
    const response = await fetch(`/api/conversations/${conversationId}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching conversation details:', error);
    return null;
  }
}

async function updateConversationTitle(conversationId, title) {
  try {
    const response = await fetch(`/api/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

  } catch (error) {
    console.error('Error updating conversation title:', error);
  }
}

function startInlineConversationTitleEdit(item, conversationId, currentTitle) {
  const titleNode = item.querySelector('.conversation-title');
  if (!titleNode || item.classList.contains('is-editing')) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'conversation-title-input';
  input.maxLength = 100;
  input.value = currentTitle === DEFAULT_CHAT_TITLE ? '' : currentTitle;

  titleNode.textContent = '';
  titleNode.appendChild(input);
  item.classList.add('is-editing');
  input.focus();
  input.select();

  let finalized = false;

  const finalize = async (saveChange) => {
    if (finalized) return;
    finalized = true;

    const nextRawTitle = input.value.trim();
    const nextDisplayTitle = nextRawTitle || DEFAULT_CHAT_TITLE;

    titleNode.textContent = saveChange ? nextDisplayTitle : currentTitle;
    item.classList.remove('is-editing');

    if (!saveChange) return;
    if (nextDisplayTitle === currentTitle) return;

    try {
      await updateConversationTitle(conversationId, nextRawTitle);
      if (currentConversationId === conversationId) {
        setVisibleChatTitle(nextDisplayTitle);
      }
      await loadConversations();
    } catch (error) {
      console.error('Error editing conversation title:', error);
      alert('Failed to rename chat');
      await loadConversations();
    }
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finalize(true);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      finalize(false);
    }
  });

  input.addEventListener('blur', () => {
    finalize(true);
  });
}

async function deleteConversation(conversationId, conversationItem = null) {
  let removedSnapshot = null;

  if (conversationItem instanceof Element && conversationsList?.contains(conversationItem)) {
    const parent = conversationItem.parentElement;
    if (parent) {
      removedSnapshot = {
        parent,
        node: conversationItem,
        nextSibling: conversationItem.nextSibling,
      };
      parent.removeChild(conversationItem);

      if (!parent.querySelector('.conversation-item')) {
        parent.innerHTML = '<p class="no-chats-message">No sessions found.</p>';
      }
    }
  }

  try {
    const response = await fetch(`/api/conversations/${conversationId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    if (currentConversationId === conversationId) {
      await startNewChat();
    } else if (!removedSnapshot) {
      await loadConversations();
    }

  } catch (error) {
    console.error('Error deleting conversation:', error);

    if (removedSnapshot) {
      const { parent, node, nextSibling } = removedSnapshot;
      const placeholder = parent.querySelector('.no-chats-message');
      if (placeholder) {
        placeholder.remove();
      }
      parent.insertBefore(node, nextSibling);
    }

    await loadConversations();
  }
}

// ───────────────────────────────────────────────────────────────────
// THEME MANAGEMENT
// ───────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
}

function applySystemTheme() {
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    applyTheme('dark');
  } else {
    applyTheme('light');
  }
}

function updateThemeSelect(theme) {
  if (themeSelect) {
    themeSelect.value = theme;
  }
}

function loadSettings() {
  // Theme — default to light if nothing saved
  let theme = localStorage.getItem('theme');
  if (!theme) {
    applyTheme('light');
    updateThemeSelect('light');
  } else {
    applyTheme(theme);
    updateThemeSelect(theme);
  }

  // User profile
  currentUserName = localStorage.getItem('userName') || 'Identifying...';
  currentUserRole = localStorage.getItem('userRole') || 'Identifying...';
  loadAvatarStateFromStorage();
  userName.value = currentUserName;
  const savedEmail = localStorage.getItem('userEmail');
  if (savedEmail && userEmail) userEmail.value = savedEmail;

  // Auto-scroll
  autoScroll = localStorage.getItem('autoScroll') !== 'false';
  if (autoScrollCheck) {
    autoScrollCheck.checked = autoScroll;
  }

  // Notifications
  if (notificationsCheck) {
    if (Notification.permission === 'denied') {
      notificationsCheck.checked = false;
      localStorage.setItem('notifications', 'false');
    } else {
      notificationsCheck.checked = localStorage.getItem('notifications') === 'true';
    }
  }

  // Restore desktop sidebar collapsed state
  if (window.innerWidth > 768 && localStorage.getItem('sidebarCollapsed') === 'true') {
    sidebar.classList.add('desktop-collapsed');
  }

  updateProfileUI();
}

function updateProfileUI() {
  profileName.textContent = currentUserName;
  const normalizedRole = (currentUserRole || '').trim().toLowerCase();
  const canAccessAdminDashboard = isLoggedIn && normalizedRole === 'admin';
  profileRole.textContent = '';
  if (normalizedRole === 'admin') {
    profileRole.textContent = 'ADMIN';
  } else {
    profileRole.textContent = currentUserRole;
  }
  if (requestAdminAccessBtn) {
    requestAdminAccessBtn.style.display = 'none';
  }
  profileLocation.textContent = currentUserLocation;
  chatSubtitle.textContent = `Ready to help, ${currentUserName}!`;

  if (accountMenuName) {
    accountMenuName.textContent = currentUserName;
  }

  if (accountMenuSubtitle) {
    if (normalizedRole === 'admin') {
      accountMenuSubtitle.textContent = 'Admin Dashboard';
    } else if (normalizedRole === 'fieldman') {
      accountMenuSubtitle.textContent = 'Admin Request';
    } else {
      accountMenuSubtitle.textContent = '';
    }
  }

  if (accountDashboardLink) {
    accountDashboardLink.hidden = !canAccessAdminDashboard;
  }

  if (accountRequestAdminBtn) {
    accountRequestAdminBtn.hidden = !isLoggedIn || normalizedRole !== 'fieldman';
  }

  if (accountMenuAvatarImg) {
    const effectiveAvatar = getEffectiveUserAvatarUrl();
    accountMenuAvatarImg.src = effectiveAvatar || '/assets/branding/ci.png';
  }

  if (!isLoggedIn) {
    setAccountMenuOpen(false);
  }

  // Sync Settings panel inputs
  if (userName) userName.value = currentUserName;
  const savedEmail = localStorage.getItem('userEmail');
  if (userEmail && savedEmail) userEmail.value = savedEmail;

  renderUserAvatarUI();
}

// ───────────────────────────────────────────────────────────────────
// SIDEBAR MANAGEMENT
// ───────────────────────────────────────────────────────────────────
function toggleSidebar() {
  sidebar.classList.toggle('active');
  sidebarOverlay.classList.toggle('active');
}

function closeSidebar() {
  sidebar.classList.remove('active');
  sidebarOverlay.classList.remove('active');
}

function collapseDesktopSidebar() {
  sidebar.classList.add('desktop-collapsed');
  localStorage.setItem('sidebarCollapsed', 'true');
}

function expandDesktopSidebar() {
  sidebar.classList.remove('desktop-collapsed');
  localStorage.setItem('sidebarCollapsed', 'false');
}

// ───────────────────────────────────────────────────────────────────
// PROFILE MANAGEMENT
// ───────────────────────────────────────────────────────────────────
function toggleProfileContent() {
  profileContent.classList.toggle('collapsed');
  const icon = profileToggleBtn.querySelector('i');
  if (profileContent.classList.contains('collapsed')) {
    icon.className = 'fas fa-chevron-down';
  } else {
    icon.className = 'fas fa-chevron-up';
  }
}

// ───────────────────────────────────────────────────────────────────
// LOCATION SERVICES
// ───────────────────────────────────────────────────────────────────
function detectClientDeviceInfo() {
  const userAgent = navigator.userAgent || '';
  const platformRaw = navigator.platform || '';
  const ua = userAgent.toLowerCase();

  let platform = 'Desktop';
  if (ua.includes('ipad') || ua.includes('tablet')) platform = 'Tablet';
  else if (ua.includes('mobile') || ua.includes('iphone') || ua.includes('ipod') || ua.includes('android')) platform = 'Mobile';

  let os = 'Unknown OS';
  if (ua.includes('windows nt')) os = 'Windows';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) os = 'iOS';
  else if (ua.includes('mac os x') || ua.includes('macintosh')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';

  let browser = 'Unknown Browser';
  if (ua.includes('edg/')) browser = 'Edge';
  else if (ua.includes('opr/') || ua.includes('opera')) browser = 'Opera';
  else if (ua.includes('chrome/') || ua.includes('crios/')) browser = 'Chrome';
  else if (ua.includes('safari/') && !ua.includes('chrome/') && !ua.includes('crios/')) browser = 'Safari';
  else if (ua.includes('firefox/') || ua.includes('fxios/')) browser = 'Firefox';

  const model = ua.includes('iphone')
    ? 'iPhone'
    : ua.includes('ipad')
      ? 'iPad'
      : ua.includes('android')
        ? 'Android'
        : '';

  return {
    platform,
    os,
    browser,
    model,
    platformRaw: String(platformRaw || '').slice(0, 48),
    userAgent: userAgent.slice(0, 220),
  };
}

async function syncSessionLocation(locationPayload = null, options = {}) {
  if (!isLoggedIn) {
    return;
  }

  const shouldHeartbeat = options.heartbeat !== false;
  const fromHeartbeat = options.fromHeartbeat === true;

  // Skip redundant heartbeat requests when a recent successful sync already happened.
  if (fromHeartbeat && (Date.now() - lastSessionSyncAtMs) < 45000) {
    return;
  }

  try {
    const response = await fetch('/api/auth/session/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        location: locationPayload || undefined,
        device: detectClientDeviceInfo(),
        heartbeat: shouldHeartbeat,
        resetLocation: shouldResetLocationOnNextSync || undefined,
      }),
    });

    if (response.ok) {
      shouldResetLocationOnNextSync = false;
      lastSessionSyncAtMs = Date.now();
    }

    if (!response.ok && response.status !== 401 && response.status !== 403) {
      const payload = await response.json().catch(() => ({}));
      const detail = payload?.error || `status ${response.status}`;
      console.warn('Session location update failed:', detail);
    }
  } catch (error) {
    console.warn('Session location sync error:', error);
  }
}

function stopSessionHeartbeat() {
  if (sessionHeartbeatBootstrapTimer) {
    window.clearTimeout(sessionHeartbeatBootstrapTimer);
    sessionHeartbeatBootstrapTimer = null;
  }

  if (sessionHeartbeatTimer) {
    window.clearInterval(sessionHeartbeatTimer);
    sessionHeartbeatTimer = null;
  }
}

function startSessionHeartbeat() {
  stopSessionHeartbeat();
  if (!isLoggedIn) return;

  // Presence-only heartbeat keeps ACTIVE status honest even if live location is disabled.
  // Also syncs last known location if available
  const heartbeatWithLocation = () => {
    if (lastSyncedLocationPayload) {
      syncSessionLocation(lastSyncedLocationPayload, { heartbeat: true, fromHeartbeat: true });
    } else {
      syncSessionLocation(null, { heartbeat: true, fromHeartbeat: true });
    }
  };

  // Give startup location/auth sync a short head-start to avoid duplicate update calls.
  sessionHeartbeatBootstrapTimer = window.setTimeout(() => {
    sessionHeartbeatBootstrapTimer = null;
    if (!isLoggedIn) return;
    if ((Date.now() - lastSessionSyncAtMs) > 15000) {
      heartbeatWithLocation();
    }

    sessionHeartbeatTimer = window.setInterval(() => {
      heartbeatWithLocation();
    }, 60000);
  }, 4000);
}

function stopSessionOnExit() {
  stopLocationWatch();
  if (!isLoggedIn) return;

  try {
    const payload = JSON.stringify({ reason: 'page-unload' });
    const blob = new Blob([payload], { type: 'application/json' });
    navigator.sendBeacon('/api/auth/session/stop', blob);
  } catch (_error) {
    fetch('/api/auth/session/stop', {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'page-unload' }),
    }).catch(() => null);
  }
}

function cacheLastKnownLocation(locationPayload) {
  if (!locationPayload) return;
  const lat = Number(locationPayload.lat);
  const lng = Number(locationPayload.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  try {
    localStorage.setItem(
      LOCATION_CACHE_KEY,
      JSON.stringify({
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        savedAt: Date.now(),
        accuracyMeters: Number.isFinite(Number(locationPayload.accuracyMeters))
          ? Number(Number(locationPayload.accuracyMeters).toFixed(1))
          : null,
      })
    );
  } catch (_error) {
    // Ignore storage quota failures.
  }
}

function readCachedLocation() {
  try {
    const raw = localStorage.getItem(LOCATION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const lat = Number(parsed?.lat);
    const lng = Number(parsed?.lng);
    const savedAt = Number(parsed?.savedAt);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (!Number.isFinite(savedAt)) return null;

    if ((Date.now() - savedAt) > LOCATION_CACHE_TTL_MS) {
      localStorage.removeItem(LOCATION_CACHE_KEY);
      return null;
    }

    const accuracy = Number(parsed?.accuracyMeters);
    return {
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      accuracyMeters: Number.isFinite(accuracy) ? Number(accuracy.toFixed(1)) : null,
    };
  } catch (_error) {
    return null;
  }
}

function formatGeoErrorMessage(error) {
  if (!window.isSecureContext) {
    return 'Coordinates unavailable (open via HTTPS or localhost to enable GPS).';
  }

  const code = Number(error?.code);
  if (code === 1) return 'Coordinates blocked (allow location permission in browser settings).';
  if (code === 2) return 'Coordinates unavailable (position source not available).';
  if (code === 3) return 'Coordinates timeout (tap refresh and try again).';
  return 'Coordinates unavailable.';
}

async function applyCachedLocationFallback(error) {
  const cached = readCachedLocation();
  if (!cached) {
    return false;
  }

  const locationPayload = {
    lat: cached.lat,
    lng: cached.lng,
    accuracyMeters: cached.accuracyMeters,
    capturedAt: new Date().toISOString(),
    source: 'cached-location',
  };

  currentUserLocation = `${cached.lat.toFixed(4)}, ${cached.lng.toFixed(4)} (cached)`;
  updateProfileUI();
  await syncSessionLocation(locationPayload);
  console.warn('Using cached location after geolocation error:', error);
  return true;
}

async function applyApproximateIpLocationFallback(error) {
  try {
    const response = await fetch('https://ipapi.co/json/', { cache: 'no-store' });
    if (!response.ok) {
      return false;
    }

    const payload = await response.json();
    const lat = Number(payload?.latitude);
    const lng = Number(payload?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return false;
    }

    const locationPayload = {
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      accuracyMeters: 5000,
      capturedAt: new Date().toISOString(),
      source: 'ip-approx',
    };

    currentUserLocation = `${locationPayload.lat.toFixed(4)}, ${locationPayload.lng.toFixed(4)} (approx)`;
    updateProfileUI();
    if (!isLoggedIn) {
      cacheLastKnownLocation(locationPayload);
      await syncSessionLocation(locationPayload);
    }
    console.warn('Using approximate IP location after geolocation error:', error);
    return true;
  } catch (_error) {
    return false;
  }
}

/**
 * Stop continuous location watching
 */
function stopLocationWatch() {
  if (locationWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  }
}

/**
 * Check if location has changed significantly (more than ~10 meters)
 */
function hasLocationChangedSignificantly(newPayload, oldPayload) {
  if (!oldPayload) return true;
  if (!newPayload) return false;

  const distanceMeters = calculateDistanceMeters(
    Number(oldPayload.lat),
    Number(oldPayload.lng),
    Number(newPayload.lat),
    Number(newPayload.lng)
  );

  const newAccuracy = Number(newPayload.accuracyMeters);
  const oldAccuracy = Number(oldPayload.accuracyMeters);
  const dynamicThreshold = Math.max(
    MIN_SIGNIFICANT_MOVE_METERS,
    Number.isFinite(newAccuracy) && newAccuracy > 0 ? newAccuracy * 0.35 : 0,
    Number.isFinite(oldAccuracy) && oldAccuracy > 0 ? oldAccuracy * 0.35 : 0
  );

  return distanceMeters > dynamicThreshold;
}

// Anti-spoofing: track location history for velocity checks
const locationHistory = [];
const MAX_LOCATION_HISTORY = 10;
const MAX_REALISTIC_SPEED_MPS = 120; // ~432 km/h (fast airplane)
const MIN_ACCURACY_THRESHOLD = 80; // Warn early when precision drops below operational quality.
const MAX_SYNC_ACCURACY_METERS = 120; // Reject coarse fixes to reduce inaccurate map/report coordinates.
const MIN_SIGNIFICANT_MOVE_METERS = 25;

/**
 * Calculate distance between two coordinates in meters (Haversine formula)
 */
function calculateDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Detect potential location spoofing by checking velocity
 */
function detectLocationSpoofing(newLat, newLng, timestamp) {
  if (locationHistory.length === 0) {
    return { spoofed: false, reason: null };
  }
  
  const lastEntry = locationHistory[locationHistory.length - 1];
  const distance = calculateDistanceMeters(lastEntry.lat, lastEntry.lng, newLat, newLng);
  const timeDiff = (timestamp - lastEntry.timestamp) / 1000; // seconds
  
  if (timeDiff <= 0) {
    return { spoofed: false, reason: null };
  }
  
  const speed = distance / timeDiff; // meters per second
  
  // If moving faster than physically possible (teleportation)
  if (speed > MAX_REALISTIC_SPEED_MPS && distance > 1000) {
    return {
      spoofed: true,
      reason: `Unrealistic movement detected (${Math.round(speed * 3.6)} km/h over ${Math.round(distance)}m)`,
      speed: speed,
      distance: distance
    };
  }
  
  return { spoofed: false, reason: null };
}

/**
 * Add location to history for velocity tracking
 */
function addToLocationHistory(lat, lng) {
  const timestamp = Date.now();
  locationHistory.push({ lat, lng, timestamp });
  
  // Keep only recent history
  while (locationHistory.length > MAX_LOCATION_HISTORY) {
    locationHistory.shift();
  }
}

/**
 * Process a new GPS position and sync to server
 */
async function processGeoPosition(position, source = 'browser-gps') {
  const { latitude, longitude } = position.coords;
  const reportedAccuracy = Number(position.coords.accuracy);
  const accuracyMeters = Number.isFinite(reportedAccuracy) && reportedAccuracy >= 0 && reportedAccuracy <= 5000
    ? Number(reportedAccuracy.toFixed(1))
    : null;
  const hasReliableFix = Number.isFinite(accuracyMeters) && Number(accuracyMeters) <= MAX_SYNC_ACCURACY_METERS;

  if (!hasReliableFix) {
    if (lastSyncedLocationPayload && Number.isFinite(Number(lastSyncedLocationPayload.lat)) && Number.isFinite(Number(lastSyncedLocationPayload.lng))) {
      currentUserLocation = `${Number(lastSyncedLocationPayload.lat).toFixed(4)}, ${Number(lastSyncedLocationPayload.lng).toFixed(4)} (stable)`;
      updateProfileUI();
      await syncSessionLocation(lastSyncedLocationPayload, { heartbeat: true });
    } else {
      currentUserLocation = 'Waiting for precise GPS fix...';
      updateProfileUI();
    }
    if (reloadLocationBtn) reloadLocationBtn.classList.remove('spinning');
    return;
  }
  
  // Anti-spoofing: Check for unrealistic movement
  const spoofCheck = detectLocationSpoofing(latitude, longitude, Date.now());
  
  const locationPayload = {
    lat: Number(latitude.toFixed(6)),
    lng: Number(longitude.toFixed(6)),
    accuracyMeters,
    capturedAt: new Date().toISOString(),
    source,
    // Include anti-spoofing metadata
    spoofingDetected: spoofCheck.spoofed,
    spoofingReason: spoofCheck.reason || null,
  };

  const isWithinManualPrecisionWindow = manualPrecisionDeadlineMs > 0 && Date.now() < manualPrecisionDeadlineMs;
  const isPreciseEnoughForManual = Number.isFinite(accuracyMeters) && Number(accuracyMeters) <= MANUAL_PRECISE_ACCURACY_METERS;
  if (isWithinManualPrecisionWindow && !isPreciseEnoughForManual) {
    currentUserLocation = 'Refining GPS fix...';
    updateProfileUI();
    if (lastSyncedLocationPayload) {
      await syncSessionLocation(lastSyncedLocationPayload, { heartbeat: true });
    }
    if (reloadLocationBtn) reloadLocationBtn.classList.remove('spinning');
    return;
  }

  if (isPreciseEnoughForManual) {
    if (manualPrecisionTimeoutTimer) {
      window.clearTimeout(manualPrecisionTimeoutTimer);
      manualPrecisionTimeoutTimer = null;
    }
    manualPrecisionDeadlineMs = 0;
  }

  if (spoofCheck.spoofed) {
    // Do not expose suspicious coordinates in UI to avoid confusion.
    currentUserLocation = 'Location error (suspicious reading ignored)';
    updateProfileUI();
    if (lastSyncedLocationPayload) {
      await syncSessionLocation(lastSyncedLocationPayload, { heartbeat: true });
    } else {
      await syncSessionLocation(null, { heartbeat: true });
    }
    if (reloadLocationBtn) reloadLocationBtn.classList.remove('spinning');
    return;
  }

  // Only use reasonably accurate fixes for velocity history.
  if (hasReliableFix) {
    addToLocationHistory(latitude, longitude);
  }

  // Format coordinates with accuracy indicator for display
  let displayLocation = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
  if (accuracyMeters && accuracyMeters > MIN_ACCURACY_THRESHOLD) {
    displayLocation += ' (low accuracy)';
  }
  
  currentUserLocation = displayLocation;
  updateProfileUI();
  if (hasReliableFix) {
    cacheLastKnownLocation(locationPayload);
  }
  
  // Keep existing stable GPS fix if the new reading is too noisy.
  if (hasReliableFix && hasLocationChangedSignificantly(locationPayload, lastSyncedLocationPayload)) {
    lastSyncedLocationPayload = locationPayload;
    await syncSessionLocation(locationPayload);
  }
  
  if (reloadLocationBtn) reloadLocationBtn.classList.remove('spinning');
}

/**
 * Start continuous location watching using watchPosition for real-time tracking.
 * This provides live location updates as the user moves.
 */
function startLocationWatch() {
  stopLocationWatch();
  
  if (!navigator.geolocation) {
    console.warn('Geolocation not supported');
    return;
  }
  
  locationWatchId = navigator.geolocation.watchPosition(
    (position) => {
      processGeoPosition(position, 'browser-gps-watch');
    },
    (error) => {
      console.log('Geolocation watch error:', error);
      // Don't update UI for transient watch errors, keep last known location
    },
    {
      enableHighAccuracy: true,
      timeout: 30000,
      maximumAge: 3000, // Prefer fresher points to reduce stale jumps.
    }
  );
}

/**
 * Get user location - uses watchPosition for continuous tracking when logged in.
 * Falls back to getCurrentPosition for one-time anonymous usage.
 */
async function getUserLocation(options = {}) {
  const requestId = ++activeLocationRequestId;
  const manualRefresh = options?.manualRefresh === true;
  if (manualRefresh) {
    if (manualPrecisionTimeoutTimer) {
      window.clearTimeout(manualPrecisionTimeoutTimer);
      manualPrecisionTimeoutTimer = null;
    }
    manualPrecisionDeadlineMs = Date.now() + MANUAL_PRECISION_WAIT_MS;
    manualPrecisionTimeoutTimer = window.setTimeout(() => {
      manualPrecisionTimeoutTimer = null;
      if (manualPrecisionDeadlineMs <= 0) {
        return;
      }

      manualPrecisionDeadlineMs = 0;
      if (currentUserLocation === 'Refining GPS fix...') {
        if (lastSyncedLocationPayload) {
          currentUserLocation = `${Number(lastSyncedLocationPayload.lat).toFixed(4)}, ${Number(lastSyncedLocationPayload.lng).toFixed(4)} (best available)`;
        } else {
          currentUserLocation = 'Location temporarily low accuracy';
        }
        updateProfileUI();
      }
    }, MANUAL_PRECISION_WAIT_MS + 120);
  }

  const isLatestRequest = () => requestId === activeLocationRequestId;
  const finishRequest = () => {
    if (!isLatestRequest()) return;
    locationRefreshInFlight = false;
    if (reloadLocationBtn) {
      reloadLocationBtn.classList.remove('spinning');
      reloadLocationBtn.disabled = false;
    }

    if (queuedManualRefresh) {
      const waitMs = Math.max(0, LOCATION_REFRESH_COOLDOWN_MS - (Date.now() - lastManualLocationRefreshAtMs));
      queuedManualRefresh = false;
      if (queuedManualRefreshTimer) {
        window.clearTimeout(queuedManualRefreshTimer);
      }
      queuedManualRefreshTimer = window.setTimeout(() => {
        queuedManualRefreshTimer = null;
        if (locationRefreshInFlight) {
          queuedManualRefresh = true;
          return;
        }
        lastManualLocationRefreshAtMs = Date.now();
        currentUserLocation = 'Searching...';
        updateProfileUI();
        getUserLocation({ manualRefresh: true });
      }, waitMs);
    }
  };

  locationRefreshInFlight = true;
  if (reloadLocationBtn) {
    reloadLocationBtn.classList.add('spinning');
    reloadLocationBtn.disabled = true;
  }
  
  if (!navigator.geolocation) {
    if (!isLatestRequest()) {
      finishRequest();
      return;
    }

    const usedCachedLocation = isLoggedIn
      ? false
      : await applyCachedLocationFallback(null);
    const usedApproximateLocation = usedCachedLocation
      ? false
      : await applyApproximateIpLocationFallback(null);
    if (!usedCachedLocation && !usedApproximateLocation) {
      currentUserLocation = 'Geolocation not supported';
      updateProfileUI();
    }
    finishRequest();
    return;
  }
  
  // First, get an immediate position
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      if (!isLatestRequest()) {
        return;
      }

      await processGeoPosition(position, manualRefresh ? 'browser-gps-manual' : 'browser-gps');
      
      // Start continuous watching for logged-in users
      if (isLoggedIn) {
        startLocationWatch();
      }

      finishRequest();
    },
    async (error) => {
      if (!isLatestRequest()) {
        return;
      }

      console.log('Geolocation error:', error);

      // During manual refresh spam, keep the last stable fix instead of replaying stale cached fallback.
      if (manualRefresh && lastSyncedLocationPayload) {
        currentUserLocation = 'Waiting for live GPS fix...';
        updateProfileUI();
        await syncSessionLocation(null, { heartbeat: true });
        finishRequest();
        return;
      }

      currentUserLocation = formatGeoErrorMessage(error);
      updateProfileUI();
      const usedCachedLocation = isLoggedIn
        ? false
        : await applyCachedLocationFallback(error);
      if (!usedCachedLocation) {
        await syncSessionLocation(null, { heartbeat: true });
      }

      finishRequest();
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 15000,
    }
  );
}

// ───────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ───────────────────────────────────────────────────────────────────
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ───────────────────────────────────────────────────────────────────
// SETTINGS MODAL
// ───────────────────────────────────────────────────────────────────
function openSettings() {
  settingsModal.classList.add('active');
  if (modalOverlay) modalOverlay.classList.add('active');
  renderUserAvatarUI();
}

function closeSettings() {
  settingsModal.classList.remove('active');
  if (modalOverlay) modalOverlay.classList.remove('active');
}

async function saveSettings() {
  const nameVal = userName.value.trim();
  if (nameVal) {
    currentUserName = nameVal;
    localStorage.setItem('userName', currentUserName);
    updateProfileUI();
  }
  const emailVal = userEmail ? userEmail.value.trim() : '';
  if (emailVal) {
    localStorage.setItem('userEmail', emailVal);
  }

  if (pendingProfilePhotoFile) {
    pendingProfilePhotoFile = null;
    revokePendingProfilePhotoPreview();
    renderUserAvatarUI();
  }

  closeSettings();
}

async function clearAllConversations() {
  if (!confirm('Are you sure you want to delete all conversations? This cannot be undone.')) return;
  try {
    const response = await fetch('/api/conversations');
    if (!response.ok) throw new Error('Failed to fetch conversations');
    const conversations = await response.json();
    await Promise.all(conversations.map(conv =>
      fetch(`/api/conversations/${conv.id}`, { method: 'DELETE' })
    ));
    closeSettings();
    await startNewChat();
  } catch (error) {
    console.error('Error clearing conversations:', error);
    showFriendlyError('Failed to clear conversations', error.toString());
  }
}

async function exportConversations() {
  try {
    const response = await fetch('/api/conversations');
    if (!response.ok) throw new Error('Failed to fetch conversations');
    const conversations = await response.json();
    const details = await Promise.all(
      conversations.map(conv => fetch(`/api/conversations/${conv.id}`).then(r => r.json()))
    );
    const blob = new Blob([JSON.stringify(details, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `openci-conversations-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    if (a.parentNode) {
      a.parentNode.removeChild(a);
    }
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error exporting conversations:', error);
    showFriendlyError('Failed to export conversations', error.toString());
  }
}

// ═══════════════════════════════════════════════════════════════
// RATE LIMITING (Frontend)
// ═══════════════════════════════════════════════════════════════
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_PAUSE_SEC = 15;
const CAPTCHA_FAIL_LOCKOUT_SEC = 5 * 60; // 5 minutes
const LOCAL_CAPTCHA_MAX_ATTEMPTS = 3;
let messageTimestamps = [];
let rateLimitPaused = false;
let countdownInterval = null;
let recaptchaEnabled = false;
let recaptchaSiteKey = '';
let recaptchaWidgetId = null;
let localCaptchaExpectedAnswer = null;
let localCaptchaAttemptCount = 0;

async function loadCaptchaConfig() {
  try {
    const response = await fetch('/api/captcha/config', { credentials: 'include' });
    if (!response.ok) return;
    const data = await response.json();
    if (
      data &&
      data.provider === 'recaptcha' &&
      data.enabled === true &&
      typeof data.siteKey === 'string' &&
      data.siteKey.trim()
    ) {
      recaptchaEnabled = true;
      recaptchaSiteKey = data.siteKey.trim();
    }
  } catch (error) {
    console.warn('Captcha config unavailable, using local fallback captcha.', error);
  }
}

function getRecaptchaApi() {
  return window.grecaptcha && typeof window.grecaptcha.render === 'function'
    ? window.grecaptcha
    : null;
}

function completeCaptchaSuccess() {
  hideCaptcha();
  localCaptchaExpectedAnswer = null;
  localCaptchaAttemptCount = 0;
  resetRateLimit();
  messageInput.focus();
}

function showCaptchaInlineError(message) {
  const errorEl = document.getElementById('captchaError');
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  }
}

function fallbackToLocalCaptcha(message) {
  recaptchaEnabled = false;
  recaptchaWidgetId = null;
  localCaptchaAttemptCount = 0;
  renderLocalCaptchaChallenge();
  if (message) {
    showCaptchaInlineError(message);
  }
}

function showCaptchaFailure(message) {
  const errorEl = document.getElementById('captchaError');
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  }

  setTimeout(() => {
    hideCaptcha();
    startRateLimitPause(CAPTCHA_FAIL_LOCKOUT_SEC);
  }, 1200);
}

async function verifyRecaptchaToken(token) {
  try {
    const response = await fetch('/api/captcha/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success !== true) {
      const errorCode = typeof data?.error === 'string' ? data.error : '';
      if (errorCode === 'captcha_not_configured' || errorCode === 'captcha_verification_failed') {
        fallbackToLocalCaptcha('reCAPTCHA is temporarily unavailable. Use quick verification below.');
        return;
      }
      showCaptchaFailure('Verification failed! Locked out for 5 minutes.');
      return;
    }

    completeCaptchaSuccess();
  } catch (error) {
    console.error('reCAPTCHA verification request failed:', error);
    showCaptchaFailure('Verification failed! Locked out for 5 minutes.');
  }
}

function renderRecaptchaWidget() {
  if (!recaptchaEnabled || !recaptchaSiteKey) return;

  const recaptchaApi = getRecaptchaApi();
  const widgetHost = document.getElementById('captchaRecaptchaWidget');
  if (!recaptchaApi || !widgetHost) {
    return;
  }

  if (recaptchaWidgetId !== null) {
    try {
      recaptchaApi.reset(recaptchaWidgetId);
    } catch (error) {
      console.warn('reCAPTCHA reset warning:', error);
    }
  }

  try {
    recaptchaWidgetId = recaptchaApi.render('captchaRecaptchaWidget', {
      sitekey: recaptchaSiteKey,
      theme: 'light',
      callback: (token) => {
        verifyRecaptchaToken(token);
      },
      'expired-callback': () => {
        fallbackToLocalCaptcha('Verification expired. Use quick verification below.');
      },
      'error-callback': () => {
        fallbackToLocalCaptcha('reCAPTCHA failed to load. Use quick verification below.');
      },
    });
  } catch (error) {
    console.error('reCAPTCHA render failed, switching to local fallback:', error);
    fallbackToLocalCaptcha('reCAPTCHA failed to initialize. Use quick verification below.');
  }
}

function renderLocalCaptchaChallenge() {
  const widgetWrap = document.getElementById('captchaRecaptchaWrap');
  if (!widgetWrap) return;

  const left = Math.floor(Math.random() * 9) + 2;
  const right = Math.floor(Math.random() * 9) + 2;
  localCaptchaExpectedAnswer = left + right;

  widgetWrap.innerHTML = `
    <div class="captcha-fallback" id="captchaFallbackWrap">
      <p class="captcha-fallback-title">Quick verification</p>
      <p class="captcha-fallback-question">What is ${left} + ${right}?</p>
      <div class="captcha-fallback-input-row">
        <input id="captchaFallbackInput" type="number" inputmode="numeric" class="captcha-fallback-input" placeholder="Enter answer" />
        <button id="captchaFallbackSubmit" type="button" class="btn btn-primary">Verify</button>
      </div>
    </div>
  `;

  const inputEl = document.getElementById('captchaFallbackInput');
  const submitEl = document.getElementById('captchaFallbackSubmit');
  const errorEl = document.getElementById('captchaError');
  if (errorEl) {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
  }

  const verifyLocalCaptcha = () => {
    const value = Number((inputEl && inputEl.value) || '');
    if (Number.isFinite(value) && value === localCaptchaExpectedAnswer) {
      completeCaptchaSuccess();
      return;
    }

    localCaptchaAttemptCount += 1;
    if (localCaptchaAttemptCount >= LOCAL_CAPTCHA_MAX_ATTEMPTS) {
      showCaptchaFailure('Too many failed attempts. Locked out for 5 minutes.');
      return;
    }

    if (errorEl) {
      const attemptsLeft = LOCAL_CAPTCHA_MAX_ATTEMPTS - localCaptchaAttemptCount;
      errorEl.textContent = `Incorrect answer. ${attemptsLeft} attempt(s) left.`;
      errorEl.style.display = 'block';
    }

    renderLocalCaptchaChallenge();
  };

  if (submitEl) {
    submitEl.addEventListener('click', verifyLocalCaptcha);
  }
  if (inputEl) {
    inputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        verifyLocalCaptcha();
      }
    });
    inputEl.focus();
  }
}

function checkRateLimit() {
  if (rateLimitPaused) return false;

  const now = Date.now();
  // Remove timestamps outside the window
  messageTimestamps = messageTimestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);

  if (messageTimestamps.length >= RATE_LIMIT_MAX) {
    startRateLimitPause(RATE_LIMIT_PAUSE_SEC);
    return false;
  }

  messageTimestamps.push(now);
  return true;
}

function startRateLimitPause(seconds, requiresCaptcha = true) {
  rateLimitPaused = true;
  messageInput.disabled = true;
  sendBtn.disabled = true;

  // Persist the pause end time so it survives page reloads
  const pausedUntil = Date.now() + (seconds * 1000);
  localStorage.setItem('rateLimitPausedUntil', pausedUntil.toString());
  localStorage.setItem('messageTimestamps', JSON.stringify(messageTimestamps));

  const countdownEl = document.getElementById('rateLimitCountdown');
  const countdownSecondsEl = document.getElementById('countdownSeconds');
  const countdownFillEl = document.getElementById('countdownFill');
  const countdownTextEl = document.getElementById('countdownText');

  if (countdownEl) countdownEl.style.display = 'block';

  let remaining = seconds;
  const totalSeconds = seconds;

  if (countdownInterval) clearInterval(countdownInterval);

  function updateCountdown() {
    if (countdownSecondsEl) countdownSecondsEl.textContent = remaining;
    if (countdownFillEl) {
      countdownFillEl.style.width = ((remaining / totalSeconds) * 100) + '%';
    }

    if (remaining <= 0) {
      clearInterval(countdownInterval);
      if (countdownEl) countdownEl.style.display = 'none';
      localStorage.removeItem('rateLimitPausedUntil');
      if (requiresCaptcha) {
        // Show CAPTCHA after countdown
        showCaptcha();
      } else {
        resetRateLimit();
      }
      return;
    }
    remaining--;
  }

  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 1000);
}

function resetRateLimit() {
  rateLimitPaused = false;
  messageTimestamps = [];
  messageInput.disabled = false;
  sendBtn.disabled = false;
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  const countdownEl = document.getElementById('rateLimitCountdown');
  if (countdownEl) countdownEl.style.display = 'none';
  // Clear all persisted state including captcha pending flag
  localStorage.removeItem('rateLimitPausedUntil');
  localStorage.removeItem('messageTimestamps');
  localStorage.removeItem('rateLimitCaptchaPending');
}

// Restore rate limit state after page reload
function restoreRateLimitState() {
  // Restore message timestamps
  try {
    const saved = localStorage.getItem('messageTimestamps');
    if (saved) {
      const now = Date.now();
      messageTimestamps = JSON.parse(saved).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    }
  } catch (e) { /* ignore parse errors */ }

  // Restore active pause/countdown
  const pausedUntilStr = localStorage.getItem('rateLimitPausedUntil');
  if (pausedUntilStr) {
    const pausedUntil = parseInt(pausedUntilStr, 10);
    const now = Date.now();
    const remainingMs = pausedUntil - now;

    if (remainingMs > 0) {
      // Still paused — resume countdown with remaining seconds
      const remainingSec = Math.ceil(remainingMs / 1000);
      startRateLimitPause(remainingSec);
      return; // countdown will call showCaptcha when done
    } else {
      // Pause expired — fall through to captcha check below
      localStorage.removeItem('rateLimitPausedUntil');
    }
  }

  // If captcha was pending (unsolved before reload), re-show it
  if (localStorage.getItem('rateLimitCaptchaPending') === '1') {
    rateLimitPaused = true;
    messageInput.disabled = true;
    sendBtn.disabled = true;
    showCaptcha();
  }
}

// ═══════════════════════════════════════════════════════════════
// CAPTCHA MODAL (reCAPTCHA only)
// ═══════════════════════════════════════════════════════════════
function showCaptcha() {
  const modal = document.getElementById('captchaModal');
  const errorEl = document.getElementById('captchaError');
  if (errorEl) errorEl.style.display = 'none';
  if (modal) modal.style.display = 'flex';

  // Persist so page reload still shows the CAPTCHA
  localStorage.setItem('rateLimitCaptchaPending', '1');

  const widgetWrap = document.getElementById('captchaRecaptchaWrap');
  if (widgetWrap) {
    widgetWrap.innerHTML = '<div id="captchaRecaptchaWidget"></div>';
    recaptchaWidgetId = null;
  }

  if (recaptchaEnabled && recaptchaSiteKey) {
    renderRecaptchaWidget();
    return;
  }

  renderLocalCaptchaChallenge();
}

function hideCaptcha() {
  const modal = document.getElementById('captchaModal');
  if (modal) modal.style.display = 'none';

  const recaptchaApi = getRecaptchaApi();
  if (recaptchaApi && recaptchaWidgetId !== null) {
    try {
      recaptchaApi.reset(recaptchaWidgetId);
    } catch (error) {
      console.warn('reCAPTCHA reset warning:', error);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('captchaCloseBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      hideCaptcha();
      startRateLimitPause(CAPTCHA_FAIL_LOCKOUT_SEC);
    });
  }
});



// ═══════════════════════════════════════════════════════════════
// FRIENDLY ERROR OVERLAY
// ═══════════════════════════════════════════════════════════════
let lastFailedAction = null;

function showFriendlyError(userMessage, technicalDetails) {
  const overlay = document.getElementById('errorOverlay');
  const detailsEl = document.getElementById('errorTechnicalDetails');

  if (!overlay) {
    // Fallback if overlay doesn't exist
    console.error('Error overlay not found. Error:', userMessage, technicalDetails);
    return;
  }

  if (detailsEl) {
    detailsEl.textContent = technicalDetails || 'No additional details available.';
  }

  overlay.style.display = 'flex';
}

function hideFriendlyError() {
  const overlay = document.getElementById('errorOverlay');
  if (overlay) overlay.style.display = 'none';
}

// Error overlay event listeners
document.addEventListener('DOMContentLoaded', () => {
  const tryAgainBtn = document.getElementById('errorTryAgainBtn');
  const goHomeBtn = document.getElementById('errorGoHomeBtn');

  if (tryAgainBtn) {
    tryAgainBtn.addEventListener('click', () => {
      if (aiServiceHardBlocked) {
        showFriendlyError('AI service limit reached', aiServiceBlockReason || 'AI provider limit is active. Please try again later.');
        return;
      }
      hideFriendlyError();
      // Try to resend or just let user try again
      messageInput.focus();
    });
  }

  if (goHomeBtn) {
    goHomeBtn.addEventListener('click', async () => {
      hideFriendlyError();
      await startNewChat();
    });
  }
});

// Make global functions available
window.deleteConversation = deleteConversation;
window.loadConversation = loadConversation;
window.showFriendlyError = showFriendlyError;

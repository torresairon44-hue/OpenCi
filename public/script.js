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
let anonymousHistory = [];
let pendingSuggestedPrompt = false;
let pendingImages = [];
const LANDING_STATE_FADE_MS = 280;
const DEFAULT_CHAT_TITLE = 'OpenCI Help Desk';

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
const profileName = document.getElementById('profileName');
const profileRole = document.getElementById('profileRole');
const profileLocation = document.getElementById('profileLocation');
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
const modalOverlay = document.getElementById('modalOverlay');
const settingsBtn = document.getElementById('settingsBtn');

function setVisibleChatTitle(title) {
  if (!chatTitle) return;
  if (isLoggedIn) {
    chatTitle.textContent = DEFAULT_CHAT_TITLE;
    return;
  }

  chatTitle.textContent = title && title.trim() ? title : DEFAULT_CHAT_TITLE;
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
  if (authError === 'unauthorized_role') {
    alert('Login failed: Your Lark account does not have an authorized role (Admin or Fieldman).');
    window.history.replaceState({}, '', '/');
  } else if (authError === 'auth_failed') {
    alert('Login failed: Could not authenticate with Lark. Please try again.');
    window.history.replaceState({}, '', '/');
  }

  // Always start a fresh new chat on page load
  await startNewChat();

  // Sidebar starts collapsed on desktop landing page
  if (window.innerWidth > 768) {
    sidebar.classList.add('desktop-collapsed');
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
      currentUserName = data.name || 'User';
      currentUserRole = data.role
        ? data.role.charAt(0).toUpperCase() + data.role.slice(1)
        : 'Unknown';
      localStorage.setItem('userName', currentUserName);
      localStorage.setItem('userRole', currentUserRole);
      if (data.email) {
        localStorage.setItem('userEmail', data.email);
      }
      updateAuthButtons(true);
      updateProfileUI();

      // If role is unknown, show role selection modal
      if (!data.role || data.role === 'unknown') {
        showRoleSelectionModal();
      }
    } else {
      updateAuthButtons(false);
    }
  } catch (e) {
    console.warn('Auth session check failed:', e);
    updateAuthButtons(false);
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
    if (!response.ok) throw new Error('Failed to set role');
    const data = await response.json();
    currentUserRole = data.role.charAt(0).toUpperCase() + data.role.slice(1);
    localStorage.setItem('userRole', currentUserRole);
    updateProfileUI();
    hideRoleSelectionModal();
  } catch (e) {
    console.error('Error setting role:', e);
    alert('Failed to set role. Please try again.');
  }
}

function updateAuthButtons(loggedIn) {
  if (loginBtn) loginBtn.style.display = loggedIn ? 'none' : 'inline-flex';
  if (logoutBtn) logoutBtn.style.display = loggedIn ? 'inline-flex' : 'none';
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
    currentUserLocation = 'Searching...';
    updateProfileUI();
    getUserLocation();
  });

  // Auth buttons
  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      // Redirect to Lark OAuth — the server handles the rest
      window.location.href = '/api/auth/lark';
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      } catch (e) {
        console.warn('Logout request failed:', e);
      }
      isLoggedIn = false;
      currentUserId = null;
      currentUserName = 'User';
      currentUserRole = 'Identifying...';
      localStorage.removeItem('userName');
      localStorage.removeItem('userRole');
      updateAuthButtons(false);
      await startNewChat();
    });
  }

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
    settingsBtn.addEventListener('click', openSettings);
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

  // Clear All Conversations
  if (clearConversationsBtn) {
    clearConversationsBtn.addEventListener('click', clearAllConversations);
  }

  // Export Conversations
  if (exportDataBtn) {
    exportDataBtn.addEventListener('click', exportConversations);
  }

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
      applyTheme(next);
      updateThemeSelect(next);

      setTimeout(() => {
        document.body.classList.remove('theme-transitioning');
      }, 600);
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

  // ── Idle avatar shake ──────────────────────────────────────────
  let idleShakeTimer = null;
  let idleShakeRepeatTimer = null;

  function triggerAvatarShake() {
    const avatars = document.querySelectorAll('.message-assistant .message-avatar');
    if (avatars.length) {
      const last = avatars[avatars.length - 1];
      last.animate([
        { translate: '0px' },
        { translate: '-5px' },
        { translate: '5px' },
        { translate: '-4px' },
        { translate: '4px' },
        { translate: '-2px' },
        { translate: '2px' },
        { translate: '0px' }
      ], { duration: 700, easing: 'ease-in-out', composite: 'add' });
    }
    idleShakeRepeatTimer = setTimeout(triggerAvatarShake, 8000);
  }

  function resetIdleShakeTimer() {
    clearTimeout(idleShakeTimer);
    clearTimeout(idleShakeRepeatTimer);
    idleShakeTimer = setTimeout(triggerAvatarShake, 5000);
  }

  messageInput.addEventListener('input', resetIdleShakeTimer);
  resetIdleShakeTimer();
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
        let details = '';
        try {
          const errorData = await response.json();
          details = errorData?.error || errorData?.message || (Array.isArray(errorData?.errors) && errorData.errors[0]?.msg) || '';
        } catch (_err) {
          // Ignore JSON parse failure and keep generic status text.
        }
        throw new Error(`HTTP error! status: ${response.status}${details ? ` - ${details}` : ''}`);
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
        let details = '';
        try {
          const errorData = await response.json();
          details = errorData?.error || errorData?.message || (Array.isArray(errorData?.errors) && errorData.errors[0]?.msg) || '';
        } catch (_err) {
          // Ignore JSON parse failure and keep generic status text.
        }
        throw new Error(`HTTP error! status: ${response.status}${details ? ` - ${details}` : ''}`);
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
      // Update sidebar role if backend detected one
      if (data.detectedRole) {
        currentUserRole = data.detectedRole.charAt(0).toUpperCase() + data.detectedRole.slice(1);
        localStorage.setItem('userRole', currentUserRole);
        updateProfileUI();
      }
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
    // Check if it's a rate limit error from backend
    if (error.message && error.message.includes('429')) {
      startRateLimitPause(15);
    } else {
      showFriendlyError('Failed to send message', error.toString());
    }
  } finally {
    isLoading = false;
    messageInput.disabled = false;
    sendBtn.disabled = false;
    messageInput.focus();
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
  avatarEl.src = 'headai.png';
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
  const messageText = typeof content === 'string' ? content : String(content || '');
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
    avatarEl.src = 'headai.png';
    avatarEl.alt = 'OpenCI';
  } else {
    // User avatar - simple circle with initials or icon
    const userIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="16" fill="#22c55e"/>
      <circle cx="16" cy="10" r="4" fill="white"/>
      <path d="M 8 24 Q 8 18 16 18 Q 24 18 24 24" fill="white"/>
    </svg>`;
    avatarEl.src = 'data:image/svg+xml,' + encodeURIComponent(userIconSvg);
    avatarEl.alt = 'User';
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
      icon: 'headai.png'
    });
  }

  if (autoScroll) {
    messagesWrapper.scrollTop = messagesWrapper.scrollHeight;
  }
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
    imageSrc: '1.jpg',
    fileType: 'PNG',
    category: 'Credit Investigation',
    title: 'OpenCI Preview 01',
    caption: 'Drop your first showcase screenshot in public/1.png.',
  },
  {
    imageSrc: '2.jpg',
    fileType: 'PNG',
    category: 'Skips and Collect',
    title: 'OpenCI Preview 02',
    caption: 'Drop your second showcase screenshot in public/2.png.',
  },
  {
    imageSrc: '3.jpg',
    fileType: 'PNG',
    category: 'Demand Letter',
    title: 'OpenCI Preview 03',
    caption: 'Drop your third showcase screenshot in public/3.png.',
  },
  {
    imageSrc: '4.jpg',
    fileType: 'PNG',
    category: 'TeleCI',
    title: 'OpenCI Preview 04',
    caption: 'Drop your fourth showcase screenshot in public/4.png.',
  },
  {
    imageSrc: '5.jpg',
    fileType: 'PNG',
    category: 'OpenCI Files',
    title: 'OpenCI Preview 05',
    caption: 'Drop your fifth showcase screenshot in public/5.png.',
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

      const displayTitle = conv.title && conv.title.trim() ? escapeHtml(conv.title) : 'OpenCI Help Desk';

      item.innerHTML = `
        <div class="conversation-title">${displayTitle}</div>
        <div class="conversation-actions">
          <button class="conversation-edit-btn" title="Rename" style="display: none;">
            <i class="fas fa-edit"></i>
          </button>
          <button class="conversation-delete-btn" title="Delete">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      `;

      item.addEventListener('click', (e) => {
        // Only load conversation if delete or edit button was not clicked
        if (!e.target.closest('.conversation-delete-btn') && !e.target.closest('.conversation-edit-btn')) {
          loadConversation(conv.id);
        }
      });

      // Show edit button on hover
      item.addEventListener('mouseenter', () => {
        const editBtn = item.querySelector('.conversation-edit-btn');
        if (editBtn) editBtn.style.display = 'flex';
      });

      item.addEventListener('mouseleave', () => {
        const editBtn = item.querySelector('.conversation-edit-btn');
        if (editBtn) editBtn.style.display = 'none';
      });

      // Add proper event listener for edit button
      const editBtn = item.querySelector('.conversation-edit-btn');
      if (editBtn) {
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          editConversationTitle(conv.id, displayTitle);
        });
      }

      // Add proper event listener for delete button
      const deleteBtn = item.querySelector('.conversation-delete-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteConversation(conv.id);
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

async function editConversationTitle(conversationId, currentTitle) {
  const newTitle = prompt('Enter new chat name:', currentTitle === DEFAULT_CHAT_TITLE ? '' : currentTitle);

  if (newTitle === null || newTitle === undefined) {
    return; // User cancelled
  }

  if (newTitle.trim() === currentTitle || (newTitle.trim() === '' && currentTitle === DEFAULT_CHAT_TITLE)) {
    return; // No change
  }

  try {
    await updateConversationTitle(conversationId, newTitle.trim());
    await loadConversations();
    if (currentConversationId === conversationId) {
      setVisibleChatTitle(newTitle.trim());
    }
  } catch (error) {
    console.error('Error editing conversation title:', error);
    alert('Failed to rename chat');
  }
}

async function deleteConversation(conversationId) {
  try {
    const response = await fetch(`/api/conversations/${conversationId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    if (currentConversationId === conversationId) {
      await startNewChat();
    } else {
      await loadConversations();
    }

  } catch (error) {
    console.error('Error deleting conversation:', error);
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
  profileRole.textContent = currentUserRole;
  profileLocation.textContent = currentUserLocation;
  chatSubtitle.textContent = `Ready to help, ${currentUserName}!`;
  // Sync Settings panel inputs
  if (userName) userName.value = currentUserName;
  const savedEmail = localStorage.getItem('userEmail');
  if (userEmail && savedEmail) userEmail.value = savedEmail;
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
async function getUserLocation() {
  if (reloadLocationBtn) {
    reloadLocationBtn.classList.add('spinning');
  }
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        // Format coordinates with 4 decimal places
        currentUserLocation = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        updateProfileUI();
        if (reloadLocationBtn) reloadLocationBtn.classList.remove('spinning');
      },
      (error) => {
        console.log('Geolocation error:', error);
        currentUserLocation = 'Coordinates unavailable';
        updateProfileUI();
        if (reloadLocationBtn) reloadLocationBtn.classList.remove('spinning');
      }
    );
  } else {
    currentUserLocation = 'Geolocation not supported';
    updateProfileUI();
    if (reloadLocationBtn) reloadLocationBtn.classList.remove('spinning');
  }
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
}

function closeSettings() {
  settingsModal.classList.remove('active');
  if (modalOverlay) modalOverlay.classList.remove('active');
}

function saveSettings() {
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
    document.body.removeChild(a);
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
let messageTimestamps = [];
let rateLimitPaused = false;
let countdownInterval = null;
let turnstileEnabled = false;
let turnstileSiteKey = '';
let turnstileWidgetId = null;

async function loadCaptchaConfig() {
  try {
    const response = await fetch('/api/captcha/config', { credentials: 'include' });
    if (!response.ok) return;
    const data = await response.json();
    if (data && data.enabled === true && typeof data.siteKey === 'string' && data.siteKey.trim()) {
      turnstileEnabled = true;
      turnstileSiteKey = data.siteKey.trim();
    }
  } catch (error) {
    console.warn('Captcha config unavailable, using local fallback captcha.', error);
  }
}

function getTurnstileApi() {
  return window.turnstile && typeof window.turnstile.render === 'function'
    ? window.turnstile
    : null;
}

function completeCaptchaSuccess() {
  hideCaptcha();
  resetRateLimit();
  messageInput.focus();
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

async function verifyTurnstileToken(token) {
  try {
    const response = await fetch('/api/captcha/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success !== true) {
      showCaptchaFailure('Verification failed! Locked out for 5 minutes.');
      return;
    }

    completeCaptchaSuccess();
  } catch (error) {
    console.error('Turnstile verification request failed:', error);
    showCaptchaFailure('Verification failed! Locked out for 5 minutes.');
  }
}

function renderTurnstileWidget() {
  if (!turnstileEnabled || !turnstileSiteKey) return;

  const turnstileApi = getTurnstileApi();
  const widgetHost = document.getElementById('captchaTurnstileWidget');
  if (!turnstileApi || !widgetHost) {
    return;
  }

  if (turnstileWidgetId !== null) {
    try {
      turnstileApi.reset(turnstileWidgetId);
    } catch (error) {
      console.warn('Turnstile reset warning:', error);
    }
    return;
  }

  turnstileWidgetId = turnstileApi.render('#captchaTurnstileWidget', {
    sitekey: turnstileSiteKey,
    theme: 'light',
    callback: (token) => {
      verifyTurnstileToken(token);
    },
    'expired-callback': () => {
      showCaptchaFailure('Verification expired. Locked out for 5 minutes.');
    },
    'error-callback': () => {
      showCaptchaFailure('Verification failed! Locked out for 5 minutes.');
    },
  });
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

function startRateLimitPause(seconds) {
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
      // Show CAPTCHA after countdown
      showCaptcha();
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
// SLIDER PUZZLE CAPTCHA
// ═══════════════════════════════════════════════════════════════
let captchaX = 0;
let captchaY = 0;
let isCaptchaDragging = false;
let captchaDragStartX = 0;
const CAPTCHA_PIECE_SIZE = 40;
const CAPTCHA_TOLERANCE = 8;

function generateCaptchaPuzzle() {
  const canvas = document.getElementById('captchaCanvas');
  const pieceCanvas = document.getElementById('captchaPieceCanvas');
  const sliderTrack = document.getElementById('captchaSliderTrack');
  const sliderThumb = document.getElementById('captchaSliderThumb');
  const errorEl = document.getElementById('captchaError');
  const hintEl = document.querySelector('.captcha-slider-hint');

  if (!canvas || !pieceCanvas) return;

  const ctx = canvas.getContext('2d');
  const pieceCtx = pieceCanvas.getContext('2d');

  // Reset UI
  if (errorEl) errorEl.style.display = 'none';
  if (sliderTrack) sliderTrack.style.width = '44px'; // just the thumb width
  if (sliderThumb) {
    sliderThumb.style.transform = 'translateX(0px)';
    sliderThumb.className = 'captcha-slider-thumb';
  }
  if (pieceCanvas) pieceCanvas.style.transform = 'translateX(0px)';
  if (hintEl) hintEl.style.opacity = '1';

  isCaptchaDragging = false;

  // Randomize puzzle hole position (keep it right-ish so there's room to drag)
  captchaX = Math.floor(Math.random() * (250 - 140)) + 140;
  captchaY = Math.floor(Math.random() * (110 - 20)) + 20;

  // Use the local images from public/ root
  const img = new Image();
  const randomImageId = Math.floor(Math.random() * 4) + 1; // 1 to 4
  img.src = `/assets/captcha/captcha${randomImageId}.jpg`;

  img.onload = () => {
    // 1. Draw full image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // 2. Extract puzzle piece
    pieceCtx.clearRect(0, 0, pieceCanvas.width, pieceCanvas.height);
    pieceCtx.save();
    pieceCtx.beginPath();
    const paddingX = 10;
    drawJigsawPath(pieceCtx, paddingX, captchaY, CAPTCHA_PIECE_SIZE);
    pieceCtx.clip();
    pieceCtx.drawImage(img, paddingX - captchaX, 0, canvas.width, canvas.height);
    pieceCtx.lineWidth = 2;
    pieceCtx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    pieceCtx.stroke();
    pieceCtx.restore();

    // 3. Draw dark hole on main canvas
    ctx.save();
    ctx.beginPath();
    drawJigsawPath(ctx, captchaX, captchaY, CAPTCHA_PIECE_SIZE);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.stroke();
    ctx.restore();

    pieceCanvas.style.transform = 'translateX(0px)';
  };

  img.onerror = () => {
    ctx.fillStyle = '#64748b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '14px sans-serif';
    ctx.fillText('Image failed to load. Try Refresh.', 50, 90);
  };
}

function drawJigsawPath(ctx, x, y, size) {
  const r = size / 4;
  ctx.moveTo(x, y);
  ctx.lineTo(x + size / 2 - r, y);
  ctx.arc(x + size / 2, y, r, Math.PI, 0, false);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x + size, y + size / 2 - r);
  ctx.arc(x + size, y + size / 2, r, -Math.PI / 2, Math.PI / 2, false);
  ctx.lineTo(x + size, y + size);
  ctx.lineTo(x + size / 2 + r, y + size);
  ctx.arc(x + size / 2, y + size, r, 0, Math.PI, true);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x, y + size / 2 + r);
  ctx.arc(x, y + size / 2, r, Math.PI / 2, -Math.PI / 2, true);
  ctx.lineTo(x, y);
}

function showCaptcha() {
  const modal = document.getElementById('captchaModal');
  const checkboxStep = document.getElementById('captchaCheckboxStep');
  const puzzleStep = document.getElementById('captchaPuzzleStep');
  const robotCheck = document.getElementById('captchaRobotCheck');

  if (modal) modal.style.display = 'flex';

  // Always start from checkbox step
  if (checkboxStep) checkboxStep.style.display = 'flex';
  if (puzzleStep) puzzleStep.style.display = 'none';
  if (robotCheck) robotCheck.checked = false;

  // Persist so page reload still shows the CAPTCHA
  localStorage.setItem('rateLimitCaptchaPending', '1');
}

function hideCaptcha() {
  const modal = document.getElementById('captchaModal');
  if (modal) modal.style.display = 'none';

  const turnstileApi = getTurnstileApi();
  if (turnstileApi && turnstileWidgetId !== null) {
    try {
      turnstileApi.reset(turnstileWidgetId);
    } catch (error) {
      console.warn('Turnstile reset warning:', error);
    }
  }
}

function verifyCaptcha(finalOffset) {
  const errorEl = document.getElementById('captchaError');
  const sliderThumb = document.getElementById('captchaSliderThumb');

  const distance = Math.abs(finalOffset);

  if (distance <= CAPTCHA_TOLERANCE) {
    // ✅ Success
    if (sliderThumb) sliderThumb.className = 'captcha-slider-thumb success';
    setTimeout(() => {
      completeCaptchaSuccess();
    }, 500);
  } else {
    // ❌ Fail
    if (sliderThumb) sliderThumb.className = 'captcha-slider-thumb fail';
    if (errorEl) {
      errorEl.textContent = 'Verification failed! Locked out for 5 minutes.';
      errorEl.style.display = 'block';
    }
    setTimeout(() => {
      hideCaptcha();
      startRateLimitPause(CAPTCHA_FAIL_LOCKOUT_SEC);
    }, 1200);
  }
}

// CAPTCHA Slider & Buttons Events
document.addEventListener('DOMContentLoaded', () => {
  const sliderThumb = document.getElementById('captchaSliderThumb');
  const sliderTrack = document.getElementById('captchaSliderTrack');
  const sliderArea = document.getElementById('captchaSliderArea');
  const canvasWrap = document.querySelector('.captcha-canvas-wrap');
  const turnstileWrap = document.getElementById('captchaTurnstileWrap');
  const captchaBottom = document.querySelector('.captcha-bottom');
  const puzzleHint = document.querySelector('.captcha-puzzle-hint');
  const pieceCanvas = document.getElementById('captchaPieceCanvas');
  const hintEl = document.querySelector('.captcha-slider-hint');
  const refreshBtn = document.getElementById('captchaRefreshBtn');
  const closeBtn = document.getElementById('captchaCloseBtn');
  const robotCheck = document.getElementById('captchaRobotCheck');
  const checkboxStep = document.getElementById('captchaCheckboxStep');
  const puzzleStep = document.getElementById('captchaPuzzleStep');

  // Checkbox → reveal puzzle
  if (robotCheck) {
    robotCheck.addEventListener('change', () => {
      if (!robotCheck.checked) return;
      // Animate checkbox step out, puzzle step in
      if (checkboxStep) {
        checkboxStep.style.opacity = '0';
        checkboxStep.style.transition = 'opacity 0.25s ease';
        setTimeout(() => {
          checkboxStep.style.display = 'none';
          if (puzzleStep) {
            puzzleStep.style.display = 'block';
            puzzleStep.style.opacity = '0';
            puzzleStep.style.transition = 'opacity 0.3s ease';
            // Trigger reflow for animation
            void puzzleStep.offsetHeight;
            puzzleStep.style.opacity = '1';
          }

          if (turnstileEnabled) {
            if (turnstileWrap) turnstileWrap.style.display = 'block';
            if (canvasWrap) canvasWrap.style.display = 'none';
            if (sliderArea) sliderArea.style.display = 'none';
            if (captchaBottom) captchaBottom.style.display = 'none';
            if (puzzleHint) puzzleHint.textContent = 'Complete verification to continue';
            renderTurnstileWidget();
          } else {
            if (turnstileWrap) turnstileWrap.style.display = 'none';
            if (canvasWrap) canvasWrap.style.display = 'block';
            if (sliderArea) sliderArea.style.display = 'flex';
            if (captchaBottom) captchaBottom.style.display = 'flex';
            if (puzzleHint) puzzleHint.textContent = 'Drag the piece to fill the gap';
            generateCaptchaPuzzle();
          }
        }, 250);
      }
    });
  }

  if (refreshBtn) refreshBtn.addEventListener('click', generateCaptchaPuzzle);
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      hideCaptcha();
      startRateLimitPause(CAPTCHA_FAIL_LOCKOUT_SEC);
    });
  }

  // Handle Dragging — fixed overflow clamping
  if (!sliderThumb) return;

  function getMaxDrag() {
    if (!sliderArea || !sliderThumb) return 276; // fallback: 320 canvas - 44 thumb
    return sliderArea.offsetWidth - sliderThumb.offsetWidth;
  }

  function handleDragStart(e) {
    if (sliderThumb.classList.contains('success') || sliderThumb.classList.contains('fail')) return;
    isCaptchaDragging = true;
    captchaDragStartX = (e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0].clientX));
    sliderThumb.classList.add('active');
    if (hintEl) hintEl.style.opacity = '0';
    e.preventDefault();
  }

  function handleDragMove(e) {
    if (!isCaptchaDragging) return;
    const clientX = (e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0].clientX));
    let dragDist = clientX - captchaDragStartX;
    const maxDrag = getMaxDrag();

    // Hard clamp — no overflow
    if (dragDist < 0) dragDist = 0;
    if (dragDist > maxDrag) dragDist = maxDrag;

    if (sliderThumb) sliderThumb.style.transform = `translateX(${dragDist}px)`;
    // Track fill: from start to thumb position, capped to sliderArea
    if (sliderTrack) {
      const trackWidth = Math.min(dragDist + sliderThumb.offsetWidth, sliderArea ? sliderArea.offsetWidth : dragDist + 44);
      sliderTrack.style.width = `${trackWidth}px`;
    }
    // Move piece canvas to match drag
    if (pieceCanvas) pieceCanvas.style.transform = `translateX(${dragDist}px)`;
  }

  function handleDragEnd() {
    if (!isCaptchaDragging) return;
    isCaptchaDragging = false;
    sliderThumb.classList.remove('active');

    // Target: piece starts at paddingX=10, hole at captchaX → drag needed = captchaX - 10
    const targetDist = captchaX - 10;
    const currentTransform = pieceCanvas ? pieceCanvas.style.transform : '';
    const match = currentTransform.match(/translateX\(([-\d.]+)px\)/);
    if (match) {
      const actualDist = parseFloat(match[1]);
      verifyCaptcha(actualDist - targetDist);
    } else {
      verifyCaptcha(999);
    }
  }

  sliderThumb.addEventListener('mousedown', handleDragStart);
  sliderThumb.addEventListener('touchstart', handleDragStart, { passive: false });

  window.addEventListener('mousemove', handleDragMove);
  window.addEventListener('touchmove', handleDragMove, { passive: true });

  window.addEventListener('mouseup', handleDragEnd);
  window.addEventListener('touchend', handleDragEnd);
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

const adminCanvas = document.querySelector('.admin-canvas');
const adminCard = document.querySelector('.admin-card');
const modeLabel = document.getElementById('modeLabel');
const modeNote = document.getElementById('modeNote');
const navIndicator = document.getElementById('navIndicator');
const navLinks = Array.from(document.querySelectorAll('.nav-link'));
const adminApprovePanel = document.getElementById('adminApprovePanel');
const approvalTitle = document.getElementById('approvalTitle');
const approvalSubtitle = document.getElementById('approvalSubtitle');
const approvalList = document.getElementById('approvalList');
const approvalActivityList = document.getElementById('approvalActivityList');
const approvalStatusText = document.getElementById('approvalStatusText');
const approvalRefreshBtn = document.getElementById('approvalRefreshBtn');
const approvalFilters = Array.from(document.querySelectorAll('.approval-filter'));
const approvalFiltersGroup = document.getElementById('approvalFilters');
const approvalToggleBtn = document.getElementById('approvalToggleBtn');
const approvalToolbar = document.getElementById('approvalToolbar');
const approvalSearchInput = document.getElementById('approvalSearchInput');
const approvalSortSelect = document.getElementById('approvalSortSelect');
const approvalCount = document.getElementById('approvalCount');
const dashboardPanel = document.getElementById('dashboardPanel');
const dashboardRadial = document.getElementById('dashboardRadial');
const dashboardSpokes = document.getElementById('dashboardSpokes');
const kpiTotalUsers = document.getElementById('kpiTotalUsers');
const kpiAdminCount = document.getElementById('kpiAdminCount');
const kpiFieldmanCount = document.getElementById('kpiFieldmanCount');
const kpiPendingCount = document.getElementById('kpiPendingCount');
const kpiApprovalRate = document.getElementById('kpiApprovalRate');
const fieldmanLocationPanel = document.getElementById('fieldmanLocationPanel');
const fieldmanLocationStatus = document.getElementById('fieldmanLocationStatus');
const fieldmanLocationList = document.getElementById('fieldmanLocationList');
const fieldmanLocationMap = document.getElementById('fieldmanLocationMap');
const fieldmanRefreshBtn = document.getElementById('fieldmanRefreshBtn');
const fieldmanInLuzonCount = document.getElementById('fieldmanInLuzonCount');
const fieldmanExcludedCount = document.getElementById('fieldmanExcludedCount');
const adminUserAvatarShell = document.getElementById('adminUserAvatarShell');
const adminUserAvatarImg = document.getElementById('adminUserAvatarImg');
const adminUserName = document.getElementById('adminUserName');

let currentApprovalStatus = 'pending';
let currentApprovalView = 'activity';
let currentSearchQuery = '';
let currentSortMode = 'newest';
let loadedApprovalItems = [];
let loadedApprovalActivityItems = [];
let canManageLarkUsers = false;
let activeMode = null;
let fieldmanPollTimer = null;
let fieldmanMapInstance = null;
let fieldmanMarkerLayer = null;
let fieldmanLocationAccessGranted = false;
let adminSessionHeartbeatTimer = null;
const DEFAULT_ADMIN_AVATAR_URL = '/assets/branding/ci.png';

const PH_BOUNDS = [[4.0, 116.0], [22.5, 127.5]];
const PH_CENTER = [12.8797, 121.7740];
const modes = {
  learn: {
    label: 'Dashboard',
    note: 'Dashboard overview for learning metrics and quick status checks.',
  },
  prepare: {
    label: 'Fieldman Location',
    note: 'Fieldman location view and readiness coordination panel.',
  },
  sensor: {
    label: 'Admin Approve',
    note: 'Manage Lark Users activity and switch to Admin Approval when needed.',
  },
  execute: {
    label: 'Activity Log',
    note: 'Activity log stream and execution history for audits.',
  },
};

const pathToMode = {
  '/admin': 'learn',
  '/admin/dashboard': 'learn',
  '/admin/learn': 'learn',
  '/admin/fieldman-location': 'prepare',
  '/admin/prepare': 'prepare',
  '/admin/admin-approve': 'sensor',
  '/admin/add-sensor': 'sensor',
  '/admin/activity-log': 'execute',
  '/admin/execute': 'execute',
};

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

function applyAdminIdentity(identity) {
  const displayName = String(identity?.name || 'Admin User').trim() || 'Admin User';
  if (adminUserName) {
    adminUserName.textContent = displayName;
  }

  const avatarUrl = normalizeAvatarUrl(identity?.avatar?.effectiveUrl);
  if (!adminUserAvatarImg) return;

  adminUserAvatarImg.onerror = () => {
    adminUserAvatarImg.src = DEFAULT_ADMIN_AVATAR_URL;
    if (adminUserAvatarShell) {
      adminUserAvatarShell.classList.remove('has-photo');
    }
  };

  if (avatarUrl) {
    adminUserAvatarImg.src = avatarUrl;
    if (adminUserAvatarShell) {
      adminUserAvatarShell.classList.add('has-photo');
    }
    return;
  }

  adminUserAvatarImg.src = DEFAULT_ADMIN_AVATAR_URL;
  if (adminUserAvatarShell) {
    adminUserAvatarShell.classList.remove('has-photo');
  }
}

async function loadAdminIdentity() {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'include' });
    if (!response.ok) return;
    const data = await response.json();
    if (!data.loggedIn) {
      window.location.href = '/';
      return;
    }
    applyAdminIdentity(data);
  } catch (_error) {
    // Keep static fallback identity when session call fails.
  }
}

function commitMode(mode) {
  const selected = modes[mode] || modes.learn;
  if (modeLabel) modeLabel.textContent = selected.label;
  if (modeNote) modeNote.textContent = selected.note;
  if (adminCanvas) adminCanvas.setAttribute('data-mode', mode);
  if (adminApprovePanel) {
    adminApprovePanel.hidden = mode !== 'sensor';
  }
  if (dashboardPanel) {
    dashboardPanel.hidden = mode !== 'learn';
  }
  if (fieldmanLocationPanel) {
    fieldmanLocationPanel.hidden = mode !== 'prepare';
  }
  if (adminCard) {
    adminCard.classList.toggle('prepare-fullmap', mode === 'prepare');
  }
  let activeLink = null;
  navLinks.forEach((link) => {
    link.classList.toggle('is-active', link.dataset.mode === mode);
    if (link.dataset.mode === mode) {
      link.setAttribute('aria-current', 'page');
      activeLink = link;
    } else {
      link.removeAttribute('aria-current');
    }
  });

  if (navIndicator && activeLink) {
    const top = activeLink.offsetTop + Math.round(activeLink.offsetHeight * 0.18);
    const height = Math.round(activeLink.offsetHeight * 0.64);
    navIndicator.style.top = `${top}px`;
    navIndicator.style.height = `${height}px`;
  }

  if (mode === 'sensor') {
    loadCurrentApprovalView();
  }
  if (mode === 'prepare') {
    activateFieldmanLocationMode();
    if (fieldmanMapInstance) {
      window.setTimeout(() => {
        fieldmanMapInstance.invalidateSize();
      }, 80);
    }
  } else {
    stopFieldmanLocationPolling();
  }
  if (mode === 'learn') {
    if (dashboardRadial) {
      dashboardRadial.classList.remove('is-exit-retract');
    }
    if (dashboardSpokes) {
      dashboardSpokes.innerHTML = '';
    }
    loadDashboardSummary();
  } else {
    collapseDashboardSpokes();
  }

  if (adminCanvas) {
    adminCanvas.classList.remove('is-dashboard-exit-fade');
    adminCanvas.classList.remove('is-mode-exit');
    adminCanvas.classList.remove('is-mode-enter');
    if (mode !== 'learn') {
      // Keep tab fade-in for non-dashboard tabs; dashboard uses beam draw as its primary entrance motion.
      void adminCanvas.offsetWidth;
      adminCanvas.classList.add('is-mode-enter');
    }
  }

  activeMode = mode;
}

function runDashboardModeExitTransition(nextMode) {
  if (adminCanvas) {
    adminCanvas.classList.add('is-dashboard-exit-fade');
  }
  if (dashboardRadial) {
    dashboardRadial.classList.add('is-exit-retract');
  }
  const retractDuration = collapseDashboardSpokes();
  const exitDuration = Math.max(1160, retractDuration + 120);

  window.setTimeout(() => {
    if (adminCanvas) {
      adminCanvas.classList.remove('is-dashboard-exit-fade');
    }
    if (dashboardRadial) {
      dashboardRadial.classList.remove('is-exit-retract');
    }
    commitMode(nextMode);
  }, exitDuration);
}

function applyMode(mode) {
  const targetMode = modes[mode] ? mode : 'learn';

  if (activeMode === 'learn' && targetMode !== 'learn') {
    runDashboardModeExitTransition(targetMode);
    return;
  }

  commitMode(targetMode);
}

function setDashboardKpiValue(element, value) {
  if (!element) return;
  element.textContent = String(value);
}

function renderDashboardSpokes(activeUsers = []) {
  if (!dashboardSpokes) return;
  dashboardSpokes.innerHTML = '';

  const total = activeUsers.length;
  if (total === 0) return;

  const angleStep = 360 / total;

  const detailPanel = document.getElementById('userHoverDetail');
  const detailContent = document.getElementById('userDetailContent');
  const defaultPlaceholder = '<div class="detail-placeholder">Hover over a dashboard beam to reveal user identity and location.</div>';

  activeUsers.forEach((user, index) => {
    const role = (user.role || 'fieldman').toLowerCase();
    const angle = -90 + angleStep * index;

    const spoke = document.createElement('div');
    spoke.className = `dashboard-spoke ${role}`;
    spoke.style.setProperty('--angle', `${angle}deg`);
    spoke.style.setProperty('--delay', `${(index * 0.07).toFixed(2)}s`);
    spoke.style.setProperty('--exit-delay', '0s');

    const baseLength = role === 'fieldman' ? 244 : 202;
    const lengthPattern = [-20, -8, 6, 18, -12, 10, 2, -16, 22, -4, 14, -10, 26, -18, 8, 16, -6, 20];
    const roleBias = role === 'fieldman' ? 8 : -4;
    const jitter = lengthPattern[index % lengthPattern.length] + roleBias;
    spoke.style.setProperty('--length', `${Math.max(110, baseLength + jitter)}px`);

    const line = document.createElement('span');
    line.className = 'spoke-line';
    const node = document.createElement('span');
    node.className = 'spoke-node';

    spoke.appendChild(line);
    spoke.appendChild(node);

    // Add Interaction listeners for the Floating Upright Panel
    let trackingFrame = null;

    const updatePosition = () => {
      const nodeRect = node.getBoundingClientRect();
      const viewportWidth = window.innerWidth;

      // Determine if node is on left or right half of VIEWPORT
      const onRightSide = nodeRect.left > (viewportWidth / 2);

      const offsetX = onRightSide ? -190 : 30; // Offset based on card width
      const offsetY = -40; // Center vertically on node

      detailPanel.style.left = `${nodeRect.left + offsetX}px`;
      detailPanel.style.top = `${nodeRect.top + offsetY}px`;

      trackingFrame = requestAnimationFrame(updatePosition);
    };

    spoke.addEventListener('mouseenter', () => {
      detailPanel.removeAttribute('hidden');
      detailPanel.classList.add('is-visible');
      detailContent.innerHTML = `
        <div class="detail-main">
          <div class="detail-name">${user.name}</div>
          <div class="detail-role">${role}</div>
        </div>
      `;
      updatePosition();
    });

    spoke.addEventListener('mouseleave', () => {
      cancelAnimationFrame(trackingFrame);
      detailPanel.classList.remove('is-visible');
      setTimeout(() => {
        if (!detailPanel.classList.contains('is-visible')) {
          detailPanel.setAttribute('hidden', '');
        }
      }, 300);
    });

    dashboardSpokes.appendChild(spoke);
  });

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const spokes = Array.from(dashboardSpokes.querySelectorAll('.dashboard-spoke'));
      spokes.forEach((spoke) => spoke.classList.add('is-live'));
    });
  });
}

function collapseDashboardSpokes() {
  if (!dashboardSpokes) return;
  const spokes = Array.from(dashboardSpokes.querySelectorAll('.dashboard-spoke'));
  if (!spokes.length) return 0;
  const total = spokes.length;
  spokes.forEach((spoke, index) => {
    const reverseIndex = total - 1 - index;
    spoke.style.setProperty('--exit-delay', `${(reverseIndex * 0.045).toFixed(3)}s`);
    spoke.classList.add('is-exit');
  });
  return Math.round(((Math.max(0, total - 1) * 0.045) * 1000) + 520);
}

function runAdminExitTransition(destinationHref) {
  const safeHref = typeof destinationHref === 'string' ? destinationHref : '/';
  if (!safeHref || safeHref.startsWith('#') || safeHref === window.location.pathname) {
    return;
  }

  collapseDashboardSpokes();
  document.body.classList.add('admin-exit');

  window.setTimeout(() => {
    window.location.href = safeHref;
  }, 420);
}

async function loadDashboardSummary() {
  if (!dashboardPanel) return;
  try {
    const response = await fetch('/api/admin/dashboard/summary', {
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error('Failed to load dashboard summary');
    }

    const data = await response.json();
    const users = data.users || {};
    const approvals = data.approvals || {};

    const totalUsers = Number(users.total || 0);
    const adminCount = Number(users.adminCount || 0);
    const fieldmanCount = Number(users.fieldmanCount || 0);

    setDashboardKpiValue(kpiTotalUsers, totalUsers);
    setDashboardKpiValue(kpiAdminCount, adminCount);
    setDashboardKpiValue(kpiFieldmanCount, fieldmanCount);
    setDashboardKpiValue(kpiPendingCount, Number(approvals.pending || 0));
    setDashboardKpiValue(kpiApprovalRate, Number(approvals.approvalRate || 0));
    renderDashboardSpokes(users.recentActiveUsers || []);

    if (dashboardRadial) {
      const safeTotal = totalUsers > 0 ? totalUsers : 1;
      const adminRatio = Math.max(0, Math.min(1, adminCount / safeTotal));
      const fieldmanRatio = Math.max(0, Math.min(1, fieldmanCount / safeTotal));
      dashboardRadial.style.setProperty('--admin-ratio', adminRatio.toFixed(3));
      dashboardRadial.style.setProperty('--fieldman-ratio', fieldmanRatio.toFixed(3));
    }
  } catch (_error) {
    // Keep dashboard visual present even when API is temporarily unavailable.
    setDashboardKpiValue(kpiTotalUsers, 0);
    setDashboardKpiValue(kpiAdminCount, 0);
    setDashboardKpiValue(kpiFieldmanCount, 0);
    setDashboardKpiValue(kpiPendingCount, 0);
    setDashboardKpiValue(kpiApprovalRate, 0);
    renderDashboardSpokes([]);
  }
}

function setFieldmanLocationStatus(message) {
  if (fieldmanLocationStatus) {
    fieldmanLocationStatus.textContent = message;
  }
}

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

function syncFieldmanSessionLocation(locationPayload = null, options = {}) {
  const shouldHeartbeat = options.heartbeat !== false;

  return fetch('/api/auth/session/update', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      location: locationPayload || undefined,
      device: detectClientDeviceInfo(),
      heartbeat: shouldHeartbeat,
    }),
  }).catch(() => null);
}

function stopAdminSessionHeartbeat() {
  if (adminSessionHeartbeatTimer) {
    window.clearInterval(adminSessionHeartbeatTimer);
    adminSessionHeartbeatTimer = null;
  }
}

function startAdminSessionHeartbeat() {
  stopAdminSessionHeartbeat();
  syncFieldmanSessionLocation(null, { heartbeat: true });
  window.setTimeout(() => {
    syncFieldmanSessionLocation(null, { heartbeat: true });
  }, 1200);
  adminSessionHeartbeatTimer = window.setInterval(() => {
    syncFieldmanSessionLocation(null, { heartbeat: true });
  }, 10000);
}

function stopAdminSessionOnExit() {
  try {
    const payload = JSON.stringify({ reason: 'admin-page-unload' });
    const blob = new Blob([payload], { type: 'application/json' });
    navigator.sendBeacon('/api/auth/session/stop', blob);
  } catch (_error) {
    fetch('/api/auth/session/stop', {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'admin-page-unload' }),
    }).catch(() => null);
  }
}

function requestGeolocationAccess() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const locationPayload = {
          lat: Number(position.coords.latitude),
          lng: Number(position.coords.longitude),
          accuracyMeters: Number.isFinite(position.coords.accuracy) ? Number(position.coords.accuracy) : null,
          capturedAt: new Date().toISOString(),
          source: 'admin-fieldman-map',
        };

        await syncFieldmanSessionLocation(locationPayload);
        resolve(true);
      },
      () => {
        resolve(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      }
    );
  });
}

async function activateFieldmanLocationMode() {
  // Render the base map immediately so the panel never appears as a blank white area.
  renderFieldmanLocations([], { inPhilippinesCount: 0, excludedOutOfPhilippinesCount: 0 });

  if (!fieldmanLocationAccessGranted) {
    setFieldmanLocationStatus('Requesting location access to open Fieldman map...');
    const granted = await requestGeolocationAccess();
    if (granted) {
      fieldmanLocationAccessGranted = true;
    } else {
      setFieldmanLocationStatus('Location permission not granted on this device. Showing available fieldman pins only.');
    }
  }

  loadFieldmanLocations();
  startFieldmanLocationPolling();
}

function formatRelativeTime(value) {
  const ms = Date.parse(value || '');
  if (!ms) {
    return 'Unknown';
  }

  const diffSeconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getStatusLabel(statusValue) {
  const status = String(statusValue || 'offline').toLowerCase();
  if (status === 'live') return 'ACTIVE';
  if (status === 'stale') return 'RECENT';
  return 'INACTIVE';
}

function ensureFieldmanMap() {
  if (fieldmanMapInstance || !fieldmanLocationMap || !window.L) {
    return;
  }

  const map = window.L.map(fieldmanLocationMap, {
    zoomControl: true,
    minZoom: 5,
    maxZoom: 18,
    maxBounds: PH_BOUNDS,
    maxBoundsViscosity: 0.8,
  });

  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    referrerPolicy: 'origin',
  }).addTo(map);

  fieldmanMarkerLayer = window.L.layerGroup().addTo(map);
  fieldmanMapInstance = map;
  fieldmanMapInstance.setView(PH_CENTER, 6);
  fieldmanMapInstance.on('zoomend', () => {
    refreshFieldmanMarkerIconsForZoom();
  });

  window.setTimeout(() => {
    fieldmanMapInstance.invalidateSize();
  }, 100);
}

function getMarkerVisualByZoom(zoomValue) {
  const zoom = Number.isFinite(zoomValue) ? zoomValue : 6;
  if (zoom <= 7) {
    return { width: 50, height: 50, pinSize: 42 };
  }
  if (zoom <= 10) {
    return { width: 44, height: 44, pinSize: 37 };
  }
  if (zoom <= 13) {
    return { width: 40, height: 40, pinSize: 32 };
  }
  return { width: 36, height: 36, pinSize: 28 };
}

function getFirstNameWord(nameValue) {
  const text = String(nameValue || '').trim().replace(/\s+/g, ' ');
  if (!text) return 'USER';
  return text.split(' ')[0].slice(0, 10).toUpperCase();
}

function calculateDisplayCoordinates(items) {
  const safeItems = Array.isArray(items) ? items : [];
  const points = safeItems.map((item) => ({
    lat: Number(item.lat),
    lng: Number(item.lng),
  }));

  const zoom = fieldmanMapInstance ? fieldmanMapInstance.getZoom() : 6;
  const spreadPixels = zoom <= 7 ? 6 : zoom <= 10 ? 5 : zoom <= 13 ? 4 : 0;
  const overlapThreshold = zoom <= 7 ? 7 : zoom <= 10 ? 6 : zoom <= 13 ? 5 : 0;
  if (spreadPixels <= 0 || overlapThreshold <= 0 || !fieldmanMapInstance || !window.L) return points;

  const projected = points.map((point) => {
    if (!isValidCoordinate(point.lat, point.lng)) return null;
    return fieldmanMapInstance.project([point.lat, point.lng], zoom);
  });

  const visited = new Array(points.length).fill(false);
  const groups = [];

  for (let i = 0; i < points.length; i += 1) {
    if (visited[i] || !projected[i]) continue;

    const group = [i];
    visited[i] = true;

    for (let j = i + 1; j < points.length; j += 1) {
      if (visited[j] || !projected[j]) continue;
      const dx = projected[i].x - projected[j].x;
      const dy = projected[i].y - projected[j].y;
      const distance = Math.sqrt((dx * dx) + (dy * dy));
      if (distance <= overlapThreshold) {
        group.push(j);
        visited[j] = true;
      }
    }

    groups.push(group);
  }

  groups.forEach((indexes) => {
    if (!Array.isArray(indexes) || indexes.length <= 1) return;
    const angleStep = (Math.PI * 2) / indexes.length;
    indexes.forEach((pointIndex, offsetIndex) => {
      const basePoint = projected[pointIndex];
      if (!basePoint) return;
      const angle = angleStep * offsetIndex;
      const offsetPoint = window.L.point(
        basePoint.x + (Math.cos(angle) * spreadPixels),
        basePoint.y + (Math.sin(angle) * spreadPixels)
      );
      const unprojected = fieldmanMapInstance.unproject(offsetPoint, zoom);
      points[pointIndex] = {
        lat: Number(unprojected.lat),
        lng: Number(unprojected.lng),
      };
    });
  });

  return points;
}

function getFieldmanMarkerIcon(nameValue, roleValue, statusValue, avatarUrlValue = null) {
  const role = String(roleValue || 'fieldman').toLowerCase() === 'admin' ? 'admin' : 'fieldman';
  const status = String(statusValue || 'offline').toLowerCase();
  const visual = getMarkerVisualByZoom(fieldmanMapInstance ? fieldmanMapInstance.getZoom() : 6);
  const firstWord = getFirstNameWord(nameValue);
  const initial = escapeHtml(firstWord.charAt(0) || 'U');
  const avatarUrl = normalizeAvatarUrl(avatarUrlValue);
  const avatarNode = avatarUrl
    ? `<img class="fieldman-pin-avatar" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(String(nameValue || 'User'))}" loading="lazy" />`
    : `<span class="fieldman-pin-initial">${initial}</span>`;
  return window.L.divIcon({
    className: `fieldman-pin-wrap role-${role} is-${status}${avatarUrl ? ' has-avatar' : ''}`,
    html: `
      <span
        class="fieldman-pin-body"
        style="--pin-size:${visual.pinSize}px;"
      >
        <span class="fieldman-pin-shape">
          ${avatarNode}
        </span>
      </span>
    `,
    iconSize: [visual.pinSize, visual.pinSize],
    iconAnchor: [Math.round(visual.pinSize / 2), Math.round(visual.pinSize / 2)],
    popupAnchor: [0, -Math.round(visual.pinSize / 2 + 4)],
  });
}

function refreshFieldmanMarkerIconsForZoom() {
  if (!fieldmanMarkerLayer || !fieldmanMapInstance) return;
  const markerEntries = [];
  fieldmanMarkerLayer.eachLayer((layer) => {
    if (!layer || typeof layer.setIcon !== 'function') return;
    const meta = layer.__fieldmanMeta;
    if (!meta) return;
    markerEntries.push({ layer, meta });
  });

  const displayPoints = calculateDisplayCoordinates(
    markerEntries.map((entry) => ({
      lat: entry.meta.rawLat,
      lng: entry.meta.rawLng,
    }))
  );

  markerEntries.forEach((entry, index) => {
    entry.layer.setIcon(getFieldmanMarkerIcon(entry.meta.name, entry.meta.role, entry.meta.status, entry.meta.avatarUrl));
    if (displayPoints[index] && typeof entry.layer.setLatLng === 'function') {
      entry.layer.setLatLng([displayPoints[index].lat, displayPoints[index].lng]);
    }
  });
}

function isValidCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function setMapViewForItems(items) {
  if (!fieldmanMapInstance || !window.L) return;

  const points = items
    .map((item) => [Number(item.lat), Number(item.lng)])
    .filter(([lat, lng]) => isValidCoordinate(lat, lng));

  if (points.length === 0) {
    fieldmanMapInstance.setView(PH_CENTER, 6);
    return;
  }

  if (points.length === 1) {
    fieldmanMapInstance.setView(points[0], 11);
    return;
  }

  const bounds = window.L.latLngBounds(points);
  fieldmanMapInstance.fitBounds(bounds.pad(0.26), { maxZoom: 11 });
}

function renderFieldmanLocations(items, summary) {
  const safeItems = Array.isArray(items) ? items : [];
  const adminCount = safeItems.filter((item) => String(item.role || '').toLowerCase() === 'admin').length;
  const fieldmanCount = Math.max(0, safeItems.length - adminCount);

  if (fieldmanInLuzonCount) {
    fieldmanInLuzonCount.textContent = `Admin: ${adminCount}`;
  }
  if (fieldmanExcludedCount) {
    fieldmanExcludedCount.textContent = `Fieldman: ${fieldmanCount}`;
  }

  ensureFieldmanMap();
  if (fieldmanMapInstance && fieldmanMarkerLayer && window.L) {
    fieldmanMarkerLayer.clearLayers();

    const itemsForMap = safeItems;
    const displayPoints = calculateDisplayCoordinates(itemsForMap);

    itemsForMap.forEach((item, index) => {
      const lat = Number(item.lat);
      const lng = Number(item.lng);
      if (!isValidCoordinate(lat, lng)) {
        return;
      }

      const displayLat = Number(displayPoints[index]?.lat);
      const displayLng = Number(displayPoints[index]?.lng);
      if (!isValidCoordinate(displayLat, displayLng)) {
        return;
      }

      const rawAccessStatus = String(item.accessStatus || '').toLowerCase();
      const status = rawAccessStatus === 'active'
        ? 'live'
        : rawAccessStatus === 'recent'
          ? 'stale'
          : String(item.freshnessStatus || 'offline').toLowerCase();
      const role = String(item.role || 'fieldman').toLowerCase() === 'admin' ? 'admin' : 'fieldman';
      const avatarUrl = normalizeAvatarUrl(item.avatarUrl);
      const marker = window.L.marker([displayLat, displayLng], {
        icon: getFieldmanMarkerIcon(item.name || 'Unknown User', role, status, avatarUrl),
      });
      marker.__fieldmanMeta = {
        name: item.name || 'Unknown User',
        role,
        status,
        avatarUrl,
        rawLat: lat,
        rawLng: lng,
      };

      const popupTitle = escapeHtml(item.name || 'Unknown Fieldman');
      const popupRole = escapeHtml((item.role || 'fieldman').toUpperCase());
      const popupStatus = escapeHtml(getStatusLabel(status));
      const popupAddress = String(item.address || '').trim() || 'Address unavailable';

      marker.bindPopup(`
        <div class="fieldman-popup">
          <strong>${popupTitle}</strong><br />
          <span>${popupRole}</span><br />
          <span>Status: ${popupStatus}</span><br />
          <span>Address: ${escapeHtml(popupAddress)}</span><br />
          <span>Updated: ${escapeHtml(formatRelativeTime(item.capturedAt))}</span>
        </div>
      `);

      marker.addTo(fieldmanMarkerLayer);
    });

    setMapViewForItems(itemsForMap);
  }

  if (fieldmanLocationList) {
    if (safeItems.length === 0) {
      fieldmanLocationList.innerHTML = '';
    } else {
      fieldmanLocationList.innerHTML = safeItems.map((item) => {
        const name = escapeHtml(item.name || 'Unknown User');
        const lat = Number(item.lat);
        const lng = Number(item.lng);
        const accuracy = Number(item.accuracyMeters);
        const rawAccessStatus = String(item.accessStatus || '').toLowerCase();
        const status = rawAccessStatus === 'active'
          ? 'live'
          : rawAccessStatus === 'recent'
            ? 'stale'
            : String(item.freshnessStatus || 'offline').toLowerCase();
        const role = String(item.role || 'fieldman').toLowerCase() === 'admin' ? 'admin' : 'fieldman';
        const locationText = Number.isFinite(lat) && Number.isFinite(lng)
          ? `${lat.toFixed(4)}, ${lng.toFixed(4)}`
          : 'No coordinates';
        const accuracyText = Number.isFinite(accuracy) ? `${accuracy.toFixed(1)}m` : 'n/a';

        return `
          <article class="fieldman-row">
            <div class="fieldman-row-main">
              <h4>${name}</h4>
              <p>${escapeHtml(locationText)}</p>
            </div>
            <div class="fieldman-row-meta">
              <span class="fieldman-role-chip role-${role}">${role.toUpperCase()}</span>
              <span class="fieldman-chip is-${escapeHtml(status)}">${getStatusLabel(status)}</span>
              <span>Accuracy: ${escapeHtml(accuracyText)}</span>
              <span>Updated: ${escapeHtml(formatRelativeTime(item.capturedAt))}</span>
            </div>
          </article>
        `;
      }).join('');
    }
  }
}

function stopFieldmanLocationPolling() {
  if (fieldmanPollTimer) {
    window.clearInterval(fieldmanPollTimer);
    fieldmanPollTimer = null;
  }
}

function startFieldmanLocationPolling() {
  stopFieldmanLocationPolling();
  fieldmanPollTimer = window.setInterval(() => {
    if (activeMode === 'prepare') {
      loadFieldmanLocations();
    }
  }, 20000);
}

async function loadFieldmanLocations() {
  if (!fieldmanLocationPanel) return;
  setFieldmanLocationStatus('Loading Philippines map positions...');

  try {
    const response = await fetch('/api/admin/fieldman-locations', {
      credentials: 'include',
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Admin authentication is required to view fieldman locations.');
      }
      throw new Error('Failed to load fieldman locations.');
    }

    const payload = await response.json();
    const items = Array.isArray(payload.items) ? payload.items : [];
    const summary = payload.summary || {};
    renderFieldmanLocations(items, summary);
    const adminPins = items.filter((item) => String(item.role || '').toLowerCase() === 'admin').length;
    const fieldmanPins = Math.max(0, items.length - adminPins);
    setFieldmanLocationStatus(`Showing ${items.length} pins in Philippines (${fieldmanPins} fieldman, ${adminPins} admin).`);
  } catch (error) {
    renderFieldmanLocations([], { inPhilippinesCount: 0, excludedOutOfPhilippinesCount: 0 });
    setFieldmanLocationStatus(error instanceof Error ? error.message : 'Failed to load fieldman locations.');
  }
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value || '';
  return div.innerHTML;
}

function setApprovalStatus(message) {
  if (approvalStatusText) {
    approvalStatusText.textContent = message;
  }
}

function formatDateTime(value) {
  const parsed = Date.parse(String(value || ''));
  if (!parsed) return 'N/A';
  return new Date(parsed).toLocaleString();
}

function getActivityStatusLabel(statusValue) {
  const normalized = String(statusValue || 'offline').toLowerCase();
  if (normalized === 'active') return 'ACTIVE';
  if (normalized === 'recent') return 'RECENT';
  return 'INACTIVE';
}

async function copyTextToClipboard(value) {
  const text = String(value || '');
  if (!text) return false;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_err) {
      // Fall through to legacy copy strategy.
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand('copy');
    if (textarea.parentNode) {
      textarea.parentNode.removeChild(textarea);
    }
    return copied;
  } catch (_err) {
    return false;
  }
}

function closeApprovalActionMenus() {
  const menuRoots = Array.from(document.querySelectorAll('.approval-kebab'));
  menuRoots.forEach((root) => {
    const toggleButton = root.querySelector('.approval-kebab-btn');
    const menu = root.querySelector('.approval-kebab-menu');
    if (menu instanceof HTMLElement) {
      menu.hidden = true;
    }
    if (toggleButton instanceof HTMLElement) {
      toggleButton.setAttribute('aria-expanded', 'false');
    }
    root.classList.remove('is-open');
  });
}

function toggleApprovalActionMenu(buttonElement) {
  const menuRoot = buttonElement.closest('.approval-kebab');
  if (!(menuRoot instanceof HTMLElement)) return;

  const menu = menuRoot.querySelector('.approval-kebab-menu');
  if (!(menu instanceof HTMLElement)) return;

  const isOpen = menuRoot.classList.contains('is-open') && menu.hidden === false;
  closeApprovalActionMenus();

  if (isOpen) return;

  menuRoot.classList.add('is-open');
  menu.hidden = false;
  buttonElement.setAttribute('aria-expanded', 'true');
}

function applyApprovalViewState(view) {
  const normalizedView = view === 'activity' ? 'activity' : 'queue';
  const queueVisible = normalizedView === 'queue';

  if (adminApprovePanel) {
    adminApprovePanel.setAttribute('data-view', normalizedView);
  }

  if (approvalTitle) {
    approvalTitle.textContent = queueVisible ? 'Admin Approval' : 'Lark Users';
  }
  if (approvalSubtitle) {
    approvalSubtitle.textContent = queueVisible
      ? 'Review and decide role elevation requests.'
      : 'Live and recent login activity with status, timestamps, device, and role records.';
  }

  if (approvalToggleBtn) {
    approvalToggleBtn.textContent = queueVisible ? 'Lark Users' : 'Approval';
    approvalToggleBtn.dataset.nextView = queueVisible ? 'activity' : 'queue';
  }

  if (approvalToolbar) {
    approvalToolbar.hidden = false;
  }
  if (approvalFiltersGroup) {
    approvalFiltersGroup.hidden = !queueVisible;
  }
  if (approvalList) {
    approvalList.hidden = !queueVisible;
  }
  if (approvalActivityList) {
    approvalActivityList.hidden = queueVisible;
  }

  if (approvalSearchInput) {
    approvalSearchInput.placeholder = queueVisible ? 'Search approval requests...' : 'Search Lark users...';
  }
}

function setApprovalView(view, options = {}) {
  const normalizedView = view === 'activity' ? 'activity' : 'queue';
  const shouldLoad = options.shouldLoad !== false;
  const viewChanged = currentApprovalView !== normalizedView;

  currentApprovalView = normalizedView;
  applyApprovalViewState(normalizedView);

  if (viewChanged && adminApprovePanel) {
    adminApprovePanel.classList.remove('is-view-switching');
    void adminApprovePanel.offsetWidth;
    adminApprovePanel.classList.add('is-view-switching');
    window.setTimeout(() => {
      adminApprovePanel.classList.remove('is-view-switching');
    }, 260);
  }

  if (!shouldLoad) return;
  if (normalizedView === 'activity') {
    loadApprovalAccessActivity();
    return;
  }

  loadAdminApprovals();
}

function loadCurrentApprovalView() {
  if (currentApprovalView === 'activity') {
    loadApprovalAccessActivity();
    return;
  }
  loadAdminApprovals();
}

function renderApprovalItems(items) {
  if (!approvalList) return;
  if (!Array.isArray(items) || items.length === 0) {
    approvalList.innerHTML = `<p class="approval-empty">No ${escapeHtml(currentApprovalStatus)} requests found.</p>`;
    if (approvalCount) approvalCount.textContent = '0';
    return;
  }

  const headerHtml = items.length > 0 ? `
    <div class="approval-header">
      <div class="approval-col-user">Requester</div>
      <div class="approval-col-meta">Context</div>
      <div class="approval-col-reason">Reason</div>
      <div class="approval-col-actions">Decide</div>
    </div>
  ` : '';

  approvalList.innerHTML = headerHtml + items.map((item, index) => {
    const requesterName = escapeHtml(item.requestedBy?.name || 'Unknown User');
    const requesterEmail = escapeHtml(item.requestedBy?.email || 'N/A');
    const requesterRole = escapeHtml(item.requestedBy?.role || 'unknown');
    const reason = escapeHtml(item.reason || 'No reason provided');
    const createdAt = escapeHtml(item.createdAt ? new Date(item.createdAt).toLocaleString() : 'N/A');
    const decisionNote = item.decisionNote ? `<div class="approval-note"><span>Note:</span> ${escapeHtml(item.decisionNote)}</div>` : '';

    const actions = item.status === 'pending'
      ? `
        <div class="approval-actions">
          <button class="approval-action" data-action="approve" data-id="${escapeHtml(item.id)}">Approve</button>
          <button class="approval-action" data-action="reject" data-id="${escapeHtml(item.id)}">Reject</button>
          <button class="approval-action" data-status="danger" data-action="delete" data-id="${escapeHtml(item.id)}">Delete</button>
        </div>
      `
      : `
        <div class="approval-actions">
          <button class="approval-action" data-status="danger" data-action="delete" data-id="${escapeHtml(item.id)}">Delete</button>
        </div>
      `;

    return `
      <div class="approval-item" data-id="${escapeHtml(item.id)}" style="--index: ${index};">
        <div class="approval-col-user">
          <div class="approval-user-name">${requesterName}</div>
          <div class="approval-user-email">${requesterEmail}</div>
        </div>
        <div class="approval-col-meta">
          <div class="approval-meta-row"><span>Role:</span> ${requesterRole}</div>
          <div class="approval-meta-row"><span>Date:</span> ${createdAt}</div>
        </div>
        <div class="approval-col-reason">
          <div class="approval-reason-text">${reason}</div>
          ${decisionNote}
        </div>
        <div class="approval-col-actions">
          ${actions}
        </div>
      </div>
    `;
  }).join('');

  if (approvalCount) {
    approvalCount.textContent = String(items.length);
  }
}

function renderApprovalActivityItems(items) {
  if (!approvalActivityList) return;
  if (!Array.isArray(items) || items.length === 0) {
    approvalActivityList.innerHTML = '<p class="approval-empty">No login activity records found.</p>';
    if (approvalCount) approvalCount.textContent = '0';
    return;
  }

  const roleColumnLabel = 'Role';
  const headerHtml = `
    <div class="approval-header approval-activity-header">
      <div class="approval-col-user">Lark User</div>
      <div class="approval-col-meta">Access Status</div>
      <div class="approval-col-meta">Date / Time</div>
      <div class="approval-col-reason">Last Device</div>
      <div class="approval-col-actions">${roleColumnLabel}</div>
    </div>
  `;

  approvalActivityList.innerHTML = headerHtml + items.map((item, index) => {
    const name = escapeHtml(item.name || 'Unknown User');
    const rawLarkId = String(item.larkId || 'N/A');
    const larkId = escapeHtml(rawLarkId);
    const larkIdShort = escapeHtml(rawLarkId.length > 28 ? `${rawLarkId.slice(0, 14)}...${rawLarkId.slice(-8)}` : rawLarkId);
    const avatarUrl = normalizeAvatarUrl(item.avatarUrl);
    const avatarAlt = escapeHtml(`${item.name || 'Lark user'} avatar`);
    const avatarInitial = escapeHtml(String(item.name || 'U').trim().charAt(0).toUpperCase() || 'U');
    const avatarHtml = avatarUrl
      ? `<img class="approval-user-avatar-img" src="${escapeHtml(avatarUrl)}" alt="${avatarAlt}" loading="lazy" />`
      : `<span class="approval-user-avatar-fallback" aria-hidden="true">${avatarInitial}</span>`;
    const status = String(item.status || 'offline').toLowerCase();
    const statusLabel = escapeHtml(getActivityStatusLabel(status));
    const statusClass = status === 'active' || status === 'recent' ? status : 'offline';
    const eventMs = Date.parse(String(item.statusChangedAt || item.lastEventAt || ''));
    const dateText = escapeHtml(eventMs ? new Date(eventMs).toLocaleDateString() : 'N/A');
    const timeText = escapeHtml(eventMs ? new Date(eventMs).toLocaleTimeString() : 'N/A');
    const deviceText = escapeHtml(item.device || 'N/A');
    const normalizedRole = String(item.role || 'fieldman').toLowerCase() === 'admin' ? 'admin' : 'fieldman';
    const role = escapeHtml(normalizedRole.toUpperCase());
    const suggestedRole = normalizedRole === 'admin' ? 'fieldman' : 'admin';
    const userId = escapeHtml(String(item.userId || ''));
    const userName = escapeHtml(String(item.name || 'Unknown User'));
    const disableManage = Boolean(item.isSelf || item.isMainAdminIdentity);
    const actionsHtml = canManageLarkUsers
      ? `
        <div class="approval-kebab" data-user-actions="${userId}">
          <button class="approval-kebab-btn" type="button" data-action="toggle-user-menu" data-user-id="${userId}" aria-haspopup="menu" aria-expanded="false" aria-label="Open actions menu for ${userName}" ${disableManage ? 'disabled' : ''}>...</button>
          <div class="approval-kebab-menu" role="menu" hidden>
            <button class="approval-kebab-item" type="button" role="menuitem" data-action="edit-user-role" data-user-id="${userId}" data-user-name="${userName}" data-current-role="${normalizedRole}" data-role-target="${suggestedRole}" ${disableManage ? 'disabled' : ''}>Edit Role</button>
            <button class="approval-kebab-item" type="button" role="menuitem" data-status="danger" data-action="delete-user" data-user-id="${userId}" data-user-name="${userName}" ${disableManage ? 'disabled' : ''}>Delete</button>
          </div>
        </div>
      `
      : '';

    return `
      <div class="approval-item approval-activity-item" data-id="${larkId}" style="--index: ${index};">
        <div class="approval-col-user">
          <div class="approval-user-cell">
            <div class="approval-user-avatar">${avatarHtml}</div>
            <div class="approval-user-text">
              <div class="approval-user-name">${name}</div>
              <div class="approval-lark-id" data-full-lark-id="${larkId}" title="Click to copy full Lark ID">Lark ID: ${larkIdShort}</div>
            </div>
          </div>
        </div>
        <div class="approval-col-meta">
          <span class="approval-chip is-${statusClass}">${statusLabel}</span>
        </div>
        <div class="approval-col-meta">
          <div class="approval-meta-row"><span>Date:</span> ${dateText}</div>
          <div class="approval-meta-row"><span>Time:</span> ${timeText}</div>
        </div>
        <div class="approval-col-reason">
          <div class="approval-reason-text">${deviceText}</div>
        </div>
        <div class="approval-col-actions">
          <div class="approval-role-actions-line">
            <div class="approval-meta-row">${role}</div>
            ${actionsHtml}
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (approvalCount) {
    approvalCount.textContent = String(items.length);
  }
}

function processAndRenderItems() {
  if (!Array.isArray(loadedApprovalItems)) return;

  // 1. Filter
  let filtered = loadedApprovalItems.filter((item) => {
    if (!currentSearchQuery) return true;
    const q = currentSearchQuery.toLowerCase();
    const name = (item.requestedBy?.name || '').toLowerCase();
    const email = (item.requestedBy?.email || '').toLowerCase();
    const reason = (item.reason || '').toLowerCase();
    return name.includes(q) || email.includes(q) || reason.includes(q);
  });

  // 2. Sort
  filtered.sort((a, b) => {
    if (currentSortMode === 'name-asc') {
      return (a.requestedBy?.name || '').localeCompare(b.requestedBy?.name || '');
    }
    if (currentSortMode === 'name-desc') {
      return (b.requestedBy?.name || '').localeCompare(a.requestedBy?.name || '');
    }
    const dateA = new Date(a.createdAt || 0).getTime();
    const dateB = new Date(b.createdAt || 0).getTime();
    if (currentSortMode === 'oldest') {
      return dateA - dateB;
    }
    // Default: Newest first
    return dateB - dateA;
  });

  // 3. Render
  renderApprovalItems(filtered);
}

function processAndRenderActivityItems() {
  if (!Array.isArray(loadedApprovalActivityItems)) return;

  let filtered = loadedApprovalActivityItems.filter((item) => {
    if (!currentSearchQuery) return true;
    const q = currentSearchQuery.toLowerCase();
    const name = String(item.name || '').toLowerCase();
    const userId = String(item.userId || '').toLowerCase();
    const role = String(item.role || '').toLowerCase();
    const status = String(item.status || '').toLowerCase();
    const device = String(item.device || '').toLowerCase();
    return name.includes(q) || userId.includes(q) || role.includes(q) || status.includes(q) || device.includes(q);
  });

  filtered.sort((a, b) => {
    if (currentSortMode === 'name-asc') {
      return String(a.name || '').localeCompare(String(b.name || ''));
    }
    if (currentSortMode === 'name-desc') {
      return String(b.name || '').localeCompare(String(a.name || ''));
    }

    const timeA = new Date(a.statusChangedAt || a.lastEventAt || 0).getTime();
    const timeB = new Date(b.statusChangedAt || b.lastEventAt || 0).getTime();
    if (currentSortMode === 'oldest') {
      return timeA - timeB;
    }
    return timeB - timeA;
  });

  renderApprovalActivityItems(filtered);
}

async function loadAdminApprovals() {
  if (!adminApprovePanel) return;
  if (currentApprovalView !== 'queue') return;
  const requestView = currentApprovalView;
  setApprovalStatus(`Loading ${currentApprovalStatus} requests...`);
  try {
    const response = await fetch(`/api/admin/approvals?status=${encodeURIComponent(currentApprovalStatus)}`, {
      credentials: 'include',
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Admin authentication is required to view this queue.');
      }
      throw new Error('Failed to load approval queue');
    }
    const data = await response.json();
    if (requestView !== currentApprovalView) return;
    loadedApprovalItems = data.items || [];
    processAndRenderItems();
    setApprovalStatus(`${currentApprovalStatus.toUpperCase()} requests: ${loadedApprovalItems.length}`);
  } catch (error) {
    if (requestView !== currentApprovalView) return;
    setApprovalStatus(error instanceof Error ? error.message : 'Failed to load requests');
    loadedApprovalItems = [];
    processAndRenderItems();
  }
}

async function loadApprovalAccessActivity() {
  if (!adminApprovePanel) return;
  if (currentApprovalView !== 'activity') return;
  const requestView = currentApprovalView;
  setApprovalStatus('Loading access activity records...');

  try {
    const response = await fetch('/api/admin/access-activity', {
      credentials: 'include',
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Admin authentication is required to view access activity.');
      }
      throw new Error('Failed to load access activity records.');
    }

    const data = await response.json();
    if (requestView !== currentApprovalView) return;

    canManageLarkUsers = Boolean(data.canManageUsers);
    loadedApprovalActivityItems = Array.isArray(data.items) ? data.items : [];
    processAndRenderActivityItems();
    const summary = data.summary || {};
    const active = Number(summary.activeCount || 0);
    const recent = Number(summary.recentCount || 0);
    const offline = Number(summary.offlineCount || 0);
    setApprovalStatus(`Access records: ${loadedApprovalActivityItems.length} (active ${active}, recent ${recent}, inactive ${offline})`);
  } catch (error) {
    if (requestView !== currentApprovalView) return;
    canManageLarkUsers = false;
    loadedApprovalActivityItems = [];
    processAndRenderActivityItems();
    setApprovalStatus(error instanceof Error ? error.message : 'Failed to load access activity records.');
  }
}

async function updateLarkUserRole(userId, role, userName) {
  const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });

  if (!response.ok) {
    let message = 'Failed to update user role';
    try {
      const payload = await response.json();
      if (payload?.error) message = String(payload.error);
    } catch (_err) {
      // Ignore payload parse errors.
    }
    throw new Error(message);
  }

  setApprovalStatus(`Updated ${userName} role to ${String(role).toUpperCase()}.`);
}

async function deleteLarkUser(userId, userName) {
  const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!response.ok) {
    let message = 'Failed to delete user';
    try {
      const payload = await response.json();
      if (payload?.error) message = String(payload.error);
    } catch (_err) {
      // Ignore payload parse errors.
    }
    throw new Error(message);
  }

  setApprovalStatus(`Deleted user ${userName}.`);
}

async function decideApproval(requestId, action) {
  if (!requestId || (action !== 'approve' && action !== 'reject' && action !== 'delete')) return;

  if (action === 'delete') {
    const confirmed = window.confirm('Delete this approval request permanently?');
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/admin/approvals/${requestId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        let message = 'Failed to delete request';
        try {
          const payload = await response.json();
          if (payload?.error) message = payload.error;
        } catch (_err) {
          // Ignore payload parse errors.
        }
        throw new Error(message);
      }

      await loadAdminApprovals();
      return;
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to delete request');
      return;
    }
  }

  const decisionNote = action === 'reject'
    ? (window.prompt('Optional rejection note:') || '')
    : (window.prompt('Optional approval note:') || '');

  try {
    const response = await fetch(`/api/admin/approvals/${requestId}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ decisionNote }),
    });

    if (!response.ok) {
      let message = 'Failed to update request';
      try {
        const payload = await response.json();
        if (payload?.error) message = payload.error;
      } catch (_err) {
        // Ignore payload parse errors.
      }
      throw new Error(message);
    }

    await loadAdminApprovals();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : 'Failed to process request');
  }
}

const currentMode = pathToMode[window.location.pathname] || 'learn';
void loadAdminIdentity();
setApprovalView(currentApprovalView, { shouldLoad: false });
applyMode(currentMode);
startAdminSessionHeartbeat();

navLinks.forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    const mode = link.dataset.mode || 'learn';
    const href = link.getAttribute('href');
    if (href && window.location.pathname !== href) {
      window.history.pushState({}, '', href);
    }
    applyMode(mode);
  });
});

const leaveAdminLinks = Array.from(document.querySelectorAll('a[href]'));
leaveAdminLinks.forEach((anchor) => {
  anchor.addEventListener('click', (event) => {
    const href = anchor.getAttribute('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    if (href.startsWith('/admin')) return;

    event.preventDefault();
    runAdminExitTransition(href);
  });
});

window.addEventListener('beforeunload', () => {
  // Best-effort visual reset when page is being replaced or closed.
  stopFieldmanLocationPolling();
  stopAdminSessionHeartbeat();
  stopAdminSessionOnExit();
  collapseDashboardSpokes();
  document.body.classList.add('admin-exit');
});

window.addEventListener('pagehide', () => {
  stopAdminSessionHeartbeat();
  stopAdminSessionOnExit();
});

if (fieldmanRefreshBtn) {
  fieldmanRefreshBtn.addEventListener('click', () => {
    activateFieldmanLocationMode();
  });
}

if (approvalRefreshBtn) {
  approvalRefreshBtn.addEventListener('click', () => {
    loadCurrentApprovalView();
  });
}

if (approvalToggleBtn) {
  approvalToggleBtn.addEventListener('click', () => {
    const nextView = approvalToggleBtn.dataset.nextView || 'queue';
    setApprovalView(nextView);
  });
}

approvalFilters.forEach((filterButton) => {
  filterButton.addEventListener('click', () => {
    const status = filterButton.dataset.status || 'pending';
    currentApprovalStatus = status;
    approvalFilters.forEach((btn) => {
      btn.classList.toggle('is-active', btn === filterButton);
    });
    // Reset search when changing status filter for clarity, or keep it? 
    // Usually keep it, but reset is safer for "finding" things in a different bucket.
    // I'll keep it for better UX.
    if (currentApprovalView !== 'queue') {
      setApprovalView('queue', { shouldLoad: false });
    }
    loadAdminApprovals();
  });
});

if (approvalSearchInput) {
  approvalSearchInput.addEventListener('input', (e) => {
    currentSearchQuery = e.target.value || '';
    if (currentApprovalView === 'activity') {
      processAndRenderActivityItems();
      return;
    }
    processAndRenderItems();
  });
}

if (approvalSortSelect) {
  approvalSortSelect.addEventListener('change', (e) => {
    currentSortMode = e.target.value || 'newest';
    if (currentApprovalView === 'activity') {
      processAndRenderActivityItems();
      return;
    }
    processAndRenderItems();
  });
}

if (approvalList) {
  approvalList.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;
    const requestId = target.dataset.id;
    if (!action || !requestId) return;
    decideApproval(requestId, action);
  });
}

if (approvalActivityList) {
  approvalActivityList.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const clickInsideActionsMenu = target.closest('.approval-kebab');
    if (!(clickInsideActionsMenu instanceof HTMLElement)) {
      closeApprovalActionMenus();
    }

    const actionButton = target.closest('[data-action][data-user-id]');
    if (actionButton instanceof HTMLElement) {
      const action = String(actionButton.dataset.action || '');
      const userId = String(actionButton.dataset.userId || '');
      const userName = String(actionButton.dataset.userName || 'this user');
      if (!userId) return;

      if (action === 'toggle-user-menu') {
        toggleApprovalActionMenu(actionButton);
        return;
      }

      if (action === 'edit-user-role') {
        const currentRole = String(actionButton.dataset.currentRole || '').toLowerCase();
        const suggestedRole = String(actionButton.dataset.roleTarget || (currentRole === 'admin' ? 'fieldman' : 'admin')).toLowerCase();
        const roleInput = window.prompt(`Edit role for ${userName}. Enter admin or fieldman:`, suggestedRole);
        if (roleInput === null) return;

        const roleTarget = roleInput.trim().toLowerCase();
        if (roleTarget !== 'admin' && roleTarget !== 'fieldman') return;
        if (roleTarget === currentRole) {
          closeApprovalActionMenus();
          setApprovalStatus(`No role update was made for ${userName}.`);
          return;
        }

        const confirmed = window.confirm(`Change ${userName} role to ${roleTarget.toUpperCase()}?`);
        if (!confirmed) return;

        try {
          closeApprovalActionMenus();
          await updateLarkUserRole(userId, roleTarget, userName);
          await loadApprovalAccessActivity();
          await loadDashboardSummary();
        } catch (error) {
          window.alert(error instanceof Error ? error.message : 'Failed to update user role');
        }
        return;
      }

      if (action === 'delete-user') {
        const confirmed = window.confirm(`Delete ${userName}? This action cannot be undone.`);
        if (!confirmed) return;

        try {
          closeApprovalActionMenus();
          await deleteLarkUser(userId, userName);
          await loadApprovalAccessActivity();
          await loadDashboardSummary();
        } catch (error) {
          window.alert(error instanceof Error ? error.message : 'Failed to delete user');
        }
        return;
      }
    }

    const larkIdElement = target.closest('.approval-lark-id');
    if (!(larkIdElement instanceof HTMLElement)) return;

    const fullLarkId = larkIdElement.dataset.fullLarkId || '';
    if (!fullLarkId || fullLarkId === 'N/A') return;

    const copied = await copyTextToClipboard(fullLarkId);
    if (copied) {
      larkIdElement.classList.remove('is-copied');
      void larkIdElement.offsetWidth;
      larkIdElement.classList.add('is-copied');
      setApprovalStatus('Copied full Lark ID to clipboard.');
      return;
    }

    setApprovalStatus('Unable to copy full Lark ID.');
  });
}

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.closest('.approval-kebab')) {
    closeApprovalActionMenus();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeApprovalActionMenus();
  }
});

window.addEventListener('resize', () => {
  const activeMode = (navLinks.find((link) => link.classList.contains('is-active'))?.dataset.mode) || 'learn';
  applyMode(activeMode);
});

window.addEventListener('popstate', () => {
  const mode = pathToMode[window.location.pathname] || 'learn';
  applyMode(mode);
});

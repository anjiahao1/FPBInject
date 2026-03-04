/*========================================
  FPBInject Workbench - Tutorial System
  ========================================*/

const TUTORIAL_STORAGE_KEY = 'fpbinject_tutorial_completed';

const TUTORIAL_STEPS = [
  { id: 'welcome', configGroup: null },
  { id: 'ui', configGroup: 'UI' },
  { id: 'connection', configGroup: 'CONNECTION' },
  { id: 'project', configGroup: 'PROJECT' },
  { id: 'inject', configGroup: 'INJECT' },
  { id: 'quickcmd', configGroup: null },
  { id: 'complete', configGroup: null },
];

let tutorialStep = 0;
let tutorialActive = false;
let tutorialStepConfigured = {}; // Track which steps user configured

/* ===========================
   LIFECYCLE
   =========================== */

function shouldShowTutorial(configData) {
  return (
    configData &&
    configData.first_launch === true &&
    !localStorage.getItem(TUTORIAL_STORAGE_KEY)
  );
}

function startTutorial() {
  tutorialStep = 0;
  tutorialActive = true;
  tutorialStepConfigured = {};
  renderTutorialStep();
  const overlay = document.getElementById('tutorialOverlay');
  if (overlay) overlay.classList.add('show');
}

function tutorialNext() {
  markCurrentStepConfigured();
  if (tutorialStep < TUTORIAL_STEPS.length - 1) {
    tutorialStep++;
    renderTutorialStep();
  } else {
    finishTutorial();
  }
}

function tutorialPrev() {
  if (tutorialStep > 0) {
    tutorialStep--;
    renderTutorialStep();
  }
}

function tutorialSkip() {
  if (tutorialStep < TUTORIAL_STEPS.length - 1) {
    tutorialStep++;
    renderTutorialStep();
  } else {
    finishTutorial();
  }
}

function tutorialSkipAll() {
  finishTutorial();
}

function finishTutorial() {
  tutorialActive = false;
  localStorage.setItem(TUTORIAL_STORAGE_KEY, 'true');
  const overlay = document.getElementById('tutorialOverlay');
  if (overlay) overlay.classList.remove('show');

  // Save any config changes made during tutorial
  if (typeof saveConfig === 'function') {
    saveConfig(true);
  }
}

function markCurrentStepConfigured() {
  const step = TUTORIAL_STEPS[tutorialStep];
  if (step) tutorialStepConfigured[step.id] = true;
}

/* ===========================
   RENDERING
   =========================== */

function renderTutorialStep() {
  const step = TUTORIAL_STEPS[tutorialStep];
  const body = document.getElementById('tutorialBody');
  const title = document.getElementById('tutorialTitle');
  const stepCount = document.getElementById('tutorialStepCount');
  const prevBtn = document.getElementById('tutorialPrevBtn');
  const skipBtn = document.getElementById('tutorialSkipBtn');
  const nextBtn = document.getElementById('tutorialNextBtn');
  const skipAllBtn = document.getElementById('tutorialSkipAllBtn');

  if (!body || !step) return;

  // Title
  const titleKey = `tutorial.${step.id}_title`;
  if (title) title.textContent = t(titleKey, step.id);

  // Step count
  if (stepCount) {
    stepCount.textContent = t('tutorial.step_of', '{{current}} / {{total}}', {
      current: tutorialStep + 1,
      total: TUTORIAL_STEPS.length,
    });
  }

  // Render body
  const renderer = stepRenderers[step.id];
  if (renderer) {
    body.innerHTML = renderer();
  }

  // Progress dots
  renderTutorialProgress();

  // Button visibility
  const isFirst = tutorialStep === 0;
  const isLast = tutorialStep === TUTORIAL_STEPS.length - 1;

  if (prevBtn) prevBtn.style.display = isFirst ? 'none' : '';
  if (skipBtn) skipBtn.style.display = isLast ? 'none' : '';
  if (skipAllBtn) skipAllBtn.style.display = isLast ? 'none' : '';

  if (nextBtn) {
    nextBtn.textContent = isLast
      ? t('tutorial.finish', 'Get Started')
      : t('tutorial.next', 'Next');
  }

  // Translate dynamic content
  if (typeof translatePage === 'function') translatePage();
}

function renderTutorialProgress() {
  const container = document.getElementById('tutorialProgress');
  if (!container) return;

  let html = '';
  for (let i = 0; i < TUTORIAL_STEPS.length; i++) {
    let cls = 'tutorial-dot';
    if (i === tutorialStep) cls += ' active';
    else if (i < tutorialStep) cls += ' completed';
    html += `<button class="${cls}" onclick="tutorialGoTo(${i})"></button>`;
  }
  container.innerHTML = html;
}

function tutorialGoTo(index) {
  if (index >= 0 && index < TUTORIAL_STEPS.length) {
    tutorialStep = index;
    renderTutorialStep();
  }
}

/* ===========================
   STEP RENDERERS
   =========================== */

const stepRenderers = {
  welcome() {
    return `
      <div class="tutorial-icon">🔧</div>
      <div class="tutorial-welcome-title">${t('tutorial.welcome_title', 'Welcome to FPBInject Workbench')}</div>
      <p class="tutorial-welcome-subtitle">${t('tutorial.welcome_desc', 'An ARM Cortex-M runtime code injection tool based on FPB hardware.')}</p>
    `;
  },

  ui() {
    return `
      <p>${t('tutorial.ui_desc', 'Choose your preferred language and theme.')}</p>
      <div class="tutorial-config-group" id="tutorialUiConfig"></div>
    `;
  },

  connection() {
    return `
      <p>${t('tutorial.connection_desc', 'Select the serial port and baud rate.')}</p>
      <div class="tutorial-port-row">
        <select id="tutorialPortSelect" class="vscode-select"></select>
        <button class="vscode-btn secondary" onclick="tutorialRefreshPorts()">
          ${t('tutorial.connection_refresh', 'Refresh')}
        </button>
      </div>
      <div class="tutorial-config-item">
        <label>${t('config.labels.baudrate', 'Baud Rate')}</label>
        <input type="number" id="tutorialBaudrate" class="vscode-input" value="115200" />
      </div>
      <div style="margin-top: 10px">
        <button class="vscode-btn" onclick="tutorialTestConnect()">
          ${t('tutorial.connection_test', 'Test Connection')}
        </button>
      </div>
      <div id="tutorialConnectStatus" class="tutorial-connect-status"></div>
      <p class="tutorial-hint" style="margin-top: 10px; opacity: 0.6; font-size: 11px;">
        ${t('tutorial.connection_skip_hint', 'No device? Skip this step.')}
      </p>
    `;
  },

  project() {
    return `
      <p>${t('tutorial.project_desc', 'Set the ELF firmware file and compile database paths.')}</p>
      <div class="tutorial-config-group" id="tutorialProjectConfig"></div>
    `;
  },

  inject() {
    return `
      <p>${t('tutorial.inject_desc', 'Configure the patch injection mode and file watch directories.')}</p>
      <div class="tutorial-config-group" id="tutorialInjectConfig"></div>
    `;
  },

  quickcmd() {
    return `
      <p>${t('tutorial.quickcmd_desc', 'Quick commands let you send serial commands or execute macros.')}</p>
      <div class="tutorial-feature-list">
        <div class="tutorial-feature-item">
          <i class="codicon codicon-terminal"></i>
          <div>
            <strong>${t('tutorial.quickcmd_feature_single', 'Single Command')}</strong>
            ${t('tutorial.quickcmd_feature_single_desc', 'Send a serial command instantly.')}
          </div>
        </div>
        <div class="tutorial-feature-item">
          <i class="codicon codicon-list-ordered"></i>
          <div>
            <strong>${t('tutorial.quickcmd_feature_macro', 'Macro')}</strong>
            ${t('tutorial.quickcmd_feature_macro_desc', 'Execute a sequence of commands with delays.')}
          </div>
        </div>
      </div>
    `;
  },

  complete() {
    let summaryHtml = '';
    const summarySteps = TUTORIAL_STEPS.filter(
      (s) => s.id !== 'welcome' && s.id !== 'complete',
    );
    for (const s of summarySteps) {
      const configured = tutorialStepConfigured[s.id];
      const icon = configured ? 'codicon-check' : 'codicon-circle-outline';
      const cls = configured ? 'configured' : 'skipped';
      const label = configured
        ? t('tutorial.complete_configured', 'Configured')
        : t('tutorial.complete_skipped', 'Skipped');
      const stepTitle = t(`tutorial.${s.id}_title`, s.id);
      summaryHtml += `
        <div class="tutorial-summary-item ${cls}">
          <i class="codicon ${icon}"></i>
          <span>${stepTitle}</span>
          <span style="margin-left: auto; opacity: 0.6; font-size: 11px;">${label}</span>
        </div>
      `;
    }

    return `
      <div class="tutorial-icon">🎉</div>
      <div class="tutorial-welcome-title">${t('tutorial.complete_title', 'Setup Complete!')}</div>
      <p class="tutorial-welcome-subtitle">${t('tutorial.complete_desc', 'You can modify these settings anytime.')}</p>
      <div class="tutorial-summary">${summaryHtml}</div>
      <p class="tutorial-hint" style="margin-top: 16px; text-align: center; opacity: 0.6; font-size: 11px;">
        ${t('tutorial.complete_hint', 'Click the 🎓 button to restart this tutorial.')}
      </p>
    `;
  },
};

/* ===========================
   CONFIG GROUP RENDERING
   =========================== */

async function renderTutorialConfigGroup(containerId, groupId) {
  const schema = await loadConfigSchema();
  if (!schema) return;

  const container = document.getElementById(containerId);
  if (!container) return;

  const items = schema.schema
    .filter((item) => item.group === groupId && item.show_in_sidebar !== false)
    .sort((a, b) => a.order - b.order);

  let html = '';
  for (const item of items) {
    html += renderConfigItem(item);
  }
  container.innerHTML = html;

  // Load current values
  if (typeof loadConfigValuesFromData === 'function') {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      loadConfigValuesFromData(data);
    } catch (e) {
      // Silent
    }
  }

  setupDependencies(schema);
}

/* ===========================
   CONNECTION HELPERS
   =========================== */

async function tutorialRefreshPorts() {
  const select = document.getElementById('tutorialPortSelect');
  if (!select) return;

  try {
    const res = await fetch('/api/ports');
    const data = await res.json();
    select.innerHTML = '';
    if (data.ports && data.ports.length > 0) {
      for (const p of data.ports) {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        select.appendChild(opt);
      }
    } else {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '—';
      select.appendChild(opt);
    }
  } catch (e) {
    // Silent
  }
}

async function tutorialTestConnect() {
  const statusEl = document.getElementById('tutorialConnectStatus');
  const portSelect = document.getElementById('tutorialPortSelect');
  const baudrateInput = document.getElementById('tutorialBaudrate');
  if (!statusEl) return;

  const port = portSelect ? portSelect.value : '';
  const baudrate = baudrateInput ? parseInt(baudrateInput.value, 10) : 115200;

  if (!port) {
    statusEl.className = 'tutorial-connect-status error';
    statusEl.textContent = t('tutorial.connection_fail', 'Connection failed.');
    return;
  }

  statusEl.className = 'tutorial-connect-status';
  statusEl.style.display = 'block';
  statusEl.textContent = '...';

  try {
    const res = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port, baudrate }),
    });
    const data = await res.json();

    if (data.success) {
      statusEl.className = 'tutorial-connect-status success';
      statusEl.textContent = t(
        'tutorial.connection_success',
        'Connected successfully!',
      );

      // Sync to main UI
      const mainPort = document.getElementById('portSelect');
      const mainBaud = document.getElementById('baudrate');
      if (mainPort) mainPort.value = port;
      if (mainBaud) mainBaud.value = baudrate;

      if (typeof handleConnected === 'function') handleConnected(port);
    } else {
      statusEl.className = 'tutorial-connect-status error';
      statusEl.textContent = t(
        'tutorial.connection_fail',
        'Connection failed.',
      );
    }
  } catch (e) {
    statusEl.className = 'tutorial-connect-status error';
    statusEl.textContent = t('tutorial.connection_fail', 'Connection failed.');
  }
}

/* ===========================
   POST-RENDER HOOKS
   =========================== */

// Override renderTutorialStep to add post-render logic
const _origRenderStep = renderTutorialStep;

// We use MutationObserver-free approach: call post-render after innerHTML
const origRender = renderTutorialStep;
function renderTutorialStepWithHooks() {
  origRender();
  const step = TUTORIAL_STEPS[tutorialStep];
  if (!step) return;

  // Post-render async setup
  if (step.id === 'ui') {
    renderTutorialConfigGroup('tutorialUiConfig', 'UI');
  } else if (step.id === 'project') {
    renderTutorialConfigGroup('tutorialProjectConfig', 'PROJECT');
  } else if (step.id === 'inject') {
    renderTutorialConfigGroup('tutorialInjectConfig', 'INJECT');
  } else if (step.id === 'connection') {
    tutorialRefreshPorts();
  }
}

// Replace the function
renderTutorialStep = renderTutorialStepWithHooks;

/* ===========================
   EXPORTS
   =========================== */

window.shouldShowTutorial = shouldShowTutorial;
window.startTutorial = startTutorial;
window.tutorialNext = tutorialNext;
window.tutorialPrev = tutorialPrev;
window.tutorialSkip = tutorialSkip;
window.tutorialSkipAll = tutorialSkipAll;
window.tutorialGoTo = tutorialGoTo;
window.finishTutorial = finishTutorial;
window.renderTutorialStep = renderTutorialStep;

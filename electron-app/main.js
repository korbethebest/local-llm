const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

// ── Config ──
const CONFIG_PATH = path.join(__dirname, 'config.json');
let config = { serverUrl: 'http://localhost:3001' };
try { config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; } catch {}

// ── Window state ──
const STATE_PATH = path.join(app.getPath('userData'), 'window-state.json');
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch {}
  return { width: 1280, height: 820 };
}
function saveState(win) {
  if (win.isMaximized()) { fs.writeFileSync(STATE_PATH, JSON.stringify({ maximized: true })); return; }
  const b = win.getBounds();
  fs.writeFileSync(STATE_PATH, JSON.stringify(b));
}

let mainWindow = null;

// ── Create window ──
function createWindow() {
  const state = loadState();

  mainWindow = new BrowserWindow({
    width:  state.width  || 1280,
    height: state.height || 820,
    x: state.x,
    y: state.y,
    minWidth:  800,
    minHeight: 600,
    title: 'LocalQWEN',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#09090b',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
    show: false,
  });

  if (state.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', () => saveState(mainWindow));
  mainWindow.on('closed', () => { mainWindow = null; });

  // Open external links in browser, not in the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  tryLoad();
  buildMenu();
}

// ── Load with retry ──
function tryLoad(attempt = 1) {
  checkServer(config.serverUrl, ok => {
    if (ok) {
      mainWindow.loadURL(config.serverUrl);
    } else if (attempt <= 12) {
      // Retry up to ~60s
      showLoading(attempt);
      setTimeout(() => tryLoad(attempt + 1), 5000);
    } else {
      showError();
    }
  });
}

function checkServer(url, cb) {
  const mod = url.startsWith('https') ? https : http;
  try {
    const req = mod.get(url, { timeout: 4000 }, res => cb(res.statusCode < 500));
    req.on('error', () => cb(false));
    req.on('timeout', () => { req.destroy(); cb(false); });
  } catch { cb(false); }
}

function showLoading(attempt) {
  if (!mainWindow) return;
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHTML(config.serverUrl, attempt))}`);
}

function showError() {
  if (!mainWindow) return;
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHTML(config.serverUrl))}`);
}

function loadingHTML(url, attempt) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;
         background:#09090b;color:#a1a1aa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
         -webkit-app-region:drag}
    .mark{width:52px;height:52px;background:linear-gradient(135deg,#6366f1,#818cf8);border-radius:16px;
          display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:#fff;
          box-shadow:0 0 40px rgba(99,102,241,.3)}
    h2{color:#f4f4f5;font-size:18px;font-weight:600;margin:0}
    p{font-size:12.5px;color:#71717a;max-width:300px;text-align:center;line-height:1.5}
    code{background:#27272a;padding:2px 7px;border-radius:4px;font-size:11.5px;color:#818cf8}
    .dots{display:flex;gap:6px;margin-top:4px}
    .dots span{width:6px;height:6px;background:#3f3f46;border-radius:50%;animation:b 1.4s infinite}
    .dots span:nth-child(2){animation-delay:.2s}.dots span:nth-child(3){animation-delay:.4s}
    @keyframes b{0%,80%,100%{transform:scale(.6);opacity:.3}40%{transform:scale(1);opacity:1}}
  </style></head><body>
    <div class="mark">Q</div>
    <h2>서버에 연결 중...</h2>
    <p>서버 주소 <code>${url}</code><br>에 연결을 시도하고 있습니다. (${attempt}/12)</p>
    <div class="dots"><span></span><span></span><span></span></div>
  </body></html>`;
}

function errorHTML(url) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;
         background:#09090b;color:#a1a1aa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
         -webkit-app-region:drag}
    .mark{width:52px;height:52px;background:linear-gradient(135deg,#6366f1,#818cf8);border-radius:16px;
          display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:#fff}
    h2{color:#f4f4f5;font-size:18px;font-weight:600}
    p{font-size:12.5px;color:#71717a;text-align:center;line-height:1.5;max-width:320px}
    code{background:#27272a;padding:2px 7px;border-radius:4px;font-size:11.5px;color:#818cf8}
    button{background:#6366f1;border:none;color:#fff;padding:10px 24px;border-radius:9px;
           font-size:13px;cursor:pointer;-webkit-app-region:no-drag;margin-top:4px}
    button:hover{background:#4f52d8}
  </style></head><body>
    <div class="mark">Q</div>
    <h2>연결 실패</h2>
    <p>서버 주소 <code>${url}</code><br>에 연결할 수 없습니다.<br>Docker 컨테이너가 실행 중인지 확인하세요.</p>
    <button onclick="window.location.reload()">다시 시도</button>
  </body></html>`;
}

// ── Menu ──
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ label: app.name, submenu: [
      { role: 'about' }, { type: 'separator' }, { role: 'quit' }
    ]}] : []),
    {
      label: '보기',
      submenu: [
        { label: '새로고침', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.reload() },
        { type: 'separator' },
        { role: 'resetZoom', label: '기본 크기' },
        { role: 'zoomIn',    label: '확대' },
        { role: 'zoomOut',   label: '축소' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '전체 화면' },
        { label: '개발자 도구', accelerator: 'F12',
          click: () => mainWindow?.webContents.toggleDevTools() },
      ],
    },
    {
      label: '설정',
      submenu: [
        {
          label: '서버 주소 변경...',
          click: () => changeServerUrl(),
        },
        {
          label: '현재 서버 주소 확인',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '서버 주소',
            message: config.serverUrl,
            buttons: ['확인'],
          }),
        },
      ],
    },
    ...(!isMac ? [{ label: '앱', submenu: [{ role: 'quit', label: '종료' }] }] : []),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function changeServerUrl() {
  // Show current URL and ask to open config file
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '서버 주소 변경',
    message: `현재 주소: ${config.serverUrl}`,
    detail: `config.json 파일을 열어 serverUrl을 수정한 뒤 앱을 재시작하세요.\n\n경로: ${CONFIG_PATH}`,
    buttons: ['파일 열기', '취소'],
  });
  if (response === 0) shell.openPath(CONFIG_PATH);
}

// ── App lifecycle ──
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});

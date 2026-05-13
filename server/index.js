const http = require('http');
const path = require('path');
const {
  readStateFromWorkbook,
  writeStateToWorkbook,
  resetWorkbook,
} = require('./excel-store');
const { analyzeProfile } = require('./analyzer');

const PORT = Number(process.env.TT_SCREENER_PORT) || 17321;
const PROJECT_ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = process.env.TT_SCREENER_OUTPUT_DIR
  ? path.resolve(process.env.TT_SCREENER_OUTPUT_DIR)
  : path.join(PROJECT_ROOT, 'output');
const WORKBOOK_PATH = process.env.TT_SCREENER_XLSX
  ? path.resolve(process.env.TT_SCREENER_XLSX)
  : path.join(OUTPUT_DIR, 'tiktok_qualified_live.xlsx');

function log(message) {
  console.log(`${new Date().toLocaleTimeString()} ${message}`);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) {
        reject(new Error('请求体过大'));
        request.destroy();
      }
    });
    request.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('请求 JSON 格式无效'));
      }
    });
    request.on('error', reject);
  });
}

function handleOptions(response) {
  response.writeHead(204, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  response.end();
}

async function route(request, response) {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  request.routePath = url.pathname;

  if (request.method === 'OPTIONS') {
    handleOptions(response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, {
      ok: true,
      workbookPath: WORKBOOK_PATH,
      outputDir: OUTPUT_DIR,
      version: 3,
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/state') {
    const state = readStateFromWorkbook(WORKBOOK_PATH, url.searchParams.get('searchUrl') || '');
    log(`读取断点 | 发现 ${state.discovered.length} | 队列 ${state.queue.length} | 已处理 ${state.processed.length} | 合格 ${state.rows.length}`);
    sendJson(response, 200, {
      ok: true,
      workbookPath: WORKBOOK_PATH,
      state,
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/state') {
    const body = await readBody(request);
    const state = writeStateToWorkbook(WORKBOOK_PATH, body.state || {});
    log(`写入 Excel | 发现 ${state.discovered.length} | 队列 ${state.queue.length} | 已处理 ${state.processed.length} | 合格 ${state.rows.length}`);
    sendJson(response, 200, {
      ok: true,
      workbookPath: WORKBOOK_PATH,
      state,
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/reset') {
    const body = await readBody(request);
    const state = resetWorkbook(WORKBOOK_PATH, body.searchUrl || '');
    log(`重置 Excel | 搜索页 ${state.searchUrl || '-'}`);
    sendJson(response, 200, {
      ok: true,
      workbookPath: WORKBOOK_PATH,
      state,
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/analyze-profile') {
    const body = await readBody(request);
    if (!body.profile) throw new Error('缺少 profile');
    const analysis = await analyzeProfile(body.profile, body.rules || body.config?.rules || {}, { log });
    sendJson(response, 200, {
      ok: true,
      analysis,
    });
    return;
  }

  sendJson(response, 404, {
    ok: false,
    error: `未知接口: ${request.method} ${url.pathname}`,
  });
}

const server = http.createServer((request, response) => {
  const startedAt = Date.now();
  route(request, response).catch((error) => {
    log(`请求失败 | ${request.method} ${request.url} | ${error?.message || String(error)}`);
    sendJson(response, 500, {
      ok: false,
      error: error?.message || String(error),
      workbookPath: WORKBOOK_PATH,
    });
  }).finally(() => {
    if (request.method !== 'OPTIONS' && request.routePath !== '/health') {
      log(`请求完成 | ${request.method} ${request.url} | ${Date.now() - startedAt}ms`);
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  log(`TikTok Auto Screener 本地服务已启动: http://127.0.0.1:${PORT}`);
  log(`Excel 表格路径: ${WORKBOOK_PATH}`);
  log(`TikWM 配置 | free ${process.env.TT_TIKWM_BASE_URL || 'https://www.tikwm.com/api'} | paid ${process.env.TT_TIKWM_PAID_BASE_URL || 'https://api.tikwmapi.com'} | key ${process.env.TT_TIKWM_API_KEY ? '环境变量' : '复用插件默认值'}`);
});

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const LEGACY_RESULT_SHEET = '达人结果';
const META_SHEET = '断点统计';
const DISCOVERED_SHEET = '断点_已发现';
const QUEUE_SHEET = '断点_待处理';
const PROCESSED_SHEET = '断点_已处理';
const LOG_SHEET = '断点_日志';
const CHECKPOINT_SHEETS = new Set([
  META_SHEET,
  DISCOVERED_SHEET,
  QUEUE_SHEET,
  PROCESSED_SHEET,
  LOG_SHEET,
]);

const RESULT_COLUMNS = [
  '用户名',
  '邮箱',
  '昵称',
  '主页链接',
  '是否合格',
  '最高满足等级',
  '粉丝量展示',
  '最低播放量展示',
  '稳定播放量展示',
  '选取视频数',
  '总抓取视频数',
  '当前分析等级',
  '粉丝归属等级',
  '命中等级列表',
  '主受众国家',
  '主受众国家占比',
  '受众样本数',
  '受众筛选达标',
  '受众失败原因',
  '来源搜索页',
  '来源视频链接',
  '搜索页摘录',
  '错误信息',
];

function createInitialState(defaultSearchUrl = '') {
  return {
    running: false,
    searchTabId: null,
    searchUrl: defaultSearchUrl,
    config: null,
    lastSavedAt: '',
    discovered: [],
    queue: [],
    processed: [],
    rows: [],
    logs: [],
    stats: {
      discovered: 0,
      queued: 0,
      processed: 0,
      qualified: 0,
      failed: 0,
    },
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(String(value));
  } catch (error) {
    return fallback;
  }
}

function stringifyJson(value) {
  return JSON.stringify(value ?? null);
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeSheetName(value, fallback = '其他合格') {
  const name = String(value || fallback)
    .replace(/[\\/?*\[\]:]/g, '_')
    .trim()
    .slice(0, 31);
  return name || fallback;
}

function orderRow(row, columns = RESULT_COLUMNS) {
  const output = {};
  for (const key of columns) {
    if (Object.prototype.hasOwnProperty.call(row, key)) output[key] = row[key];
  }
  for (const [key, value] of Object.entries(row || {})) {
    if (!Object.prototype.hasOwnProperty.call(output, key)) output[key] = value;
  }
  return output;
}

function buildJsonRows(items, keyName = 'json') {
  return normalizeArray(items).map((item, index) => ({
    序号: index + 1,
    [keyName]: stringifyJson(item),
  }));
}

function parseJsonRows(workbook, sheetName, keyName = 'json') {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' })
    .map((row) => safeJsonParse(row[keyName], null))
    .filter(Boolean);
}

function parseProcessedRows(workbook) {
  const sheet = workbook.Sheets[PROCESSED_SHEET];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' })
    .map((row) => String(row.用户名 || '').trim())
    .filter(Boolean);
}

function parseResultRows(workbook, config) {
  const rows = [];
  const configuredSheetNames = new Set(
    normalizeArray(config?.rules?.levels)
      .map((level) => safeSheetName(level?.label || level?.key))
      .filter(Boolean),
  );

  if (workbook.Sheets[LEGACY_RESULT_SHEET]) {
    rows.push(...XLSX.utils.sheet_to_json(workbook.Sheets[LEGACY_RESULT_SHEET], { defval: '' })
      .filter((row) => row && !row.提示));
  }

  for (const sheetName of workbook.SheetNames || []) {
    if (CHECKPOINT_SHEETS.has(sheetName) || sheetName === LEGACY_RESULT_SHEET) continue;
    if (configuredSheetNames.size > 0 && !configuredSheetNames.has(sheetName)) continue;
    rows.push(...XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' })
      .filter((row) => row && !row.提示));
  }

  const seen = new Set();
  return rows.filter((row) => {
    const key = String(row.用户名 || row.主页链接 || '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function calculateStats(state) {
  const processedCount = normalizeArray(state.processed).length;
  const qualifiedCount = normalizeArray(state.rows).filter((row) => row.是否合格 === '合格').length;
  return {
    discovered: normalizeArray(state.discovered).length,
    queued: normalizeArray(state.queue).length,
    processed: processedCount,
    qualified: qualifiedCount,
    failed: Math.max(0, processedCount - qualifiedCount),
  };
}

function readStateFromWorkbook(filePath, defaultSearchUrl = '') {
  if (!fs.existsSync(filePath)) {
    return createInitialState(defaultSearchUrl);
  }

  const workbook = XLSX.readFile(filePath);
  const meta = XLSX.utils.sheet_to_json(workbook.Sheets[META_SHEET] || {}, { defval: '' })[0] || {};
  const state = createInitialState(meta.搜索页链接 || defaultSearchUrl);

  state.searchUrl = meta.搜索页链接 || defaultSearchUrl;
  state.lastSavedAt = meta.上次保存时间 || '';
  state.config = safeJsonParse(meta.配置JSON, null);
  state.rows = parseResultRows(workbook, state.config);
  state.discovered = parseJsonRows(workbook, DISCOVERED_SHEET);
  state.queue = parseJsonRows(workbook, QUEUE_SHEET);
  state.processed = parseProcessedRows(workbook);
  state.logs = parseJsonRows(workbook, LOG_SHEET, '日志');
  state.stats = calculateStats(state);

  return state;
}

function appendSheet(workbook, rows, sheetName) {
  const sheetRows = rows.length > 0 ? rows : [{ 提示: '暂无数据' }];
  const sheet = XLSX.utils.json_to_sheet(sheetRows);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
}

function buildLevelSheetMap(config) {
  const levels = normalizeArray(config?.rules?.levels);
  const sheetMap = new Map();
  for (const level of levels) {
    const label = level?.label || level?.key;
    if (!label) continue;
    sheetMap.set(String(label), safeSheetName(label));
  }
  return sheetMap;
}

function appendGroupedResultSheets(workbook, rows, config) {
  const qualifiedRows = normalizeArray(rows).filter((row) => row.是否合格 === '合格');
  const sheetMap = buildLevelSheetMap(config);
  const groups = new Map();

  for (const sheetName of sheetMap.values()) {
    groups.set(sheetName, []);
  }

  for (const row of qualifiedRows) {
    const levelLabel = String(row.最高满足等级 || '').trim();
    const sheetName = sheetMap.get(levelLabel) || safeSheetName(levelLabel || '其他合格');
    if (!groups.has(sheetName)) groups.set(sheetName, []);
    groups.get(sheetName).push(orderRow(row));
  }

  if (groups.size === 0) {
    appendSheet(workbook, [], '其他合格');
    return;
  }

  for (const [sheetName, groupRows] of groups.entries()) {
    appendSheet(workbook, groupRows, sheetName);
  }
}

function writeStateToWorkbook(filePath, inputState) {
  ensureDir(path.dirname(filePath));

  const state = {
    ...createInitialState(inputState?.searchUrl || ''),
    ...(inputState || {}),
  };
  state.running = false;
  state.lastSavedAt = new Date().toISOString();
  state.discovered = normalizeArray(state.discovered);
  state.queue = normalizeArray(state.queue);
  state.processed = normalizeArray(state.processed);
  state.rows = normalizeArray(state.rows).filter((row) => row.是否合格 === '合格');
  state.logs = normalizeArray(state.logs);
  state.stats = calculateStats(state);

  const workbook = XLSX.utils.book_new();
  appendGroupedResultSheets(workbook, state.rows, state.config);
  appendSheet(workbook, [{
    版本: 3,
    搜索页链接: state.searchUrl || '',
    上次保存时间: state.lastSavedAt,
    累计发现: state.stats.discovered,
    待处理: state.stats.queued,
    已处理: state.stats.processed,
    合格账号: state.stats.qualified,
    失败或不合格: state.stats.failed,
    配置JSON: stringifyJson(state.config || null),
  }], META_SHEET);
  appendSheet(workbook, buildJsonRows(state.discovered), DISCOVERED_SHEET);
  appendSheet(workbook, buildJsonRows(state.queue), QUEUE_SHEET);
  appendSheet(workbook, state.processed.map((username, index) => ({ 序号: index + 1, 用户名: username })), PROCESSED_SHEET);
  appendSheet(workbook, buildJsonRows(state.logs, '日志'), LOG_SHEET);
  XLSX.writeFile(workbook, filePath);

  return state;
}

function resetWorkbook(filePath, defaultSearchUrl = '') {
  return writeStateToWorkbook(filePath, createInitialState(defaultSearchUrl));
}

module.exports = {
  createInitialState,
  readStateFromWorkbook,
  writeStateToWorkbook,
  resetWorkbook,
};

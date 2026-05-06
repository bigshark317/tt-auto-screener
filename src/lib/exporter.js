const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { ensureDir } = require('./helpers');
const { createEmptyState, hydrateState, snapshotState } = require('./state-store');

const CHECKPOINT_META_SHEET = '断点统计';
const CHECKPOINT_DISCOVERED_SHEET = '断点_已发现';
const CHECKPOINT_PROCESSED_SHEET = '断点_已处理';
const CHECKPOINT_SHEET_NAMES = new Set([
  CHECKPOINT_META_SHEET,
  CHECKPOINT_DISCOVERED_SHEET,
  CHECKPOINT_PROCESSED_SHEET,
]);

const PREFERRED_COLUMN_ORDER = [
  '用户名',
  '邮箱',
  '昵称',
  '主页链接',
  '主受众国家',
  '主受众国家占比',
  '受众样本数',
  '受众筛选达标',
  '受众失败原因',
  '最高满足等级',
  '是否合格',
  '粉丝量展示',
  '稳定播放比例',
  '稳定播放量展示',
  '最低播放量展示',
  '当前分析等级',
  '粉丝归属等级',
  '命中等级列表',
  '选取视频数',
  '总抓取视频数',
  '粉丝量',
  '稳定播放量',
  '最低播放量',
  '第二低播放量',
  '第三低播放量',
  '满足等级数',
  '粉丝门槛',
  '稳定播放门槛',
  '最低播放门槛',
  '粉丝达标',
  '稳定播放达标',
  '最低播放达标',
  '接口命中_userDetail',
  '接口命中_itemList',
  '来源搜索页',
  '来源视频链接',
  '搜索页摘录',
  '错误信息',
];

function sanitizeSheetName(name) {
  return String(name || '未命名分组').replace(/[\\/?*\[\]:]/g, '_').slice(0, 31);
}

function isCheckpointSheet(name) {
  return CHECKPOINT_SHEET_NAMES.has(name);
}

function groupRowsByLevel(rows, levelOrder = [], levelLabelMap = {}) {
  const groups = new Map();

  for (const levelKey of levelOrder) {
    const label = levelLabelMap[levelKey] || levelKey;
    groups.set(label, []);
  }

  for (const row of rows) {
    const label = row.最高满足等级 || '未达标';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(row);
  }

  return groups;
}

function appendGroupedSheets(workbook, groups) {
  for (const [label, groupRows] of groups.entries()) {
    const sheet = buildSheet(groupRows.length > 0 ? groupRows : [{ 提示: `无${label}账号` }]);
    XLSX.utils.book_append_sheet(workbook, sheet, sanitizeSheetName(label));
  }
}

function orderRow(row) {
  const ordered = {};
  for (const key of PREFERRED_COLUMN_ORDER) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      ordered[key] = row[key];
    }
  }
  for (const [key, value] of Object.entries(row)) {
    if (!Object.prototype.hasOwnProperty.call(ordered, key)) {
      ordered[key] = value;
    }
  }
  return ordered;
}

function buildSheet(rows) {
  const normalizedRows = rows.map((row) => orderRow(row));
  return XLSX.utils.json_to_sheet(normalizedRows);
}

function parseWorkbookRows(workbook) {
  const rows = [];
  for (const sheetName of workbook.SheetNames) {
    if (isCheckpointSheet(sheetName)) continue;
    const sheet = workbook.Sheets[sheetName];
    const sheetRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    for (const row of sheetRows) {
      if (row && !row.提示) rows.push(row);
    }
  }
  return rows;
}

function loadWorkbookData(filePath, searchUrl) {
  if (!fs.existsSync(filePath)) {
    return {
      rows: [],
      state: createEmptyState(searchUrl),
    };
  }

  try {
    const workbook = XLSX.readFile(filePath);
    const rows = parseWorkbookRows(workbook);
    const metaRow = XLSX.utils.sheet_to_json(workbook.Sheets[CHECKPOINT_META_SHEET], { defval: '' })[0] || {};
    const discoveredRows = XLSX.utils.sheet_to_json(workbook.Sheets[CHECKPOINT_DISCOVERED_SHEET], { defval: '' });
    const processedRows = XLSX.utils.sheet_to_json(workbook.Sheets[CHECKPOINT_PROCESSED_SHEET], { defval: '' });

    const state = hydrateState({
      version: Number(metaRow.版本 || 2),
      searchUrl: metaRow.搜索页链接 || searchUrl,
      startedAt: metaRow.开始时间 || undefined,
      updatedAt: metaRow.更新时间 || undefined,
      stats: {
        discovered: Number(metaRow.已发现作者数 || discoveredRows.length),
        processed: Number(metaRow.已处理作者数 || processedRows.length),
        qualified: Number(metaRow.合格账号数 || 0),
        failed: Number(metaRow.失败或未达标数 || 0),
      },
      discoveredAuthors: discoveredRows.map((item) => ({ username: item.用户名 || item.username || '' })),
      processedUsernames: processedRows.map((item) => item.用户名 || item.username || ''),
    }, searchUrl);

    return { rows, state };
  } catch (error) {
    return {
      rows: [],
      state: createEmptyState(searchUrl),
    };
  }
}

function appendCheckpointSheets(workbook, state) {
  const checkpoint = snapshotState(state);
  const metaSheet = XLSX.utils.json_to_sheet([{
    版本: checkpoint.version,
    搜索页链接: checkpoint.searchUrl,
    开始时间: checkpoint.startedAt,
    更新时间: checkpoint.updatedAt,
    已发现作者数: checkpoint.stats.discovered,
    已处理作者数: checkpoint.stats.processed,
    合格账号数: checkpoint.stats.qualified,
    失败或未达标数: checkpoint.stats.failed,
  }]);
  const discoveredSheet = buildSheet(
    checkpoint.discoveredAuthors.length > 0
      ? checkpoint.discoveredAuthors.map((item) => ({ 用户名: item.username }))
      : [{ 提示: '暂无已发现作者' }],
  );
  const processedSheet = buildSheet(
    checkpoint.processedUsernames.length > 0
      ? checkpoint.processedUsernames.map((username) => ({ 用户名: username }))
      : [{ 提示: '暂无已处理作者' }],
  );
  XLSX.utils.book_append_sheet(workbook, metaSheet, CHECKPOINT_META_SHEET);
  XLSX.utils.book_append_sheet(workbook, discoveredSheet, CHECKPOINT_DISCOVERED_SHEET);
  XLSX.utils.book_append_sheet(workbook, processedSheet, CHECKPOINT_PROCESSED_SHEET);
}

function writeQualifiedWorkbookSnapshot(filePath, rows, tierOrder = [], tierLabelMap = {}, state = null) {
  const workbook = XLSX.utils.book_new();
  appendGroupedSheets(workbook, groupRowsByLevel(rows, tierOrder, tierLabelMap));
  if (state) appendCheckpointSheets(workbook, state);
  XLSX.writeFile(workbook, filePath);
}

function createQualifiedLiveWriter(outputDir, options = {}) {
  ensureDir(outputDir);
  const tierOrder = Array.isArray(options.tierOrder) ? options.tierOrder : [];
  const tierLabelMap = options.tierLabelMap || {};
  const searchUrl = options.searchUrl || '';

  const xlsxPath = path.join(outputDir, 'tiktok_qualified_live.xlsx');
  const loaded = loadWorkbookData(xlsxPath, searchUrl);
  const existingRows = loaded.rows.filter((row) => row.是否合格 === '合格');
  const initialRows = Array.isArray(options.initialRows) ? options.initialRows.filter((row) => row.是否合格 === '合格') : [];
  const rows = [];
  let checkpointState = loaded.state;
  const writtenKeys = new Set(
    [...existingRows, ...initialRows].map((row) => `${row.用户名 || ''}::${row.主页链接 || ''}::${row.最高满足等级 || ''}`),
  );

  for (const row of [...existingRows, ...initialRows]) {
    const dedupeKey = `${row.用户名 || ''}::${row.主页链接 || ''}::${row.最高满足等级 || ''}`;
    if (rows.some((item) => `${item.用户名 || ''}::${item.主页链接 || ''}::${item.最高满足等级 || ''}` === dedupeKey)) continue;
    rows.push(row);
  }

  writeQualifiedWorkbookSnapshot(xlsxPath, rows, tierOrder, tierLabelMap, checkpointState);

  return {
    xlsxPath,
    rows,
    state: checkpointState,
    saveCheckpoint(state) {
      checkpointState = snapshotState(state);
      writeQualifiedWorkbookSnapshot(xlsxPath, rows, tierOrder, tierLabelMap, checkpointState);
    },
    append(row) {
      if (!row || row.是否合格 !== '合格') return false;
      const dedupeKey = `${row.用户名 || ''}::${row.主页链接 || ''}::${row.最高满足等级 || ''}`;
      if (writtenKeys.has(dedupeKey)) return false;

      rows.push(row);
      writtenKeys.add(dedupeKey);
      writeQualifiedWorkbookSnapshot(xlsxPath, rows, tierOrder, tierLabelMap, checkpointState);
      return true;
    },
  };
}

module.exports = {
  createQualifiedLiveWriter,
};

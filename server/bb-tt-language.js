const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SHARED_CONFIG = {
  countryToLanguages: {
    US: ['英语'], CA: ['英语'], GB: ['英语'], IE: ['英语'], DE: ['德语'], CH: ['德语'],
    FR: ['法语'], LU: ['法语'], IT: ['意大利语'], AT: ['德语'], MC: ['法语'],
    BE: ['法语'], AU: ['英语'], NZ: ['英语'],
    BR: ['葡萄牙语'], PT: ['葡萄牙语'],
    MX: ['西班牙语'], GT: ['西班牙语'], BZ: ['英语'], SV: ['西班牙语'],
    HN: ['西班牙语'], NI: ['西班牙语'], CR: ['西班牙语'], PA: ['西班牙语'],
    CU: ['西班牙语'], DO: ['西班牙语'], CO: ['西班牙语'], VE: ['西班牙语'],
    EC: ['西班牙语'], PE: ['西班牙语'], BO: ['西班牙语'], CL: ['西班牙语'],
    AR: ['西班牙语'], UY: ['西班牙语'], PY: ['西班牙语'],
    ES: ['西班牙语'],
    SA: ['阿拉伯语'], AE: ['阿拉伯语'], KW: ['阿拉伯语'], QA: ['阿拉伯语'],
    OM: ['阿拉伯语'], BH: ['阿拉伯语'],
    EG: ['阿拉伯语'], DZ: ['阿拉伯语'], MA: ['阿拉伯语'], TN: ['阿拉伯语'],
    LY: ['阿拉伯语'], SD: ['阿拉伯语'], MR: ['阿拉伯语'], IQ: ['阿拉伯语'],
    SY: ['阿拉伯语'], JO: ['阿拉伯语'], LB: ['阿拉伯语'], PS: ['阿拉伯语'],
    YE: ['阿拉伯语'], DJ: ['阿拉伯语'], SO: ['阿拉伯语'], KM: ['阿拉伯语'],
    IN: ['印地语'], PK: ['乌尔都语'], BD: ['孟加拉语'], NP: ['印地语'],
    BT: ['英语'], LK: ['英语'], MV: ['英语'], AF: ['波斯语'],
    MM: ['缅甸语'], KH: ['高棉语'], LA: ['老挝语'], TL: ['葡萄牙语'],
    NG: ['英语'], KE: ['英语'], ET: ['阿姆哈拉语'], TZ: ['英语'],
    UG: ['英语'], GH: ['英语'], CI: ['法语'], CM: ['法语'],
    SN: ['法语'], ML: ['法语'], BF: ['法语'], NE: ['法语'],
    TD: ['法语'], CF: ['法语'], CG: ['法语'], CD: ['法语'],
    SS: ['英语'], MG: ['法语'], MZ: ['葡萄牙语'], ZM: ['英语'],
    ZW: ['英语'], MW: ['英语'], BI: ['法语'], RW: ['法语'],
    LR: ['英语'], GN: ['法语'], GW: ['葡萄牙语'], TG: ['法语'],
    BJ: ['法语'], HT: ['法语'], PG: ['英语'], SB: ['英语'], VU: ['英语'],
    JP: ['日语'],
    ID: ['印尼语'], MY: ['马来语'], TH: ['泰语'], SG: ['英语'],
    PH: ['菲律宾语'],
    VN: ['越南语'],
    RU: ['俄语'], BY: ['俄语'], KZ: ['俄语'], KG: ['俄语'],
    UA: ['乌克兰语'], MD: ['俄语'], TJ: ['俄语'], UZ: ['俄语'],
    TM: ['俄语'], AZ: ['俄语'], GE: ['格鲁吉亚语'], AM: ['亚美尼亚语'],
    LV: ['俄语'], EE: ['俄语'], LT: ['俄语'], TR: ['土耳其语'],
    KR: ['韩语'],
  },
  countryNames: {
    US: '美国', GB: '英国', CA: '加拿大', AU: '澳大利亚', PH: '菲律宾',
    NG: '尼日利亚', IN: '印度', ZA: '南非', MX: '墨西哥', ES: '西班牙',
    CO: '哥伦比亚', AR: '阿根廷', BR: '巴西', PT: '葡萄牙', JP: '日本',
    KR: '韩国', SA: '沙特', AE: '阿联酋', EG: '埃及', IQ: '伊拉克',
    MA: '摩洛哥', FR: '法国', BE: '比利时', DE: '德国', AT: '奥地利',
    CH: '瑞士', ID: '印尼', TH: '泰国', VN: '越南', MY: '马来西亚',
    SG: '新加坡', TR: '土耳其', RU: '俄罗斯', UA: '乌克兰', KZ: '哈萨克斯坦',
    BY: '白俄罗斯', IT: '意大利', NL: '荷兰', PL: '波兰', KE: '肯尼亚',
    GH: '加纳', CM: '喀麦隆', UG: '乌干达', ZM: '赞比亚', SO: '索马里',
    DZ: '阿尔及利亚', JM: '牙买加', GY: '圭亚那', DO: '多米尼加', VE: '委内瑞拉',
    IE: '爱尔兰', SE: '瑞典', DK: '丹麦', NO: '挪威', FI: '芬兰',
    NZ: '新西兰', CZ: '捷克', HU: '匈牙利', RO: '罗马尼亚', BD: '孟加拉',
    PK: '巴基斯坦', LK: '斯里兰卡', NP: '尼泊尔', MM: '缅甸', KH: '柬埔寨',
    TW: '台湾', HK: '香港', CL: '智利', PE: '秘鲁', EC: '厄瓜多尔',
    TT: '特立尼达', PR: '波多黎各', CR: '哥斯达黎加', PA: '巴拿马',
  },
  langCodeMap: {
    en: '英语', es: '西班牙语', pt: '葡萄牙语', fr: '法语', de: '德语',
    ar: '阿拉伯语', ja: '日语', ko: '韩语', ru: '俄语', th: '泰语',
    vi: '越南语', tl: '菲律宾语', tr: '土耳其语', hi: '印地语',
    ms: '马来语', zh: '中文', bn: '孟加拉语', id: '印尼语',
    it: '意大利语', nl: '荷兰语', pl: '波兰语', sv: '瑞典语',
    da: '丹麦语', fi: '芬兰语', no: '挪威语', ro: '罗马尼亚语',
    uk: '乌克兰语', he: '希伯来语', fa: '波斯语', ur: '乌尔都语',
    am: '阿姆哈拉语', ta: '泰米尔语', te: '泰卢固语', hu: '匈牙利语',
    cs: '捷克语', sk: '斯洛伐克语', bg: '保加利亚语', hr: '克罗地亚语',
    sr: '塞尔维亚语', sq: '阿尔巴尼亚语', ka: '格鲁吉亚语', hy: '亚美尼亚语',
    el: '希腊语', et: '爱沙尼亚语', lv: '拉脱维亚语', lt: '立陶宛语',
  },
  indonesianKeywords: /\b(saya|aku|kamu|anda|ini|itu|dan|yang|untuk|dengan|tidak|ada|akan|sudah|bisa|juga|terima\s*kasih|selamat|bagus|sangat|apa|bukan|harus|mau|dari|ke|di)\b/i,
};

let cachedELD = undefined;

function loadELD() {
  if (cachedELD !== undefined) return cachedELD;
  try {
    const code = fs.readFileSync(path.join(__dirname, 'vendor', 'eld.min.js'), 'utf8');
    const sandbox = { console };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'eld.min.js' });
    cachedELD = sandbox.ELD || null;
  } catch (error) {
    cachedELD = null;
  }
  return cachedELD;
}

function isValidComment(text, existingTexts) {
  const trimmed = String(text || '').trim();
  if (trimmed.length < 2) return false;
  const withoutEmoji = trimmed.replace(
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{2700}-\u{27BF}\u{2B50}\u{2B55}\u{231A}-\u{23F3}\u{2934}-\u{2935}\u{25AA}-\u{25FE}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2460}-\u{24FF}\u{25A0}-\u{25FF}\s]/gu,
    '',
  );
  if (withoutEmoji.length === 0) return false;
  if (existingTexts.has(trimmed.toLowerCase())) return false;
  return true;
}

function sumRegion(regionCounts, codes) {
  return codes.reduce((sum, code) => sum + (regionCounts[code] || 0), 0);
}

function detectCommentLanguages(commentTexts, regionCounts, totalUsers) {
  const ELD = loadELD();
  if (!commentTexts?.length || !ELD?.eld) {
    return { topLang: '', distribution: {}, sampleCount: 0 };
  }

  const rc = regionCounts || {};
  const idCount = rc.ID || 0;
  const myCount = rc.MY || 0;
  const brPt = sumRegion(rc, ['BR', 'PT']);
  const latamEs = sumRegion(rc, ['MX', 'GT', 'SV', 'HN', 'NI', 'CR', 'PA', 'CU', 'DO', 'CO', 'VE', 'EC', 'PE', 'BO', 'CL', 'AR', 'UY', 'PY', 'ES']);
  const jpCount = rc.JP || 0;
  const uaCount = rc.UA || 0;
  const ruAllied = sumRegion(rc, ['RU', 'BY', 'KZ', 'KG', 'MD', 'TJ', 'UZ', 'TM']);
  const inCount = rc.IN || 0;
  const pkCount = rc.PK || 0;
  const phCount = rc.PH || 0;

  const langCounts = {};
  let validCount = 0;
  for (const text of commentTexts) {
    const cleaned = String(text || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\s]/gu, '').trim();
    if (cleaned.length < 3) continue;
    const result = ELD.eld.detect(text);
    if (!result.language) continue;
    let lang = result.language;

    if (lang === 'ms') {
      if (idCount > myCount) lang = 'id';
      else if (SHARED_CONFIG.indonesianKeywords.test(String(text).toLowerCase())) lang = 'id';
    }
    if (lang === 'es' && brPt > latamEs) lang = 'pt';
    else if (lang === 'pt' && latamEs > brPt * 2) lang = 'es';
    if (lang === 'zh' && totalUsers > 0 && jpCount / totalUsers > 0.15) {
      const hasKana = /[\u3040-\u30FF\u31F0-\u31FF]/.test(text);
      if (hasKana) lang = 'ja';
    }
    if (lang === 'ru' && uaCount > ruAllied && uaCount > 0) lang = 'uk';
    if (lang === 'hi' && pkCount > inCount) lang = 'ur';
    if (lang === 'en' && totalUsers > 0 && phCount / totalUsers > 0.3) {
      if (/\b(ang|mga|sa|ng|na|po|ko|mo|naman|salamat|talaga|grabe|sana|ganda)\b/i.test(String(text).toLowerCase())) {
        lang = 'tl';
      }
    }

    const langName = SHARED_CONFIG.langCodeMap[lang] || lang;
    langCounts[langName] = (langCounts[langName] || 0) + 1;
    validCount += 1;
  }

  if (validCount === 0) return { topLang: '', distribution: {}, sampleCount: 0 };
  const distribution = {};
  for (const [lang, count] of Object.entries(langCounts)) {
    distribution[lang] = Math.round((count / validCount) * 100);
  }
  const sorted = Object.entries(distribution).sort((a, b) => b[1] - a[1]);
  return {
    topLang: sorted[0][0],
    distribution: Object.fromEntries(sorted),
    sampleCount: validCount,
  };
}

function detectLanguageByText(texts) {
  const combined = (Array.isArray(texts) ? texts.join(' ') : texts || '').trim();
  if (!combined) return '-';
  const scores = {};
  const arabicCount = (combined.match(/[\u0600-\u06FF]/g) || []).length;
  if (arabicCount > 0) scores['阿拉伯语'] = (scores['阿拉伯语'] || 0) + arabicCount * 2;
  const jpCount = (combined.match(/[\u3040-\u30FF\u31F0-\u31FF]/g) || []).length;
  if (jpCount > 0) scores['日语'] = (scores['日语'] || 0) + jpCount * 3;
  const krCount = (combined.match(/[\uAC00-\uD7AF\u1100-\u11FF]/g) || []).length;
  if (krCount > 0) scores['韩语'] = (scores['韩语'] || 0) + krCount * 2;
  const cyrCount = (combined.match(/[\u0400-\u04FF]/g) || []).length;
  if (cyrCount > 0) scores['俄语'] = (scores['俄语'] || 0) + cyrCount * 2;
  const thaiCount = (combined.match(/[\u0E00-\u0E7F]/g) || []).length;
  if (thaiCount > 0) scores['泰语'] = (scores['泰语'] || 0) + thaiCount * 2;
  const hindiCount = (combined.match(/[\u0900-\u097F]/g) || []).length;
  if (hindiCount > 0) scores['印地语'] = (scores['印地语'] || 0) + hindiCount * 2;
  const bnCount = (combined.match(/[\u0980-\u09FF]/g) || []).length;
  if (bnCount > 0) scores['孟加拉语'] = (scores['孟加拉语'] || 0) + bnCount * 2;
  const vnCount = (combined.match(/[ăâđêôơưàằầèềìòồờùừỳáắấéếíóốớúứýảẳẩẻểỉỏổởủửỷãẵẫẽễĩõỗỡũữỹạặậẹệịọộợụựỵ]/gi) || []).length;
  if (vnCount > 0) scores['越南语'] = (scores['越南语'] || 0) + vnCount * 3;
  const cnCount = (combined.match(/[\u4E00-\u9FFF]/g) || []).length;
  if (cnCount > 0 && !scores['日语']) scores['中文'] = (scores['中文'] || 0) + cnCount * 2;
  const lower = combined.toLowerCase();
  if (/[¿¡ñ]/i.test(combined) || /\b(hola|gracias|amor|como|para|que|muy|pero|todo|esta|tiene|puede|también|más|esta)\b/i.test(lower)) scores['西班牙语'] = (scores['西班牙语'] || 0) + 10;
  if (/[ãõç]/i.test(combined) && !/[ñ¿¡]/.test(combined) && /\b(obrigad[oa]|você|não|muito|também|então|porque|ainda|fazer|pode|tudo)\b/i.test(lower)) scores['葡萄牙语'] = (scores['葡萄牙语'] || 0) + 10;
  if (/\b(je|tu|nous|vous|les|des|est|une|pas|avec|pour|dans|sur|mais|très|aussi|ça|c'est|merci|bonjour)\b/i.test(lower)) scores['法语'] = (scores['法语'] || 0) + 8;
  if (/[üöäß]/.test(combined) || /\b(ich|und|die|der|das|ist|ein|nicht|auf|mit|auch|noch|wie|aber|hab[en]?|mein|dein|sehr)\b/i.test(lower)) scores['德语'] = (scores['德语'] || 0) + 8;
  if (SHARED_CONFIG.indonesianKeywords.test(lower)) scores['印尼语'] = (scores['印尼语'] || 0) + 10;
  if (/\b(ako|ikaw|siya|kami|tayo|ang|mga|sa|ng|na|po|ko|mo|naman|salamat|maganda|ganda|grabe|sana|talaga|naman)\b/i.test(lower)) scores['菲律宾语'] = (scores['菲律宾语'] || 0) + 10;
  if (/[ıİşŞçÇğĞöÖüÜ]/.test(combined) || /\b(ben|sen|bir|bu|ve|ile|için|var|olan|çok|ama|daha|güzel|teşekkür)\b/i.test(lower)) scores['土耳其语'] = (scores['土耳其语'] || 0) + 8;
  if (/\b(the|and|for|you|this|that|with|from|have|are|was|not|but|what|all|can|will|just|like|love|follow|link|bio|dm)\b/i.test(lower)) scores['英语'] = (scores['英语'] || 0) + 3;
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return sorted.length === 0 ? '-' : sorted[0][0];
}

function inferLanguageFromRegions(regionCounts, totalUsers) {
  if (!regionCounts || totalUsers === 0) return [];
  const langScores = {};
  for (const [countryCode, count] of Object.entries(regionCounts)) {
    const langs = SHARED_CONFIG.countryToLanguages[countryCode];
    if (!langs?.length) continue;
    const perLang = count / langs.length;
    for (const lang of langs) {
      langScores[lang] = (langScores[lang] || 0) + perLang;
    }
  }
  return Object.entries(langScores)
    .map(([lang, score]) => ({ lang, percentage: Math.round((score / totalUsers) * 100) }))
    .filter((item) => item.percentage > 0)
    .sort((a, b) => b.percentage - a.percentage);
}

function mergeDistributions(eldDist, regionInferred, eldWeight) {
  const regionWeight = 1 - eldWeight;
  const regionMap = {};
  for (const item of regionInferred) regionMap[item.lang] = item.percentage;
  const merged = {};
  for (const lang of new Set([...Object.keys(eldDist), ...Object.keys(regionMap)])) {
    merged[lang] = Math.round((eldDist[lang] || 0) * eldWeight + (regionMap[lang] || 0) * regionWeight);
  }
  return Object.fromEntries(
    Object.entries(merged)
      .filter(([, percentage]) => percentage > 0)
      .sort((a, b) => b[1] - a[1]),
  );
}

function detectLanguage(profileTexts, commentTexts, regionCounts, totalUsers) {
  const eldResult = detectCommentLanguages(commentTexts || [], regionCounts, totalUsers);
  const regionInferred = inferLanguageFromRegions(regionCounts || {}, totalUsers || 0);
  const textLang = detectLanguageByText(profileTexts);
  const regionTopLang = regionInferred.length > 0 ? regionInferred[0].lang : '';

  let agreement = '低';
  if (eldResult.topLang && regionTopLang) {
    if (eldResult.topLang === regionTopLang) {
      agreement = '高';
    } else {
      const regionTop3 = regionInferred.slice(0, 3).map((item) => item.lang);
      const eldTop3 = Object.keys(eldResult.distribution).slice(0, 3);
      agreement = regionTop3.filter((lang) => eldTop3.includes(lang)).length >= 2 ? '中' : '低';
    }
  } else if (!eldResult.topLang && !regionTopLang) {
    agreement = '不足';
  }

  let finalLang = '';
  let finalDistribution = {};
  let method = '';

  if (eldResult.sampleCount >= 30 && eldResult.topLang) {
    if (agreement === '高') {
      finalLang = eldResult.topLang;
      finalDistribution = eldResult.distribution;
      method = 'ELD+地区一致';
    } else {
      finalDistribution = mergeDistributions(eldResult.distribution, regionInferred, 0.6);
      finalLang = Object.keys(finalDistribution)[0] || eldResult.topLang;
      method = 'ELD+地区加权';
    }
  } else if (eldResult.sampleCount >= 10 && eldResult.topLang) {
    if (regionInferred.length > 0) {
      finalDistribution = mergeDistributions(eldResult.distribution, regionInferred, 0.4);
      finalLang = Object.keys(finalDistribution)[0] || regionTopLang;
      method = '地区为主+ELD辅助';
    } else {
      finalLang = eldResult.topLang;
      finalDistribution = eldResult.distribution;
      method = 'ELD检测(少量)';
    }
  } else if (regionInferred.length > 0) {
    finalLang = regionTopLang;
    for (const item of regionInferred) finalDistribution[item.lang] = item.percentage;
    method = textLang && textLang !== '-' && textLang !== finalLang
      ? `地区推断(文本检测: ${textLang})`
      : '地区推断';
  } else {
    finalLang = textLang;
    finalDistribution = {};
    method = '文本特征检测';
  }

  return {
    language: finalLang,
    distribution: finalDistribution,
    regionInferred,
    eldDetected: eldResult.distribution,
    agreement,
    sampleCount: eldResult.sampleCount,
    method,
  };
}

module.exports = {
  SHARED_CONFIG,
  isValidComment,
  detectLanguage,
};

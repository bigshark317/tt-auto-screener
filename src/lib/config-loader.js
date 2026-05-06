const path = require('path');
const { resolveProjectPath } = require('./helpers');

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(base[key])) {
      result[key] = deepMerge(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function resolveMaybeRelative(baseDir, value) {
  if (!value) return value;
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

function loadConfig(configPathArg) {
  const defaultConfigPath = resolveProjectPath('config', 'default.config.js');
  const configPath = configPathArg
    ? path.resolve(configPathArg)
    : defaultConfigPath;

  delete require.cache[configPath];
  delete require.cache[defaultConfigPath];

  const defaultConfig = require(defaultConfigPath);
  const userConfig = configPath === defaultConfigPath ? {} : require(configPath);
  const merged = deepMerge(defaultConfig, userConfig);
  const configDir = path.dirname(configPath);

  merged.__meta = {
    configPath,
    configDir,
  };

  merged.export.outputDir = resolveMaybeRelative(configDir, merged.export.outputDir);

  return merged;
}

module.exports = {
  loadConfig,
  deepMerge,
};

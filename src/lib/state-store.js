function createEmptyState(searchUrl) {
  return {
    version: 2,
    searchUrl,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stats: {
      discovered: 0,
      processed: 0,
      qualified: 0,
      failed: 0,
    },
    discoveredAuthors: [],
    processedUsernames: [],
  };
}

function normalizeDiscoveredAuthors(discoveredAuthors) {
  if (!Array.isArray(discoveredAuthors)) return [];

  const usernames = new Set();
  for (const item of discoveredAuthors) {
    const username = typeof item === 'string' ? item : item?.username;
    if (!username) continue;
    usernames.add(username);
  }

  return [...usernames].map((username) => ({ username }));
}

function normalizeProcessedUsernames(processedUsernames) {
  if (!Array.isArray(processedUsernames)) return [];
  return [...new Set(processedUsernames.filter((item) => typeof item === 'string' && item))];
}

function hydrateState(state, searchUrl) {
  if (!state || typeof state !== 'object') return createEmptyState(searchUrl);

  return {
    ...createEmptyState(searchUrl),
    ...state,
    searchUrl: state.searchUrl || searchUrl,
    stats: {
      ...createEmptyState(searchUrl).stats,
      ...(state.stats || {}),
    },
    discoveredAuthors: normalizeDiscoveredAuthors(state.discoveredAuthors),
    processedUsernames: normalizeProcessedUsernames(state.processedUsernames),
  };
}

function snapshotState(state) {
  return {
    version: 2,
    searchUrl: state.searchUrl,
    startedAt: state.startedAt,
    updatedAt: new Date().toISOString(),
    stats: {
      discovered: Number(state.stats?.discovered || 0),
      processed: Number(state.stats?.processed || 0),
      qualified: Number(state.stats?.qualified || 0),
      failed: Number(state.stats?.failed || 0),
    },
    discoveredAuthors: normalizeDiscoveredAuthors(state.discoveredAuthors),
    processedUsernames: normalizeProcessedUsernames(state.processedUsernames),
  };
}

module.exports = {
  createEmptyState,
  hydrateState,
  snapshotState,
};

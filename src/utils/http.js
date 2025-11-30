const getHeaderValue = (headers, variants) => {
  if (!headers || !variants) return undefined;
  for (const candidate of variants) {
    const key = candidate.toLowerCase();
    if (headers[key] !== undefined) return headers[key];
    if (headers[candidate] !== undefined) return headers[candidate];
  }
  return undefined;
};

module.exports = {
  getHeaderValue,
};

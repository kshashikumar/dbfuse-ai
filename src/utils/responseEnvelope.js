const RESPONSE_VERSION = "2026-02-01";

const RESPONSE_CONTRACTS = Object.freeze({
  METADATA: "dbfuse.metadata.v1",
  QUERY: "dbfuse.query.v1",
});

const buildEnvelope = ({ kind, payload, request, meta }) => {
  const normalizedKind = kind === "query" ? "query" : "metadata";
  const contract =
    normalizedKind === "query" ? RESPONSE_CONTRACTS.QUERY : RESPONSE_CONTRACTS.METADATA;

  return {
    contract,
    version: RESPONSE_VERSION,
    kind: normalizedKind,
    request: {
      dbType: request?.dbType || null,
      connectionId: request?.connectionId || null,
    },
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
    data: payload,
  };
};

module.exports = {
  RESPONSE_VERSION,
  RESPONSE_CONTRACTS,
  buildEnvelope,
};

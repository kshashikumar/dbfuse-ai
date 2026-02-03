const RESPONSE_VERSION = "2026-02-01";

const RESPONSE_CONTRACTS = Object.freeze({
  METADATA: "dbfuse.metadata.v1",
  QUERY: "dbfuse.query.v1",
});

const VERSION_NOTES = Object.freeze({
  metadata:
    "Legacy fields are preserved at the top level; envelope.data mirrors the legacy payload during migration.",
  query:
    "Legacy fields are preserved at the top level; envelope.data mirrors the legacy payload during migration.",
});

const isUnifiedEnvelopeEnabled = () => true;

const buildEnvelope = ({ kind, payload, request, meta }) => {
  const normalizedKind = kind === "query" ? "query" : "metadata";
  const contract =
    normalizedKind === "query" ? RESPONSE_CONTRACTS.QUERY : RESPONSE_CONTRACTS.METADATA;

  return {
    contract,
    version: RESPONSE_VERSION,
    kind: normalizedKind,
    legacyCompat: true,
    versionNotes: VERSION_NOTES[normalizedKind],
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

const wrapLegacyEnvelope = (payload, envelope) => ({ ...payload, envelope });

module.exports = {
  RESPONSE_VERSION,
  RESPONSE_CONTRACTS,
  isUnifiedEnvelopeEnabled,
  buildEnvelope,
  wrapLegacyEnvelope,
};

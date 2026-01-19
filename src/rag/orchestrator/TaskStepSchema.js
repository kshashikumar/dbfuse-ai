const TASK_STEP_TYPES = Object.freeze(["plan", "execute", "result", "followup"]);
const TASK_STEP_STATUSES = Object.freeze(["pending", "running", "done", "failed"]);

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

const isNullableString = (value) => value === null || isNonEmptyString(value);

const isNullableObject = (value) =>
  value === null || (typeof value === "object" && !Array.isArray(value));

const isNullableTimestamp = (value) => value === null || isNonEmptyString(value);

const createTaskStep = ({
  taskId,
  stepId,
  type,
  description,
  dbType,
  operation,
  capabilityRequired = null,
  payload = null,
  requiresConfirmation = false,
  dependsOn = [],
  status = "pending",
  result = null,
  error = null,
  startedAt = null,
  finishedAt = null,
} = {}) => ({
  taskId,
  stepId,
  type,
  description,
  dbType,
  operation,
  capabilityRequired,
  payload,
  requiresConfirmation: Boolean(requiresConfirmation),
  dependsOn: Array.isArray(dependsOn) ? dependsOn : [],
  status,
  result,
  error,
  startedAt,
  finishedAt,
});

const validateTaskStep = (step) => {
  const errors = [];

  if (!step || typeof step !== "object") {
    return { valid: false, errors: ["step must be an object"] };
  }

  if (!isNonEmptyString(step.taskId)) errors.push("taskId is required");
  if (!isNonEmptyString(step.stepId)) errors.push("stepId is required");
  if (!isNonEmptyString(step.description)) errors.push("description is required");
  if (!isNonEmptyString(step.dbType)) errors.push("dbType is required");
  if (!isNonEmptyString(step.operation)) errors.push("operation is required");

  if (!TASK_STEP_TYPES.includes(step.type)) {
    errors.push(`type must be one of: ${TASK_STEP_TYPES.join(", ")}`);
  }

  if (!TASK_STEP_STATUSES.includes(step.status)) {
    errors.push(`status must be one of: ${TASK_STEP_STATUSES.join(", ")}`);
  }

  if (!isNullableString(step.capabilityRequired)) {
    errors.push("capabilityRequired must be a string or null");
  }

  if (!("payload" in step)) {
    errors.push("payload is required");
  }

  if (typeof step.requiresConfirmation !== "boolean") {
    errors.push("requiresConfirmation must be boolean");
  }

  if (!Array.isArray(step.dependsOn)) {
    errors.push("dependsOn must be an array");
  } else if (step.dependsOn.some((entry) => !isNonEmptyString(entry))) {
    errors.push("dependsOn entries must be non-empty strings");
  }

  if (!isNullableObject(step.result) && step.result !== null) {
    errors.push("result must be an object or null");
  }

  if (!(step.error === null || isNonEmptyString(step.error))) {
    errors.push("error must be a string or null");
  }

  if (!isNullableTimestamp(step.startedAt)) {
    errors.push("startedAt must be a timestamp string or null");
  }

  if (!isNullableTimestamp(step.finishedAt)) {
    errors.push("finishedAt must be a timestamp string or null");
  }

  return { valid: errors.length === 0, errors };
};

const validateTaskSteps = (steps) => {
  if (!Array.isArray(steps)) {
    return { valid: false, errors: ["taskSteps must be an array"] };
  }

  const errors = [];
  steps.forEach((step, index) => {
    const result = validateTaskStep(step);
    if (!result.valid) {
      result.errors.forEach((error) => {
        errors.push(`taskSteps[${index}]: ${error}`);
      });
    }
  });

  return { valid: errors.length === 0, errors };
};

module.exports = {
  TASK_STEP_TYPES,
  TASK_STEP_STATUSES,
  createTaskStep,
  validateTaskStep,
  validateTaskSteps,
};

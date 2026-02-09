const compactTaskSteps = (steps) => {
  if (!Array.isArray(steps)) {
    return [];
  }

  return steps.map((step) => {
    const errorValue = step?.error;
    let error = errorValue;
    if (errorValue != null && typeof errorValue !== "string") {
      try {
        error = JSON.stringify(errorValue);
      } catch {
        error = String(errorValue);
      }
    }
    if (typeof error === "string" && error.length > 200) {
      error = error.slice(0, 200);
    }

    return {
      ...step,
      payload: null,
      result: null,
      error: error ?? null,
    };
  });
};

module.exports = {
  compactTaskSteps,
};

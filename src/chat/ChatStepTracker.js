class ChatStepTracker {
  constructor(onUpdate) {
    this.onUpdate = typeof onUpdate === "function" ? onUpdate : null;
    this.steps = [];
  }

  addStep({ id, label, status = "pending", note = null }) {
    const existing = this.steps.find((step) => step.id === id);
    if (existing) {
      return existing;
    }
    const step = {
      id,
      label: label || id,
      status,
      note,
    };
    this.steps.push(step);
    this._emit();
    return step;
  }

  updateStep(id, updates = {}) {
    const step = this.steps.find((entry) => entry.id === id);
    if (!step) {
      return null;
    }
    Object.assign(step, updates);
    this._emit();
    return step;
  }

  setStatus(id, status, note = null) {
    return this.updateStep(id, { status, note });
  }

  setLabel(id, label) {
    return this.updateStep(id, { label });
  }

  list() {
    return this.steps.map((step) => ({ ...step }));
  }

  _emit() {
    if (!this.onUpdate) return;
    this.onUpdate(this.list());
  }
}

module.exports = ChatStepTracker;

class AdapterRegistry {
  constructor() {
    this.adapters = [];
  }

  register(adapter) {
    if (adapter) {
      this.adapters.push(adapter);
    }
  }

  getAdapter(dbType) {
    return this.adapters.find((adapter) => adapter.supports(dbType));
  }

  hasAdapters() {
    return this.adapters.length > 0;
  }
}

module.exports = AdapterRegistry;

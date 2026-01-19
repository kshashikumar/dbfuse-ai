class BaseQueryStrategy {
  constructor(name) {
    this.name = name || "BaseQueryStrategy";
  }

  async execute() {
    throw new Error("execute() must be implemented by strategy");
  }
}

module.exports = BaseQueryStrategy;

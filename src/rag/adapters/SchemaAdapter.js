class SchemaAdapter {
  supports() {
    return false;
  }

  async extract() {
    throw new Error("SchemaAdapter.extract() must be implemented");
  }
}

module.exports = SchemaAdapter;

class Log {
  constructor(data) {
    if (!data) return
    this.code = data.code || null
    this.column = data.column || 0
    this.level = data.level || 0
    this.line = data.line || 0
    this.message = data.message || null
    this.method = data.method || null
  }
}

module.exports = Log

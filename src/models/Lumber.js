const traceArray = require('trace-array')
const { level } = require('../configs')
const { post } = require('../helpers')
const Log = require('./Log')

class Lumber {
  constructor(token) { this.token = token }
  post(message, code, level) {
    const trace = traceArray(2)
    const log = new Log({ code, column: trace.column, level, line: trace.line, message, method: trace.method })
    post(this.token, log)
  }
  info(s, code) { this.post(s, code, level.info) }
  debug(s, code) { this.post(s, code, level.debug) }
  verbose(s, code) { this.post(s, code, level.verbose) }
  warning(s, code) { this.post(s, code, level.warning) }
  error(s, code) { this.post(s, code, level.error) }
  critical(s, code) { this.post(s, code, level.critical) }
};

module.exports = Lumber

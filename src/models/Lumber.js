const traceArray = require('trace-array')
const { level } = require('../configs')
const { post } = require('../helpers')
const Log = require('./Log')

class Lumber {
  constructor(token) { this.token = token }
  post(message, level) {
    const trace = traceArray(2)
    const log = new Log({ column: trace.column, level,  line: trace.line, message, method: trace.method })
    post(this.token, log)
  }
  info(s) { this.post(s, level.info) }
  debug(s) { this.post(s, level.debug) }
  verbose(s) { this.post(s, level.verbose) }
  warning(s) { this.post(s, level.warning) }
  error(s) { this.post(s, level.error) }
  critical (s) { this.post(s, level.critical) }
};

module.exports = Lumber

const traceArray = require('trace-array'),
  cosmetic = require('cosmetic'),
  { level } = require('../configs'),
  { postLog } = require('../helpers'),
  Log = require('./Log')

class Lumber {
  constructor(token, options) {
    this.token = token
    if (!options) options = {}
    const { cloud, local } = options
    this.cloud = cloud === false ? false : true
    this.local = local === false ? false : true
  }
  log(message, code) {
    if (!this.local) return
    console.log(message)
    if (code) console.log(code)
  }
  logCloud(message, code, level) {
    if (!this.cloud || !this.token) return
    const trace = traceArray(2)
    const log = new Log({ code, column: trace.column, level, line: trace.line, message, method: trace.method })
    return postLog(this.token, log)
  }
  info(s, code) {
    this.log(`${cosmetic.bright.white('Info')}: ${s}`, code)
    return this.logCloud(s, code, level.info)
  }
  debug(s, code) {
    this.log(`${cosmetic.xterm(33)('Debug')}: ${s}`, code)
    return this.logCloud(s, code, level.debug)
  }
  verbose(s, code) {
    this.log(`${cosmetic.dark.white('Verbose')}: ${s}`, code)
    return this.logCloud(s, code, level.verbose)
  }
  warning(s, code) {
    this.log(`${cosmetic.xterm(136)('Warning')}: ${s}`, code)
    return this.logCloud(s, code, level.warning)
  }
  error(s, code) {
    this.log(`${cosmetic.xterm(160)('Error')}: ${s}`, code)
    return this.logCloud(s, code, level.error)
  }
  critical(s, code) {
    this.log(`${cosmetic.xterm(166)('Critical')}: ${s}`, code)
    return this.logCloud(s, code, level.critical)
  }
}

module.exports = Lumber

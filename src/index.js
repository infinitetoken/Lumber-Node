const { Lumber } = require('./models');

module.exports = (token) => {
  return new Lumber(token)
}
